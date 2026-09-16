import { ipfsGateway } from '../../shared/ipfs.ts';
import type { Pool } from 'pg';
import type { IndexedToken, TokenList, TokenListQuery } from '../../shared/indexer.ts';
import type { IndexerConfig } from './config.ts';

export function parseListQuery(params: URLSearchParams): TokenListQuery {
  const stage = params.get('stage') ?? 'new';
  const sort = params.get('sort') ?? 'recent';
  const query = (params.get('query') ?? '').trim();
  const page = params.get('page') ?? '1';
  const pageSize = params.get('pageSize') ?? '12';
  if (!['new','soon','graduated'].includes(stage) || !['recent','market','volume'].includes(sort)
    || query.length > 64 || !/^[1-9]\d{0,4}$/.test(page) || Number(page) > 10000
    || !/^[1-9]\d?$/.test(pageSize) || Number(pageSize) > 50) throw new Error('INVALID_QUERY');
  return { stage: stage as TokenListQuery['stage'], sort: sort as TokenListQuery['sort'], query, page: Number(page), pageSize: Number(pageSize) };
}
export function safeImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  const uri = value.trim();
  if (uri.startsWith('ipfs://')) {
    const path = uri.slice(7).replace(/^ipfs\//, '');
    if (!path || /[?#\\]/.test(path) || path.split('/').some(s => s === '..' || s === '.')) return undefined;
    return `${ipfsGateway}${path}`;
  }
  try { const url = new URL(uri); if (url.protocol === 'https:' && !url.username && !url.password && ['ipfs.io','gateway.pinata.cloud'].includes(url.hostname) && url.pathname.startsWith('/ipfs/')) return `${ipfsGateway}${url.pathname.slice(6)}${url.search}${url.hash}`; return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

type Row = {
  token_address: string; launch_address: string; creator_address: string; name: string; ticker: string;
  image: string | null; description: string; created_timestamp: string; stage: IndexedToken['stage'];
  progress: string; market_cap: string | null; change: string | null; volume: string | null;
};
export function tokenFromRow(row: Row, chainId: number): IndexedToken {
  return { id: `${chainId}-${row.token_address}`, chainId, contractAddress: row.token_address,
    launchAddress: row.launch_address, creatorAddress: row.creator_address, name: row.name || row.token_address,
    ticker: row.ticker || '—', description: row.description, image: safeImage(row.image),
    createdAt: Number(row.created_timestamp) * 1000, stage: row.stage, progress: numeric(row.progress),
    marketCap: numeric(row.market_cap), change: numeric(row.change), volume: numeric(row.volume) };
}

// Query scope is always the independently configured Heyyo deployment. No Ayoo tables are read.
export const listSql = `
WITH eligible AS (
  SELECT t.*,
    CASE WHEN graduated THEN 'graduated' WHEN quote_reserve_raw / graduation_target_raw >= 0.65 THEN 'soon' ELSE 'new' END AS stage,
    CASE WHEN graduated THEN 100 WHEN graduation_target_raw IS NULL THEN NULL ELSE LEAST(100, quote_reserve_raw / graduation_target_raw * 100) END AS progress,
    price_usd * total_supply_raw / power(10::numeric,token_decimals) AS market_cap,
    CASE WHEN price_usd IS NULL THEN NULL ELSE (SELECT COALESCE(sum(quote_amount_raw),0) FROM heyyo_trades tr WHERE tr.chain_id=t.chain_id AND tr.token_address=t.token_address
      AND tr.event_timestamp >= extract(epoch FROM now()-interval '24 hours')) / power(10::numeric,quote_decimals) END AS volume,
    COALESCE(
      (SELECT price_usd FROM heyyo_prices p WHERE p.chain_id=t.chain_id AND p.token_address=t.token_address
       AND p.event_timestamp <= extract(epoch FROM now()-interval '24 hours') ORDER BY event_timestamp DESC,block_number DESC,log_index DESC LIMIT 1),
      (SELECT price_usd FROM heyyo_prices p WHERE p.chain_id=t.chain_id AND p.token_address=t.token_address
       AND t.created_timestamp >= extract(epoch FROM now()-interval '24 hours') ORDER BY event_timestamp,block_number,log_index LIMIT 1)
    ) AS baseline
  FROM heyyo_tokens t WHERE chain_id=$1 AND deployment_id=$2
    AND ($3='' OR strpos(lower(name || ' ' || ticker || ' ' || token_address),lower($3)) > 0)
), selected AS (
  SELECT *,CASE WHEN baseline>0 AND price_usd IS NOT NULL THEN (price_usd-baseline)/baseline*100 ELSE NULL END AS change
  FROM eligible WHERE stage=$4
  ORDER BY CASE WHEN $5='market' THEN market_cap END DESC NULLS LAST,
    CASE WHEN $5='volume' THEN volume END DESC NULLS LAST,
    created_block DESC,created_log_index DESC,token_address
  LIMIT $6 OFFSET $7
)
SELECT COALESCE((SELECT jsonb_agg(to_jsonb(selected)) FROM selected),'[]'::jsonb) AS items,
  (SELECT count(*) FROM eligible WHERE stage=$4)::integer AS total,
  jsonb_build_object('new',(SELECT count(*) FROM eligible WHERE stage='new'),
    'soon',(SELECT count(*) FROM eligible WHERE stage='soon'),'graduated',(SELECT count(*) FROM eligible WHERE stage='graduated')) AS counts,
  cursor.last_block::text AS indexed_block,cursor.updated_at
FROM heyyo_cursor cursor WHERE chain_id=$1 AND deployment_id=$2 AND NOT halted`;

export async function getTokenList(pool: Pool, config: IndexerConfig, query: TokenListQuery): Promise<TokenList | null> {
  const result = await pool.query<{ items: Row[]; total: number; counts: TokenList['counts']; indexed_block: string; updated_at: Date }>(
    listSql, [config.chainId,config.deploymentId,query.query,query.stage,query.sort,query.pageSize,(query.page-1)*query.pageSize]);
  const row = result.rows[0];
  if (!row) return null;
  return { items: row.items.map(item => tokenFromRow(item,config.chainId)), page:query.page,pageSize:query.pageSize,
    total:row.total,counts:row.counts,indexedBlock:row.indexed_block,updatedAt:new Date(row.updated_at).toISOString() };
}
