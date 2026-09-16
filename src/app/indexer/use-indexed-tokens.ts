import { readBoardCache, writeBoardCache } from './board-cache';
import { useEffect, useState } from 'react';
import type { TokenList, TokenSort, TokenStage } from '../../../shared/indexer';
import { fetchTokenList, IndexerRequestError } from './api';

export const stages: TokenStage[] = ['new','soon','graduated'];
export type BoardPages = Record<TokenStage,number>;
export type BoardData = Record<TokenStage,TokenList>;
export function useIndexedTokens(query: string, sort: TokenSort, pages: BoardPages, loader = fetchTokenList, interval = 3000) {
  const key = JSON.stringify([query,sort,pages.new,pages.soon,pages.graduated]);
  const [retry, setRetry] = useState(0);
  const [snapshot,setSnapshot] = useState<{ key: string; data: BoardData | null; error: string | null; loading: boolean }>(() => ({key,data:readBoardCache(key,loader),error:null,loading:true}));
  useEffect(() => {
    let stopped = false;
    let active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const [search,order,newPage,soonPage,graduatedPage] = JSON.parse(key) as [string,TokenSort,number,number,number];
    const pageNumbers = {new:newPage,soon:soonPage,graduated:graduatedPage};
    async function refresh() {
      if (stopped || active) return;
      const controller = new AbortController();
      active = controller;
      setSnapshot(current => ({key,data:current.key===key ? current.data : readBoardCache(key,loader),error:null,loading:true}));
      try {
        const results = await Promise.all(stages.map(stage => loader({stage,sort:order,query:search,page:pageNumbers[stage],pageSize:12},controller.signal)));
        if (!stopped) {
          const data={new:results[0],soon:results[1],graduated:results[2]};
          writeBoardCache(key,data,loader);
          setSnapshot({key,data,error:null,loading:false});
        }
      } catch (error) {
        controller.abort();
        if (!stopped) setSnapshot(current => ({key,data:current.key===key ? current.data : readBoardCache(key,loader),
          error:error instanceof IndexerRequestError ? error.code : 'INDEXER_UNAVAILABLE',loading:false}));
      } finally {
        active = null;
        if (!stopped && interval > 0) timer = setTimeout(() => { if (!document.hidden) void refresh(); },interval);
      }
    }
    const onVisible = () => { if (!document.hidden) { clearTimeout(timer); void refresh(); } };
    document.addEventListener('visibilitychange',onVisible);
    void refresh();
    return () => { stopped=true; clearTimeout(timer); active?.abort(); document.removeEventListener('visibilitychange',onVisible); };
  },[key,retry,loader,interval]);
  return { ...(snapshot.key===key ? snapshot : {key,data:readBoardCache(key,loader),error:null,loading:true}), retry:() => setRetry(value=>value+1) };
}
