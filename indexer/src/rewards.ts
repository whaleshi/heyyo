import type { Pool } from 'pg';
import type { IndexerConfig } from './config.ts';
import type { RpcClient } from './rpc.ts';
import { agentAddress, agentInterface, read, readSource, verifyDeployment } from '../../shared/contracts.ts';
import { safeImage } from './list.ts';

// Snapshots are taken at the committed index cursor, never at an unrelated RPC head.
export async function syncRewards(pool: Pool, config: IndexerConfig, rpc: RpcClient) {
  const cursor = (await pool.query(`SELECT c.last_block::text,c.last_block_hash FROM heyyo_cursor c
    LEFT JOIN heyyo_reward_state s USING(chain_id,deployment_id)
    WHERE c.chain_id=$1 AND c.deployment_id=$2 AND NOT c.halted
      AND (s.block_number IS NULL OR s.block_number<>c.last_block OR s.block_hash<>c.last_block_hash)`,[config.chainId,config.deploymentId])).rows[0];
  if (!cursor) return;
  const block = BigInt(cursor.last_block), tag=`0x${block.toString(16)}`;
  await verifyDeployment(rpc,tag);
  const tokens = (await pool.query<{token_address:string;launch_id:string}>(`SELECT token_address,launch_id::text FROM heyyo_tokens
    WHERE chain_id=$1 AND deployment_id=$2 ORDER BY created_block,created_log_index`,[config.chainId,config.deploymentId])).rows;
  const snapshots=[];
  for (const token of tokens) {
    if (!token.launch_id) throw new Error('Missing indexed launch ID');
    const id=BigInt(token.launch_id), source=await readSource(rpc,id,tag);
    if (source.token!==token.token_address) throw new Error('Reward token mismatch');
    const amounts=await Promise.all(['pendingCreatorFee','claimableCreatorFee','creatorFeeClaimed','pendingBuyback'].map(method=>read(rpc,agentAddress,agentInterface,method,[id],tag).then(v=>v[0].toString())));
    snapshots.push({...source,pending:amounts[0],claimable:amounts[1],claimed:amounts[2],pendingBuyback:amounts[3]});
  }
  if ((await rpc.block(block)).hash!==cursor.last_block_hash) throw new Error('Reward snapshot block changed');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const locked=(await client.query('SELECT last_block::text,last_block_hash,halted FROM heyyo_cursor WHERE chain_id=$1 AND deployment_id=$2 FOR UPDATE',[config.chainId,config.deploymentId])).rows[0];
    if (!locked || locked.halted || locked.last_block!==cursor.last_block || locked.last_block_hash!==cursor.last_block_hash) throw new Error('Index cursor changed during reward read');
    await client.query('DELETE FROM heyyo_reward_snapshots WHERE chain_id=$1 AND deployment_id=$2',[config.chainId,config.deploymentId]);
    for (const snapshot of snapshots) await client.query(`INSERT INTO heyyo_reward_snapshots(chain_id,deployment_id,token_address,payload)
      VALUES($1,$2,$3,$4::jsonb)`,[config.chainId,config.deploymentId,snapshot.token,JSON.stringify(snapshot)]);
    await client.query(`INSERT INTO heyyo_reward_state(chain_id,deployment_id,block_number,block_hash) VALUES($1,$2,$3,$4)
      ON CONFLICT(chain_id,deployment_id) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,updated_at=now()`,[config.chainId,config.deploymentId,cursor.last_block,cursor.last_block_hash]);
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
const readySql=`SELECT c.last_block::text AS indexed_block,s.updated_at FROM heyyo_cursor c
 JOIN heyyo_reward_state s USING(chain_id,deployment_id)
 WHERE c.chain_id=$1 AND c.deployment_id=$2 AND NOT c.halted
 AND s.block_number=c.last_block AND s.block_hash=c.last_block_hash`;
export async function getWalletRewards(pool: Pool, config: IndexerConfig, address: string) {
  const result=await pool.query(`WITH ready AS (${readySql}) SELECT ready.*,
    COALESCE((SELECT jsonb_agg(r.payload || jsonb_build_object('image',t.image,'description',t.description) ORDER BY t.created_block DESC,t.created_log_index DESC)
     FROM heyyo_tokens t JOIN heyyo_reward_snapshots r USING(chain_id,deployment_id,token_address)
     WHERE t.chain_id=$1 AND t.deployment_id=$2 AND t.creator_address=$3),'[]'::jsonb) AS items FROM ready`,[config.chainId,config.deploymentId,address.toLowerCase()]);
  const row=result.rows[0];if(!row)return null;
  return {address:address.toLowerCase(),chainId:config.chainId,indexedBlock:row.indexed_block,updatedAt:new Date(row.updated_at).toISOString(),
    items:row.items.map((item: Record<string,unknown>)=>({...item,image:safeImage(item.image)}))};
}
export async function getWalletClaims(pool: Pool, config: IndexerConfig, address: string) {
  const result=await pool.query(`WITH ready AS (${readySql}), claims AS (
    SELECT e.tx_hash AS hash,e.log_index::text AS "logIndex",e.block_number::text AS block,
      e.event_timestamp::text AS timestamp,e.payload->'args'->>'sourceLaunchId' AS "launchId",
      e.payload->'args'->>'amount' AS amount,e.payload->'args'->>'asset' AS asset,
      t.ticker,t.quote_decimals AS decimals,t.quote_symbol AS symbol
    FROM heyyo_events e JOIN heyyo_tokens t ON t.chain_id=e.chain_id AND t.deployment_id=e.deployment_id
      AND t.launch_id::text=e.payload->'args'->>'sourceLaunchId'
    WHERE e.chain_id=$1 AND e.deployment_id=$2 AND e.kind='protocol' AND e.source_address=ANY($4::text[])
      AND e.payload->>'eventName'='CreatorFeeClaimed' AND lower(e.payload->'args'->>'creatorRecipient')=$3 AND t.creator_address=$3
    ORDER BY e.block_number DESC,e.log_index DESC LIMIT 50
  ) SELECT ready.*,COALESCE((SELECT jsonb_agg(to_jsonb(claims)) FROM claims),'[]'::jsonb) AS items FROM ready`,[config.chainId,config.deploymentId,address.toLowerCase(),config.sourceAddresses]);
  const row=result.rows[0];if(!row)return null;
  return {address:address.toLowerCase(),chainId:config.chainId,indexedBlock:row.indexed_block,updatedAt:new Date(row.updated_at).toISOString(),items:row.items};
}
