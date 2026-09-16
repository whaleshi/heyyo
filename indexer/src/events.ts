// Contract-specific ABI decoding ends at this boundary. Amounts remain decimal strings.
export type EventBase = {
  blockNumber: bigint; blockHash: string; txHash: string; logIndex: number;
  tokenAddress: string; sourceAddress: string;
};
export type Snapshot = { priceUsd: string | null; quoteReserveRaw: string };
export type IndexEvent = EventBase & (
  | { kind: 'created'; launchAddress: string; creatorAddress: string; name: string; ticker: string;
      description: string; image: string | null; metadataUri: string | null;
      totalSupplyRaw: string; tokenDecimals: number; quoteDecimals: number; quoteSymbol: string; graduationTargetRaw: string | null; launchId?: string }
  | { kind: 'protocol'; eventName: string; args: Record<string, string> }
  | { kind: 'trade'; side: 'buy' | 'sell'; quoteAmountRaw: string; snapshot: Snapshot }
  | { kind: 'graduated'; poolAddress: string | null; snapshot: Snapshot }
  | { kind: 'price'; snapshot: Snapshot }
);
export type KnownToken = { tokenAddress: string; launchAddress: string; poolAddress: string | null };
export const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const unsigned = (value: string) => typeof value === 'string' && /^\d{1,78}$/.test(value);
const positive = (value: string) => unsigned(value) && BigInt(value) > 0n;
export function validateEvent(event: IndexEvent) {
  if (!addressPattern.test(event.tokenAddress) || !addressPattern.test(event.sourceAddress)
    || !hashPattern.test(event.txHash) || !hashPattern.test(event.blockHash)
    || typeof event.blockNumber !== 'bigint' || event.blockNumber < 0n
    || !Number.isSafeInteger(event.logIndex) || event.logIndex < 0) throw new Error('Invalid event identity');
  if (event.kind === 'created') {
    if (!addressPattern.test(event.creatorAddress) || !addressPattern.test(event.launchAddress)
      || !positive(event.totalSupplyRaw) || (event.graduationTargetRaw !== null && !positive(event.graduationTargetRaw))
      || ![event.tokenDecimals, event.quoteDecimals].every(v => Number.isInteger(v) && v >= 0 && v <= 36)
      || typeof event.quoteSymbol !== 'string' || event.quoteSymbol.length > 64 || typeof event.name !== 'string' || event.name.length > 256
      || typeof event.ticker !== 'string' || event.ticker.length > 64
      || typeof event.description !== 'string' || event.description.length > 4000
      || (event.image !== null && (typeof event.image !== 'string' || event.image.length > 2048))
      || (event.metadataUri !== null && (typeof event.metadataUri !== 'string' || event.metadataUri.length > 2048))) throw new Error('Invalid created token');
  } else if (event.kind === 'protocol') {
    if (!['BuybackExecuted', 'TargetLaunchConfigured', 'CreatorFeeAccrued', 'CreatorFeeClaimed', 'CreatorFeeDistributed', 'InitialBuyExecuted'].includes(event.eventName)) throw new Error('Unknown Agent event');
  } else {
    if (!['trade', 'graduated', 'price'].includes(event.kind)) throw new Error('Unknown event kind');
    if (!unsigned(event.snapshot.quoteReserveRaw)
      || (event.snapshot.priceUsd !== null && (!/^\d{1,78}(\.\d{1,78})?$/.test(event.snapshot.priceUsd)
      || !Number.isFinite(Number(event.snapshot.priceUsd)) || Number(event.snapshot.priceUsd) <= 0))) throw new Error('Invalid price snapshot');
    if (event.kind === 'trade' && (!['buy', 'sell'].includes(event.side) || !unsigned(event.quoteAmountRaw))) throw new Error('Invalid trade');
    if (event.kind === 'graduated' && event.poolAddress !== null && !addressPattern.test(event.poolAddress)) throw new Error('Invalid pool');
  }
}
export function orderEvents(events: IndexEvent[]) {
  return [...events].sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1);
}
