import { setTimeout as delay } from 'node:timers/promises';
export type Block = { number: bigint; hash: string; parentHash: string; timestamp: number };
export interface ChainReader { chainId(): Promise<number>; head(): Promise<bigint>; block(number: bigint): Promise<Block> }
export class RpcClient implements ChainReader {
  private nextRequestAt = 0;
  private preferred = 0;
  private readonly urls: string[];
  constructor(url: string) { this.urls = url.split(',').map(value=>value.trim()).filter(Boolean); }
  async request<T>(method: string, params: unknown[]): Promise<T> {
    const first=this.preferred;
    for (let attempt=0; attempt<this.urls.length*3; attempt++) {
      const index=(first+attempt)%this.urls.length;
      const scheduled=Math.max(Date.now(),this.nextRequestAt);
      this.nextRequestAt=scheduled+300;
      await delay(Math.max(0,scheduled-Date.now()));
      try {
        const response=await fetch(this.urls[index],{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8000)});
        if(response.ok){
          const json=await response.json() as {error?:unknown;result?:T};
          if(!json.error && json.result!==undefined && json.result!==null){this.preferred=index;return json.result;}
        } else {await response.body?.cancel();}
      } catch { /* Try the alternate read-only endpoint without exposing response bodies or credentials. */ }
      if((attempt+1)%this.urls.length===0 && attempt+1<this.urls.length*3) await delay(1000*2**Math.floor(attempt/this.urls.length));
    }
    throw new Error(`RPC ${method} failed after endpoint retries`);
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
