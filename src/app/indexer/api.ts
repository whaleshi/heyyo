import type { IndexedToken, TokenList, TokenListQuery } from '../../../shared/indexer';

export class IndexerRequestError extends Error {
  constructor(public readonly code: string) { super(code); }
}
const address = /^0x[0-9a-fA-F]{40}$/;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
const optionalMetric = (v: unknown, signed = false) => v === null || (finite(v) && (signed || v >= 0));
function isToken(v: unknown): v is IndexedToken {
  return object(v) && typeof v.id === 'string' && integer(v.chainId) && v.chainId > 0
    && typeof v.contractAddress === 'string' && address.test(v.contractAddress)
    && v.id === `${v.chainId}-${v.contractAddress}`
    && typeof v.launchAddress === 'string' && address.test(v.launchAddress)
    && typeof v.creatorAddress === 'string' && address.test(v.creatorAddress)
    && typeof v.name === 'string' && typeof v.ticker === 'string' && typeof v.description === 'string'
    && (v.image === undefined || (typeof v.image === 'string' && /^https:\/\//.test(v.image)))
    && integer(v.createdAt) && v.createdAt <= 8640000000000000
    && ['new','soon','graduated'].includes(String(v.stage))
    && (v.progress === null || (finite(v.progress) && v.progress >= 0 && v.progress <= 100))
    && optionalMetric(v.marketCap) && optionalMetric(v.volume) && optionalMetric(v.change,true);
}
export function parseTokenList(value: unknown, query: TokenListQuery): TokenList {
  if (!object(value) || value.success !== true || !object(value.data)) throw new IndexerRequestError('INVALID_RESPONSE');
  const data = value.data;
  if (!Array.isArray(data.items) || !data.items.every(isToken)
    || data.items.some(t => t.stage !== query.stage)
    || new Set(data.items.map(t => t.id)).size !== data.items.length
    || data.items.length > query.pageSize || data.page !== query.page || data.pageSize !== query.pageSize
    || !integer(data.total) || data.total < data.items.length
    || !object(data.counts) || !['new','soon','graduated'].every(stage => integer((data.counts as Record<string,unknown>)[stage]))
    || data.counts[query.stage] !== data.total
    || typeof data.indexedBlock !== 'string' || !/^\d+$/.test(data.indexedBlock)
    || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) throw new IndexerRequestError('INVALID_RESPONSE');
  return data as unknown as TokenList;
}
export async function fetchTokenList(query: TokenListQuery, signal: AbortSignal): Promise<TokenList> {
  const base = (import.meta.env?.VITE_INDEXER_API_URL ?? '/api').replace(/\/+$/,'');
  const params = new URLSearchParams({stage:query.stage,sort:query.sort,query:query.query,page:String(query.page),pageSize:String(query.pageSize)});
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort',abort,{once:true});
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort,10000);
  try {
    const response = await fetch(`${base}/tokens?${params}`, { signal:controller.signal, headers:{Accept:'application/json'} });
    const body: unknown = await response.json();
    if (!response.ok) throw new IndexerRequestError(object(body) && typeof body.code === 'string' ? body.code : 'INDEXER_UNAVAILABLE');
    return parseTokenList(body,query);
  } finally { clearTimeout(timer); signal.removeEventListener('abort',abort); }
}
