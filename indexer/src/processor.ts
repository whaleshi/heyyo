import type { PoolClient } from 'pg';
import type { IndexerConfig } from './config.ts';
import { validateEvent, type IndexEvent } from './events.ts';
import type { Block } from './rpc.ts';

export async function applyEvent(client: PoolClient, config: IndexerConfig, event: IndexEvent, block: Block) {
  validateEvent(event);
  const token = event.tokenAddress.toLowerCase();
  const source = event.sourceAddress.toLowerCase();
  if (event.kind === 'created' || event.kind === 'protocol') {
    if (!config.sourceAddresses.includes(source)) throw new Error('Creation event is not from an approved Heyyo source');
  } else {
    const known = await client.query<{ launch_address: string; pool_address: string | null }>(
      'SELECT launch_address, pool_address FROM heyyo_tokens WHERE chain_id=$1 AND deployment_id=$2 AND token_address=$3',
      [config.chainId, config.deploymentId, token]);
    const owner = known.rows[0];
    if (!owner || (owner.launch_address !== source && owner.pool_address !== source)) throw new Error('Event does not belong to an indexed Heyyo launch');
    if (event.kind === 'graduated' && owner.launch_address !== source) throw new Error('Only a launch can confirm its migration');
  }
  const recorded = await client.query(
    `INSERT INTO heyyo_events (chain_id,deployment_id,tx_hash,log_index,block_number,block_hash,event_timestamp,token_address,source_address,kind,payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT DO NOTHING RETURNING tx_hash`,
    [config.chainId, config.deploymentId, event.txHash.toLowerCase(), event.logIndex, event.blockNumber.toString(), block.hash,
      block.timestamp, token, source, event.kind, JSON.stringify(event, (_, v) => typeof v === 'bigint' ? v.toString() : v)]);
  if (!recorded.rowCount || event.kind === 'protocol') return;
  if (event.kind === 'created') {
    await client.query(
      `INSERT INTO heyyo_tokens (chain_id,deployment_id,token_address,source_address,launch_address,creator_address,name,ticker,description,image,metadata_uri,
       total_supply_raw,token_decimals,quote_decimals,quote_symbol,graduation_target_raw,created_timestamp,created_block,created_log_index,launch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [config.chainId,config.deploymentId,token,source,event.launchAddress.toLowerCase(),event.creatorAddress.toLowerCase(),event.name,event.ticker,
        event.description,event.image,event.metadataUri,event.totalSupplyRaw,event.tokenDecimals,event.quoteDecimals,event.quoteSymbol,
        event.graduationTargetRaw,block.timestamp,event.blockNumber.toString(),event.logIndex,event.launchId ?? null]);
    return;
  }
  await client.query(
    `UPDATE heyyo_tokens SET quote_reserve_raw=$3, price_usd=$4, updated_at=now(),
     graduated=graduated OR $5, pool_address=COALESCE($6,pool_address) WHERE chain_id=$1 AND token_address=$2`,
    [config.chainId, token, event.snapshot.quoteReserveRaw, event.snapshot.priceUsd, event.kind === 'graduated',
      event.kind === 'graduated' ? event.poolAddress?.toLowerCase() ?? null : null]);
  if (event.snapshot.priceUsd !== null) {
    await client.query(`INSERT INTO heyyo_prices (chain_id,token_address,block_number,log_index,event_timestamp,price_usd)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [config.chainId,token,event.blockNumber.toString(),event.logIndex,block.timestamp,event.snapshot.priceUsd]);
  }
  if (event.kind === 'trade') {
    await client.query(`INSERT INTO heyyo_trades (chain_id,token_address,tx_hash,log_index,block_number,event_timestamp,side,quote_amount_raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [config.chainId,token,event.txHash.toLowerCase(),event.logIndex,event.blockNumber.toString(),block.timestamp,event.side,event.quoteAmountRaw]);
  }
}
