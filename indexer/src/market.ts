import { Interface, ZeroAddress } from 'ethers';
import type { Pool } from 'pg';
import curveAbi from '../../contracts/heyyo/CurveMarket.abi.json';
import { read, readSource, sameAddress, type ChainLog } from '../../shared/contracts.ts';
import type { IndexerConfig } from './config.ts';
import type { RpcClient, Block } from './rpc.ts';
import { orderEvents, type IndexEvent } from './events.ts';
import { applyEvent } from './processor.ts';
import { ReorgError } from './scanner.ts';

export const curveInterface = new Interface(curveAbi);
export const poolInterface = new Interface([
  'function token0() view returns (address)', 'function token1() view returns (address)',
  'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)',
]);
const usdc = '0x3600000000000000000000000000000000000000';
const hex = (n: bigint) => `0x${n.toString(16)}`;
const abs = (n: bigint) => n < 0n ? -n : n;
// Keep raw amounts and price arithmetic in bigint until PostgreSQL numeric storage.
export function ratio(n: bigint, d: bigint): string {
  if (n <= 0n || d <= 0n) throw new Error('Invalid market price ratio');
  const scaled = n * 10n ** 60n / d;
  if (scaled === 0n) throw new Error('Market price below supported precision');
  return `${scaled / 10n ** 60n}.${(scaled % 10n ** 60n).toString().padStart(60, '0')}`;
}
export function curvePrice(supply: bigint, target: bigint, sold: bigint, reserve: bigint, tokenDecimals: number, quoteDecimals: number) {
  const unit = 10n ** BigInt(tokenDecimals), quote = 10n ** BigInt(quoteDecimals);
  // A complete sell can leave rounding dust in the quote reserve.
  if (sold === 0n && reserve >= 0n) return ratio(target * unit, supply * 4n * quote);
  const virtual = supply * 4n / 3n;
  if (sold <= 0n || reserve <= 0n || sold >= virtual) throw new Error('Invalid curve reserves');
  return ratio(reserve * virtual * unit, sold * (virtual - sold) * quote);
}
export function poolPrice(sqrt: bigint, tokenIs0: boolean, tokenDecimals: number, quoteDecimals: number) {
  const square = sqrt * sqrt, q192 = 2n ** 192n;
  return ratio((tokenIs0 ? square : q192) * 10n ** BigInt(tokenDecimals), (tokenIs0 ? q192 : square) * 10n ** BigInt(quoteDecimals));
}

type MarketRow = { token_address: string; launch_address: string; launch_id: string; created_block: string;
  created_timestamp: string; market_block: string | null; market_block_hash: string | null; pool_address: string | null; quote_reserve_raw: string };
