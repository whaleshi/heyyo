import { useEffect, useState } from 'react';
import { platformTokenAddress, burnAddress, type PlatformStats } from '../../../shared/platform';
let cached: PlatformStats | null = null;
export function usePlatformStats(enabled: boolean) {
  const [stats,setStats]=useState(cached);
  useEffect(()=>{
    if (!enabled) return;
    let stopped=false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function refresh() {
      controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),10000);
      try {
        const base=(import.meta.env.VITE_INDEXER_API_URL ?? '/api').replace(/\/+$/,'');
        const response=await fetch(`${base}/platform`,{signal:controller.signal});
        const body=await response.json(), data=body.data as PlatformStats;
        if (!response.ok || !body.success || data?.tokenAddress!==platformTokenAddress || data.burnAddress!==burnAddress
          || ![data.burnedHeyyo,data.creatorRewardsUsdc].every(v=>typeof v==='string' && /^\d+(\.\d+)?$/.test(v))) throw new Error('Invalid platform response');
        if (!stopped) {cached=data;setStats(data);}
      } catch { /* Keep the last successful snapshot during transient API failures. */ }
      finally { clearTimeout(timeout);if(!stopped)timer=setTimeout(refresh,5000); }
    }
    void refresh();
    return ()=>{stopped=true;clearTimeout(timer);controller?.abort();};
  },[enabled]);
  return stats;
}
export const platformAmount = (value?: string) => value ? Number(value).toLocaleString('en-US',{maximumFractionDigits:2}) : '0';
