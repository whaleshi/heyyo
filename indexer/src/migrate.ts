import { readFile } from 'node:fs/promises';
import { readConfig } from './config.ts';
import { createPool } from './db.ts';

const pool = createPool(readConfig().databaseUrl);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('heyyo:migrations'))");
  await client.query(await readFile(new URL('../sql/001-initial.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Heyyo database schema is ready.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally { client.release(); await pool.end(); }
