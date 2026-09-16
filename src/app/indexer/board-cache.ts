import { fetchTokenList, parseTokenList } from './api';
import { chainId, agentAddress } from '../../../shared/contracts';
import type { BoardData } from './use-indexed-tokens';
import type { TokenSort, TokenStage } from '../../../shared/indexer';
const ttl = 5 * 60 * 1000;
const storageKey = `heyyo-board-v3:${chainId}:${agentAddress}:${import.meta.env?.VITE_INDEXER_API_URL ?? '/api'}`;
const memory = new WeakMap<typeof fetchTokenList, Map<string, {data:BoardData; savedAt:number}>>();
export function readBoardCache(key:string, loader:typeof fetchTokenList):BoardData|null {
  const hit=memory.get(loader)?.get(key);
  if(hit && Date.now()-hit.savedAt<ttl) return hit.data;
  if(loader!==fetchTokenList) return null;
  try {
    const item=JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    if(!item || item.key!==key || typeof item.savedAt!=='number' || item.savedAt>Date.now() || Date.now()-item.savedAt>=ttl) return null;
    const [query,sort,...pages]=JSON.parse(key) as [string,TokenSort,number,number,number];
    const data={} as BoardData;
    (['new','soon','graduated'] as TokenStage[]).forEach((stage,i)=>{
      data[stage]=parseTokenList({success:true,data:item.data[stage]},{stage,sort,query,page:pages[i],pageSize:12});
    });
    return data;
  } catch {return null;}
}
export function writeBoardCache(key:string,data:BoardData,loader:typeof fetchTokenList) {
  let cache=memory.get(loader);if(!cache){cache=new Map();memory.set(loader,cache);}
  if(cache.size>=20) cache.delete(cache.keys().next().value!);
  const savedAt=Date.now();cache.set(key,{data,savedAt});
  if(loader===fetchTokenList) try {sessionStorage.setItem(storageKey,JSON.stringify({key,data,savedAt}));} catch { /* Storage is optional. */ }
}
