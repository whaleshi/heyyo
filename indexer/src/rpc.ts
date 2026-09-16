export type Block = { number: bigint; hash: string; parentHash: string; timestamp: number };
export interface ChainReader { chainId(): Promise<number>; head(): Promise<bigint>; block(number: bigint): Promise<Block> }
export class RpcClient implements ChainReader {
  constructor(private readonly url: string) {}
  async request<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const json = await response.json() as { error?: unknown; result?: T };
    if (json.error || json.result === undefined || json.result === null) throw new Error(`RPC ${method} failed`);
    return json.result;
  }
  async chainId() { return Number(BigInt(await this.request<string>('eth_chainId', []))); }
  async head() { return BigInt(await this.request<string>('eth_blockNumber', [])); }
  async block(number: bigint): Promise<Block> {
    const raw = await this.request<{ number: string; hash: string; parentHash: string; timestamp: string }>('eth_getBlockByNumber', [`0x${number.toString(16)}`, false]);
    if (BigInt(raw.number) !== number || !/^0x[0-9a-fA-F]{64}$/.test(raw.hash) || !/^0x[0-9a-fA-F]{64}$/.test(raw.parentHash)) throw new Error('Invalid RPC block');
    const timestamp = Number(BigInt(raw.timestamp));
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid block timestamp');
    return { number, hash: raw.hash.toLowerCase(), parentHash: raw.parentHash.toLowerCase(), timestamp };
  }
}
