import { syncMarkets } from './market.ts';
import { syncRewards } from './rewards.ts';
import { enrichMetadata } from './metadata.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig, hasSourceConfig } from './config.ts';
import { createPool } from './db.ts';
import { RpcClient } from './rpc.ts';
import { createHeyyoAdapter, contractAdapterReady } from './adapters/heyyo.ts';
import { scanOnce, ReorgError } from './scanner.ts';

const config = readConfig();
if (!hasSourceConfig(config) || !contractAdapterReady) {
  console.error('CONTRACT_NOT_CONFIGURED: configure the deployment RPC before indexing.');
  process.exitCode = 1;
} else {
  const rpc = new RpcClient(config.rpcUrl);
  if (await rpc.chainId() !== config.chainId) throw new Error('RPC chain does not match INDEXER_CHAIN_ID');
  const adapter = createHeyyoAdapter(config, rpc);
  const pool = createPool(config.databaseUrl);
  const client = await pool.connect();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1,hashtext($2)) AS locked', [config.chainId,config.deploymentId]);
    if (!lock.rows[0]?.locked) throw new Error('An indexer already owns this Heyyo deployment');
    let failures = 0;
    let metadataTask: Promise<void> | undefined;
    do {
      try {
        const advanced = await scanOnce(client, config, rpc, adapter);
        await syncRewards(pool, config, rpc);
        await syncMarkets(pool, config, rpc);

        failures = 0;
        if (!advanced && !process.argv.includes('--once')) await delay(config.pollInterval);
      } catch (error) {
        if (error instanceof ReorgError) {
          await client.query('UPDATE heyyo_cursor SET halted=true WHERE chain_id=$1 AND deployment_id=$2',[config.chainId,config.deploymentId]);
          throw error;
        }
        if (process.argv.includes('--once')) throw error;
        // Avoid logging connection strings, metadata, or arbitrary RPC response bodies.
        console.error('Indexing or reward synchronization failed; retaining committed data and retrying.');
        await delay(Math.min(15000, 1000 * 2 ** Math.min(failures++, 4)));
      } finally {
        if (!metadataTask) metadataTask = enrichMetadata(pool, config).catch(() => console.error('Metadata enrichment will retry.')).finally(() => { metadataTask = undefined; });
      }
    } while (!stopping && !process.argv.includes('--once'));
    await metadataTask;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1,hashtext($2))', [config.chainId,config.deploymentId]).catch(() => {});
    client.release(); await pool.end();
  }
}
