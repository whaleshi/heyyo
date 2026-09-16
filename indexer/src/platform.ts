import { formatUnits } from 'ethers';
import type { Pool } from 'pg';
import type { IndexerConfig } from './config.ts';
import type { RpcClient } from './rpc.ts';
import { read, tokenInterface } from '../../shared/contracts.ts';
import { platformTokenAddress, burnAddress, type PlatformStats } from '../../shared/platform.ts';

export async function syncPlatform(pool: Pool, config: IndexerConfig, rpc: RpcClient) {
  const cursor=(await pool.query(`SELECT c.last_block::text,c.last_block_hash FROM heyyo_cursor c
    LEFT JOIN heyyo_platform_state s USING(chain_id,deployment_id)
    WHERE c.chain_id=$1 AND c.deployment_id=$2 AND NOT c.halted
    AND (s.block_number IS NULL OR s.block_number<>c.last_block OR s.block_hash<>c.last_block_hash OR s.token_address<>$3)`,
    [config.chainId,config.deploymentId,platformTokenAddress.toLowerCase()])).rows[0];
  if (!cursor) return;
  const block=BigInt(cursor.last_block), tag=`0x${block.toString(16)}`;
  if (await rpc.request<string>('eth_getCode',[platformTokenAddress,tag]) === '0x') return;
  // Dead-address holdings include protocol buybacks and direct burns, not the zero address.
  const [[balance],[decimals]]=await Promise.all([
    read(rpc,platformTokenAddress,tokenInterface,'balanceOf',[burnAddress],tag),
    read(rpc,platformTokenAddress,tokenInterface,'decimals',[],tag),
  ]);
  if ((await rpc.block(block)).hash!==cursor.last_block_hash) throw new Error('Platform snapshot block changed');
  await pool.query(`INSERT INTO heyyo_platform_state(chain_id,deployment_id,token_address,block_number,block_hash,burned_raw,token_decimals)
    SELECT $1,$2,$3,$4,$5,$6,$7 FROM heyyo_cursor c WHERE c.chain_id=$1 AND c.deployment_id=$2
    AND NOT c.halted AND c.last_block=$4 AND c.last_block_hash=$5
    ON CONFLICT(chain_id,deployment_id) DO UPDATE SET token_address=EXCLUDED.token_address,block_number=EXCLUDED.block_number,
    block_hash=EXCLUDED.block_hash,burned_raw=EXCLUDED.burned_raw,token_decimals=EXCLUDED.token_decimals,updated_at=now()`,
    [config.chainId,config.deploymentId,platformTokenAddress.toLowerCase(),cursor.last_block,cursor.last_block_hash,balance.toString(),Number(decimals)]);
}
export async function getPlatformStats(pool: Pool, config: IndexerConfig): Promise<PlatformStats|null> {
  const row=(await pool.query(`SELECT s.block_number::text,s.burned_raw::text,s.token_decimals,s.updated_at,
    COALESCE((SELECT SUM((e.payload->'args'->>'creatorAmount')::numeric *
      CASE WHEN lower(e.payload->'args'->>'asset')='0x0000000000000000000000000000000000000000' THEN 1 ELSE 1000000000000 END)
      FROM heyyo_events e WHERE e.chain_id=s.chain_id AND e.deployment_id=s.deployment_id
      AND e.kind='protocol' AND e.source_address=ANY($4::text[]) AND e.block_number<=s.block_number
      AND e.payload->>'eventName'='CreatorFeeDistributed'
      AND lower(e.payload->'args'->>'asset') IN ('0x0000000000000000000000000000000000000000','0x3600000000000000000000000000000000000000')),0)::text AS rewards_raw
    FROM heyyo_platform_state s JOIN heyyo_cursor c USING(chain_id,deployment_id)
    WHERE s.chain_id=$1 AND s.deployment_id=$2 AND s.token_address=$3 AND NOT c.halted AND s.block_number<=c.last_block`,
    [config.chainId,config.deploymentId,platformTokenAddress.toLowerCase(),config.sourceAddresses])).rows[0];
  if (!row) return null;
  return {tokenAddress:platformTokenAddress,burnAddress,burnedHeyyo:formatUnits(row.burned_raw,row.token_decimals),
    creatorRewardsUsdc:formatUnits(row.rewards_raw,18),indexedBlock:row.block_number,updatedAt:new Date(row.updated_at).toISOString()};
}
