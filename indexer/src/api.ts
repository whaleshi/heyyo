import { getPlatformStats } from './platform.ts';
import { getWalletRewards, getWalletClaims } from './rewards.ts';
import { readConfig, hasSourceConfig } from './config.ts';
import { createPool } from './db.ts';
import { contractAdapterReady } from './adapters/heyyo.ts';
import { getTokenList } from './list.ts';
import { createApiServer } from './http.ts';

const config = readConfig();
const configured = hasSourceConfig(config) && contractAdapterReady;
// Missing contract configuration must not require database access just to serve the status.
const pool = configured && config.databaseUrl ? createPool(config.databaseUrl) : null;
const server = createApiServer({ configured, platform: async () => {
  if (!pool) throw new Error('Database is unavailable');
  return getPlatformStats(pool,config);
}, rewards: async address => {
  if (!pool) throw new Error('Database is unavailable');
  return getWalletRewards(pool,config,address);
}, claims: async address => {
  if (!pool) throw new Error('Database is unavailable');
  return getWalletClaims(pool,config,address);
}, list: async query => {
  if (!pool) throw new Error('Database is unavailable');
  return getTokenList(pool,config,query);
} });
server.listen(config.port,'127.0.0.1',() => console.log(`Heyyo index API: http://127.0.0.1:${config.port}${configured ? '' : ' (contract pending)'}`));
const stop = () => { server.close(() => { void pool?.end(); }); };
process.once('SIGTERM',stop); process.once('SIGINT',stop);
