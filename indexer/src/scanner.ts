import type { PoolClient } from 'pg';
import type { IndexerConfig } from './config.ts';
import { orderEvents } from './events.ts';
import type { ContractAdapter } from './adapters/heyyo.ts';
import type { Block, ChainReader } from './rpc.ts';
import { applyEvent } from './processor.ts';

export class ReorgError extends Error {}
export function confirmedRange(last: bigint, head: bigint, confirmations: number, batchSize: number) {
  const end = head - BigInt(confirmations);
  if (end <= last) return null;
  return { fromBlock: last + 1n, toBlock: end < last + BigInt(batchSize) ? end : last + BigInt(batchSize) };
}
export async function scanOnce(client: PoolClient, config: IndexerConfig, rpc: ChainReader, adapter: ContractAdapter) {
  if (config.startBlock === null) throw new Error('Missing deployment block');
  const cursor = (await client.query<{ last_block: string; last_block_hash: string; halted: boolean }>(
    'SELECT last_block::text,last_block_hash,halted FROM heyyo_cursor WHERE chain_id=$1 AND deployment_id=$2', [config.chainId,config.deploymentId])).rows[0];
  if (cursor?.halted) throw new ReorgError('This deployment is halted and requires reconciliation');
  const last = cursor ? BigInt(cursor.last_block) : config.startBlock - 1n;
  if (cursor && (await rpc.block(last)).hash !== cursor.last_block_hash) throw new ReorgError('Indexed chain has reorganized. Stop and reconcile the isolated Heyyo database.');
  const range = confirmedRange(last, await rpc.head(), config.confirmations, config.batchSize);
  if (!range) return false;
  const blocks = new Map<bigint, Block>();
  // Fetch bounded groups concurrently, then validate in canonical block order.
  for (let from = range.fromBlock; from <= range.toBlock; from += 8n) {
    const numbers = Array.from({length: Number(range.toBlock - from + 1n < 8n ? range.toBlock - from + 1n : 8n)}, (_,i) => from + BigInt(i));
    const fetched = await Promise.all(numbers.map(n => rpc.block(n)));
    for (const block of fetched) {
      const previousHash = blocks.get(block.number - 1n)?.hash ?? cursor?.last_block_hash;
      if (previousHash && block.parentHash !== previousHash) throw new ReorgError('Discontinuous chain batch');
      blocks.set(block.number, block);
    }
  }
  const known = await client.query<{ token_address: string; launch_address: string; pool_address: string | null }>(
    'SELECT token_address,launch_address,pool_address FROM heyyo_tokens WHERE chain_id=$1 AND deployment_id=$2', [config.chainId,config.deploymentId]);
  const events = orderEvents(await adapter.readEvents({ ...range, knownTokens: known.rows.map(t => ({ tokenAddress:t.token_address,launchAddress:t.launch_address,poolAddress:t.pool_address })) }));
  const tip = blocks.get(range.toBlock)!;
  if ((await rpc.block(tip.number)).hash !== tip.hash) throw new ReorgError('Chain changed during batch collection');
  await client.query('BEGIN');
  try {
    for (const event of events) {
      const block = blocks.get(event.blockNumber);
      if (!block || block.hash !== event.blockHash.toLowerCase()) throw new ReorgError('Event does not match the confirmed block');
      await applyEvent(client, config, event, block);
    }
    for (const block of blocks.values()) await client.query(
      `INSERT INTO heyyo_checkpoints (chain_id,deployment_id,block_number,block_hash,parent_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [config.chainId,config.deploymentId,block.number.toString(),block.hash,block.parentHash]);
    await client.query(`INSERT INTO heyyo_cursor (chain_id,deployment_id,last_block,last_block_hash) VALUES ($1,$2,$3,$4)
      ON CONFLICT (chain_id,deployment_id) DO UPDATE SET last_block=EXCLUDED.last_block,last_block_hash=EXCLUDED.last_block_hash,updated_at=now()`,
    [config.chainId,config.deploymentId,tip.number.toString(),tip.hash]);
    await client.query('DELETE FROM heyyo_checkpoints WHERE chain_id=$1 AND deployment_id=$2 AND block_number < $3',
      [config.chainId,config.deploymentId,(tip.number-256n).toString()]);
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
