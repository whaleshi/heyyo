import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Interface} from 'ethers';
import {syncMarkets,curvePrice,poolPrice,curveInterface,poolInterface} from '../indexer/src/market.ts';
import {applyEvent} from '../indexer/src/processor.ts';
import {getTokenList} from '../indexer/src/list.ts';
import {agentAddress,factoryAddress,agentInterface,chainId} from '../shared/contracts.ts';
const addr=n=>`0x${n.toString(16).padStart(40,'0')}`, hash=n=>`0x${n.toString(16).padStart(64,'0')}`;
const launch=addr(1),token=addr(2),poolAddress=addr(9),usdc='0x3600000000000000000000000000000000000000';
const unit=10n**6n;
const abiList=['ICurveCreatorAgentFactory','ICurveCreatorAgentLaunch','ICurveCreatorAgentManagedToken','ERC20'].map(n=>new Interface(JSON.parse(readFileSync(new URL(`../contracts/heyyo/abis/${n}.abi.json`,import.meta.url)))));
abiList.push(agentInterface,curveInterface,poolInterface);
const config={chainId,deploymentId:'market-test',sourceAddresses:[agentAddress],batchSize:100};
const block=n=>({number:BigInt(n),hash:hash(n),parentHash:hash(n-1),timestamp:Math.floor(Date.now()/1000)-60+Number(n)});
function log(abi,name,args,n,index,address) {return {...abi.encodeEventLog(abi.getEvent(name),args),address,blockNumber:`0x${n.toString(16)}`,blockHash:hash(n),transactionHash:hash(n+100),logIndex:`0x${index.toString(16)}`};}
async function fixture() {
  const db=new PGlite();await db.exec(readFileSync(new URL('../indexer/sql/001-initial.sql',import.meta.url),'utf8'));
  const client={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length};},release(){}};
  const pg={...client,connect:async()=>client};
  const logs=[];
  const rpc={block:async n=>block(Number(n)),request:async(method,params)=>{
    if(method==='eth_getLogs') return logs.filter(l=>l.address===params[0].address && BigInt(l.blockNumber)>=BigInt(params[0].fromBlock) && BigInt(l.blockNumber)<=BigInt(params[0].toBlock));
    assert.equal(method,'eth_call');
    const abi=abiList.find(a=>a.getFunction(params[0].data.slice(0,10))), fn=abi.getFunction(params[0].data.slice(0,10));
    const values={sourceLaunches:[launch,token,addr(3),addr(4),usdc,1,true],
      getLaunchRecord:[1,agentAddress,token,addr(6),launch,2,1,1,hash(0),'',hash(0)],
      factory:factoryAddress,creator:agentAddress,token,feeVault:addr(4),paymentToken:usdc,paymentKind:1,launchId:7,
      pool:poolAddress,state:2,transferController:launch,name:'Test',symbol:'USDC',decimals:6,totalSupply:1000n*unit,
      graduationParameters:[800n*unit,8000n*unit,200n*unit],token0:token,token1:usdc};
    const value=values[fn.name];assert.notEqual(value,undefined,fn.name);
    return abi.encodeFunctionResult(fn,fn.outputs.length===1?[value]:value);
  }};
  await applyEvent(client,config,{kind:'created',blockNumber:10n,blockHash:hash(10),txHash:hash(110),logIndex:20,
    tokenAddress:token,sourceAddress:agentAddress,launchAddress:launch,creatorAddress:addr(3),name:'Test',ticker:'T',description:'',image:null,
    metadataUri:null,totalSupplyRaw:String(1000n*unit),tokenDecimals:6,quoteDecimals:6,quoteSymbol:'USDC',graduationTargetRaw:null,launchId:'7'},block(10));
  async function head(n) {await client.query(`INSERT INTO heyyo_cursor(chain_id,deployment_id,last_block,last_block_hash) VALUES($1,$2,$3,$4)
    ON CONFLICT(chain_id,deployment_id) DO UPDATE SET last_block=$3,last_block_hash=$4`,[chainId,config.deploymentId,n,hash(n)]);}
  await head(10);
  const list=stage=>getTokenList(pg,config,{stage,sort:'recent',query:'',page:1,pageSize:12});
  return {db,pg,rpc,logs,head,list};
}
test('curve and both pool orientations preserve decimal units',()=>{
  assert.equal(Number(curvePrice(800n*10n**18n,8000n*unit,0n,0n,18,6)),0.0000025*1e6); // 800 tokens => $2.50
  assert.equal(Number(poolPrice(2n**96n,true,18,6)),1e12);
  assert.equal(Number(poolPrice(2n**97n,false,6,6)),0.25);
  assert.throws(()=>poolPrice(0n,true,18,6));
});
test('backfill includes initial buy before TokenCreated, is idempotent, and updates API metrics and stages',async()=>{
  const f=await fixture();try{
    f.logs.push(log(curveInterface,'TokensBought',[addr(3),600n*unit,0,600n*unit,200n*unit,200n*unit,600n*unit],10,5,launch));
    await syncMarkets(f.pg,config,f.rpc);
    let item=(await f.list('new')).items[0];assert.equal(item.volume,600);assert.equal(item.progress,7.5);assert.ok(item.marketCap>2500);assert.ok(item.change>0);
    await syncMarkets(f.pg,config,f.rpc);
    assert.equal((await f.list('new')).items[0].volume,600);
    await f.head(11);
    f.logs.push(log(curveInterface,'TokensSold',[addr(3),unit,100n*unit,unit,99n*unit,199n*unit,500n*unit],11,1,launch));
    await syncMarkets(f.pg,config,f.rpc);
    assert.equal((await f.list('new')).items[0].volume,700);
    await f.head(12);
    f.logs.push(log(curveInterface,'TokensBought',[addr(3),5000n*unit,0,5000n*unit,unit,700n*unit,5500n*unit],12,1,launch));
    await syncMarkets(f.pg,config,f.rpc);assert.equal((await f.list('soon')).items.length,1);
    await f.head(13);
    f.logs.push(log(curveInterface,'CurveGraduated',[800n*unit,8000n*unit],13,2,launch));
    await syncMarkets(f.pg,config,f.rpc);assert.equal((await f.list('graduated')).items[0].progress,100);
    await f.head(14);
    f.logs.push(log(curveInterface,'LiquidityMigrated',[poolAddress,1,2n**96n,200n*unit,8000n*unit],14,4,launch));
    f.logs.push(log(poolInterface,'Swap',[addr(3),addr(3),-unit,10n*unit,2n**97n,1,0],14,5,poolAddress));
    await syncMarkets(f.pg,config,f.rpc);
    item=(await f.list('graduated')).items[0];assert.equal(item.volume,5710);assert.equal(item.marketCap,4000);
    await syncMarkets(f.pg,config,f.rpc);assert.equal((await f.list('graduated')).items[0].volume,5710);
  } finally {await f.db.close();}
});
test('bad pool binding or reorg cannot commit partial market updates',async()=>{
  const f=await fixture();try{
    f.logs.push(log(curveInterface,'LiquidityMigrated',[addr(99),1,2n**96n,unit,unit],10,5,launch));
    await assert.rejects(syncMarkets(f.pg,config,f.rpc),/pool mismatch/);
    assert.equal((await f.pg.query('SELECT market_block FROM heyyo_tokens')).rows[0].market_block,null);
    f.logs.length=0;await syncMarkets(f.pg,config,f.rpc);await f.head(11);
    f.rpc.block=async n=>({...block(Number(n)),hash:hash(999)});
    await assert.rejects(syncMarkets(f.pg,config,f.rpc),/cursor changed/);
    assert.equal(String((await f.pg.query('SELECT market_block FROM heyyo_tokens')).rows[0].market_block),'10');
  } finally {await f.db.close();}
});
