import { setTimeout as delay } from 'node:timers/promises';
export type Block = { number: bigint; hash: string; parentHash: string; timestamp: number };
export interface ChainReader { chainId(): Promise<number>; head(): Promise<bigint>; block(number: bigint): Promise<Block> }
export class RpcClient implements ChainReader {
  private nextRequestAt = 0;
  private preferred = 0;
  private readonly urls: string[];
  constructor(url: string) { this.urls = url.split(',').map(value=>value.trim()).filter(Boolean); }
  private pending: { method: string; params: unknown[]; resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
  private scheduled = false;
  request<T>(method: string, params: unknown[]): Promise<T> {
    return new Promise<T>((resolve,reject) => {
      this.pending.push({method,params,resolve,reject});
      if (!this.scheduled) {
        this.scheduled=true;
        setTimeout(() => { this.scheduled=false; const jobs=this.pending.splice(0); void this.flush(jobs); },0);
      }
    });
  }
  private async flush(jobs: typeof this.pending) {
    const first=this.preferred;
    let remaining=jobs.map((job,i)=>({...job,id:i+1}));
    for (let attempt=0; attempt<this.urls.length*3; attempt++) {
      const index=(first+attempt)%this.urls.length;
      const scheduled=Math.max(Date.now(),this.nextRequestAt);
      this.nextRequestAt=scheduled+300;
      await delay(Math.max(0,scheduled-Date.now()));
      const requests=remaining.map(({id,method,params})=>({jsonrpc:'2.0',id,method,params}));
      try {
        const response=await fetch(this.urls[index],{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(requests.length===1?requests[0]:requests),signal:AbortSignal.timeout(8000)});
        if(response.ok){
          const json=await response.json();
          const replies=Array.isArray(json)?json:[json];
          remaining=remaining.filter(job=>{
            const reply=replies.find(item=>item?.id===job.id);
            if(reply && !reply.error && reply.result!==undefined && reply.result!==null){job.resolve(reply.result);return false;}
            return true;
          });
          if(!remaining.length){this.preferred=index;return;}
        } else {await response.body?.cancel();}
      } catch { /* Retry without exposing response bodies or credentials. */ }
      if((attempt+1)%this.urls.length===0 && attempt+1<this.urls.length*3) await delay(1000*2**Math.floor(attempt/this.urls.length));
    }
    for(const job of remaining) job.reject(new Error(`RPC ${job.method} failed after endpoint retries`));
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
