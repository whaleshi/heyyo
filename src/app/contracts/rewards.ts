import { chainId, type SourceLaunch, type Rpc } from '../../../shared/contracts';
import { rpcUrl } from './config';
export type Reward = SourceLaunch & { image?: string; pending: bigint; pendingBuyback: bigint; claimable: bigint; claimed: bigint };
export function publicRpc(signal?: AbortSignal): Rpc {
  return { async request<T>(method: string, params: unknown[]): Promise<T> {
    if (!rpcUrl) throw new Error('Contract RPC is not configured');
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    const body = await response.json();
    if (!response.ok || body.error || body.result === undefined) throw new Error('Contract read failed');
    return body.result as T;
  } };
}
const apiBase = (import.meta.env?.VITE_INDEXER_API_URL ?? '/api').replace(/\/$/, '');
const rawAmount = (value: unknown): value is string => typeof value === 'string' && /^\d{1,78}$/.test(value);
const addressValue = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
async function walletData(address: string, resource: 'rewards' | 'claims', signal?: AbortSignal): Promise<Record<string,unknown>[]> {
  if (!addressValue(address)) throw new Error('Invalid wallet address');
  const response = await fetch(`${apiBase}/wallets/${address.toLowerCase()}/${resource}`, {
    signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true || body.data?.chainId !== chainId || body.data?.address !== address.toLowerCase()
    || !rawAmount(body.data?.indexedBlock) || !Array.isArray(body.data?.items)) throw new Error('Indexed rewards unavailable');
  return body.data.items;
}
export async function loadRewards(address: string, signal?: AbortSignal): Promise<Reward[]> {
  const items=await walletData(address,'rewards',signal);
  return items.map(item=>{
    if (!item || !rawAmount(item.launchId) || !rawAmount(item.pending) || !rawAmount(item.claimable) || !rawAmount(item.claimed) || !rawAmount(item.pendingBuyback)
      || !addressValue(item.creator) || item.creator.toLowerCase()!==address.toLowerCase()
      || !['token','launch','feeVault','paymentToken'].every(key=>addressValue(item[key]))
      || typeof item.name!=='string' || typeof item.ticker!=='string' || typeof item.paymentSymbol!=='string'
      || !Number.isInteger(item.paymentDecimals) || Number(item.paymentDecimals)<0 || Number(item.paymentDecimals)>36
      || ![0,1].includes(Number(item.paymentKind))
      || (item.image !== undefined && (typeof item.image!=='string' || !item.image.startsWith('https://')))) throw new Error('Invalid indexed reward');
    return {...item,pending:BigInt(item.pending),pendingBuyback:BigInt(item.pendingBuyback),claimable:BigInt(item.claimable),claimed:BigInt(item.claimed)} as Reward;
  });
}
export type ClaimRecord = { hash: string; logIndex: string; launchId: string; amount: bigint; asset: string; block: bigint; ticker: string; decimals: number; symbol: string };
export async function loadClaimHistory(address: string, signal?: AbortSignal): Promise<ClaimRecord[]> {
  const items=await walletData(address,'claims',signal);
  return items.map(item=>{
    if (!item || typeof item.hash!=='string' || !/^0x[0-9a-fA-F]{64}$/.test(item.hash)
      || !rawAmount(item.logIndex) || !rawAmount(item.launchId) || !rawAmount(item.block) || !rawAmount(item.amount)
      || !addressValue(item.asset) || !Number.isInteger(item.decimals) || Number(item.decimals)<0 || Number(item.decimals)>36
      || typeof item.symbol!=='string' || typeof item.ticker!=='string') throw new Error('Invalid indexed claim');
    return {...item,amount:BigInt(item.amount),block:BigInt(item.block)} as ClaimRecord;
  });
}
