import { agentAddress, chainId, startBlock } from '../../shared/contracts.ts';
import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), quiet: true });

export type IndexerConfig = {
  databaseUrl: string;
  chainId: number;
  deploymentId: string;
  rpcUrl: string;
  sourceAddresses: string[];
  startBlock: bigint | null;
  confirmations: number;
  batchSize: number;
  pollInterval: number;
  port: number;
};
function integer(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error('Invalid integer in indexer configuration');
  return parsed;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  const sourceAddresses = (env.INDEXER_SOURCE_ADDRESSES ?? agentAddress).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (sourceAddresses.some(s => !/^0x[0-9a-f]{40}$/.test(s) || /^0x0{40}$/.test(s))) throw new Error('Invalid Heyyo source address');
  const rawBlock = (env.INDEXER_START_BLOCK ?? startBlock.toString()).trim();
  if (rawBlock && !/^\d+$/.test(rawBlock)) throw new Error('Invalid deployment block');
  const rpcUrl = env.INDEXER_RPC_URL?.trim() ?? '';
  if (rpcUrl && !['http:', 'https:'].includes(new URL(rpcUrl).protocol)) throw new Error('Invalid RPC URL');
  return {
    databaseUrl: env.INDEXER_DATABASE_URL?.trim() ?? '',
    chainId: integer(env.INDEXER_CHAIN_ID, chainId, 1, 2147483647),
    deploymentId: env.INDEXER_DEPLOYMENT_ID?.trim() ?? `heyyo-${chainId}-${agentAddress}`,
    rpcUrl, sourceAddresses, startBlock: rawBlock ? BigInt(rawBlock) : null,
    confirmations: integer(env.INDEXER_CONFIRMATIONS, 6, 0, 128),
    batchSize: integer(env.INDEXER_BATCH_SIZE, 100, 1, 1000),
    pollInterval: integer(env.INDEXER_POLL_INTERVAL_MS, 3000, 1000, 60000),
    port: integer(env.INDEXER_API_PORT, 8787, 1024, 65535),
  };
}
export function hasSourceConfig(config: IndexerConfig) {
  return !!(config.deploymentId && config.sourceAddresses.length && config.startBlock !== null && config.rpcUrl);
}
