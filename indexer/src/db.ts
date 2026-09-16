import pg from 'pg';
export function createPool(databaseUrl: string) {
  if (!databaseUrl) throw new Error('INDEXER_DATABASE_URL is required');
  return new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, statement_timeout: 10000, query_timeout: 12000 });
}