export async function syncMarkets(pool: Pool, config: IndexerConfig, rpc: RpcClient) {
  const cursor = (await pool.query<{last_block: string;last_block_hash:string;halted:boolean}>(
    'SELECT last_block::text,last_block_hash,halted FROM heyyo_cursor WHERE chain_id=$1 AND deployment_id=$2', [config.chainId,config.deploymentId])).rows[0];
  if (!cursor || cursor.halted) return;
  const rows = (await pool.query<MarketRow>(`SELECT token_address,launch_address,launch_id::text,created_block::text,created_timestamp::text,
    market_block::text,market_block_hash,pool_address,quote_reserve_raw::text FROM heyyo_tokens
    WHERE chain_id=$1 AND deployment_id=$2 AND (market_block IS NULL OR market_block < $3) ORDER BY created_block,token_address`,
    [config.chainId,config.deploymentId,cursor.last_block])).rows;
  for (const row of rows) {
    if (row.market_block && (await rpc.block(BigInt(row.market_block))).hash !== row.market_block_hash) throw new ReorgError('Market cursor changed');
    const from = row.market_block === null ? BigInt(row.created_block) : BigInt(row.market_block) + 1n;
    const end = BigInt(cursor.last_block), to = end < from + BigInt(config.batchSize) - 1n ? end : from + BigInt(config.batchSize) - 1n;
    const source = await readSource(rpc, BigInt(row.launch_id), hex(to));
    if (source.mode !== 1 || !sameAddress(source.token,row.token_address) || !sameAddress(source.launch,row.launch_address)) throw new Error('Market source mismatch');
    // USD labels are supported only for the verified USDC payment asset, not arbitrary ticker symbols.
    const dollarQuote = sameAddress(source.paymentToken,usdc) && source.paymentDecimals === 6;
    const [supply,target] = await read(rpc,source.launch,curveInterface,'graduationParameters',[],hex(to));
    if (supply <= 0n || target <= 0n) throw new Error('Invalid graduation parameters');
    const initialPrice = dollarQuote ? curvePrice(supply,target,0n,0n,source.tokenDecimals,source.paymentDecimals) : null;
    const blocks = new Map<bigint,Block>();
    async function block(n: bigint) { let b=blocks.get(n); if(!b){b=await rpc.block(n);blocks.set(n,b);}return b; }
    const tip = await block(to);
    async function logs(address: string) {
      const result = await rpc.request<ChainLog[]>('eth_getLogs',[{address,fromBlock:hex(from),toBlock:hex(to)}]);
      const missing = [...new Set(result.map(log=>BigInt(log.blockNumber)))].filter(n=>!blocks.has(n));
      if (missing.some(n=>n<from || n>to)) throw new ReorgError('Invalid market log range');
      for (let i=0;i<missing.length;i+=8) await Promise.all(missing.slice(i,i+8).map(block));
      for (const log of result) {
        const n=BigInt(log.blockNumber);
        if(log.removed || !sameAddress(log.address,address) || n<from || n>to || (await block(n)).hash!==log.blockHash.toLowerCase()) throw new ReorgError('Invalid market log');
      }
      return result.sort((a,b)=>BigInt(a.blockNumber)===BigInt(b.blockNumber)?Number(BigInt(a.logIndex)-BigInt(b.logIndex)):BigInt(a.blockNumber)<BigInt(b.blockNumber)?-1:1);
    }
    const events: IndexEvent[] = [];
    const migrationPrices = new Map<string,bigint>();
    let reserve = row.quote_reserve_raw;
    let migratedAt: {block:bigint;index:number} | undefined;
    const base = (log: ChainLog) => ({blockNumber:BigInt(log.blockNumber),blockHash:log.blockHash,txHash:log.transactionHash,
      logIndex:Number(BigInt(log.logIndex)),tokenAddress:source.token,sourceAddress:log.address.toLowerCase()});
    for (const log of await logs(source.launch)) {
      const decoded=curveInterface.parseLog(log); if(!decoded) continue;
      const a=decoded.args;
      if(decoded.name==='TokensBought' || decoded.name==='TokensSold') {
        reserve=String(a.quoteReserveAfter);
        events.push({...base(log),kind:'trade',side:decoded.name==='TokensBought'?'buy':'sell',
          quoteAmountRaw:String(decoded.name==='TokensBought'?a.grossQuoteIn:a.grossQuoteOut),
          snapshot:{quoteReserveRaw:reserve,priceUsd:dollarQuote?curvePrice(supply,target,a.tokenSoldAfter,a.quoteReserveAfter,source.tokenDecimals,source.paymentDecimals):null}});
      } else if(decoded.name==='CurveGraduated') {
        reserve=String(a.quoteReserve);
        events.push({...base(log),kind:'graduated',poolAddress:null,snapshot:{quoteReserveRaw:reserve,
          priceUsd:dollarQuote?curvePrice(supply,target,a.tokenSold,a.quoteReserve,source.tokenDecimals,source.paymentDecimals):null}});
      } else if(decoded.name==='LiquidityMigrated') {
        if(source.pool===ZeroAddress || !sameAddress(source.pool,a.pool)) throw new Error('Migration pool mismatch');
        migratedAt={block:BigInt(log.blockNumber),index:Number(BigInt(log.logIndex))};
        migrationPrices.set(`${migratedAt.block}:${migratedAt.index}`,a.sqrtPriceX96);
        events.push({...base(log),kind:'graduated',poolAddress:source.pool,
          snapshot:{quoteReserveRaw:reserve,priceUsd:null}});
      }
    }
    if(row.pool_address || migratedAt) {
      const [[token0],[token1]]=await Promise.all(['token0','token1'].map(m=>read(rpc,source.pool,poolInterface,m,[],hex(to))));
      const tokenIs0=sameAddress(token0,source.token);
      if(!sameAddress(tokenIs0?token0:token1,source.token) || !sameAddress(tokenIs0?token1:token0,source.paymentToken)) throw new Error('Pool assets mismatch');
      // The migration event supplies the opening pool price, before the first Swap.
      for(const event of events) if(event.kind==='graduated' && event.poolAddress) {
        event.snapshot.priceUsd=dollarQuote?poolPrice(migrationPrices.get(`${event.blockNumber}:${event.logIndex}`)!,tokenIs0,source.tokenDecimals,source.paymentDecimals):null;
      }
      for(const log of await logs(source.pool)) {
        const decoded=poolInterface.parseLog(log); if(decoded?.name!=='Swap') continue;
        const identity=base(log);
        if(!row.pool_address && migratedAt && (identity.blockNumber<migratedAt.block || (identity.blockNumber===migratedAt.block && identity.logIndex<=migratedAt.index))) continue;
        const a=decoded.args, quote=tokenIs0?a.amount1:a.amount0, token=tokenIs0?a.amount0:a.amount1;
        if(quote===0n && token===0n) continue;
        if(!((quote>0n && token<0n)||(quote<0n && token>0n))) throw new Error('Invalid pool swap amounts');
        events.push({...identity,kind:'trade',side:quote>0n?'buy':'sell',quoteAmountRaw:abs(quote).toString(),
          snapshot:{quoteReserveRaw:reserve,priceUsd:dollarQuote?poolPrice(a.sqrtPriceX96,tokenIs0,source.tokenDecimals,source.paymentDecimals):null}});
      }
    }
    if((await rpc.block(to)).hash!==tip.hash || (to===end && tip.hash!==cursor.last_block_hash)) throw new ReorgError('Market batch changed');
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const current=(await client.query<{market_block:string|null}>(`SELECT market_block::text FROM heyyo_tokens
        WHERE chain_id=$1 AND deployment_id=$2 AND token_address=$3 FOR UPDATE`,[config.chainId,config.deploymentId,source.token])).rows[0];
      if(!current || current.market_block!==row.market_block) throw new Error('Market cursor advanced concurrently');
      if(row.market_block===null) {
        await client.query(`UPDATE heyyo_tokens SET graduation_target_raw=$4,price_usd=$5 WHERE chain_id=$1 AND deployment_id=$2 AND token_address=$3`,[config.chainId,config.deploymentId,source.token,target.toString(),initialPrice]);
        if(initialPrice) await client.query(`INSERT INTO heyyo_prices(chain_id,token_address,block_number,log_index,event_timestamp,price_usd)
          VALUES($1,$2,$3,-1,$4,$5) ON CONFLICT DO NOTHING`,[config.chainId,source.token,row.created_block,row.created_timestamp,initialPrice]);
      }
      for(const event of orderEvents(events)) await applyEvent(client,config,event,await block(event.blockNumber));
      await client.query(`UPDATE heyyo_tokens SET market_block=$4,market_block_hash=$5,updated_at=now()
        WHERE chain_id=$1 AND deployment_id=$2 AND token_address=$3`,[config.chainId,config.deploymentId,source.token,to.toString(),tip.hash]);
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
}
