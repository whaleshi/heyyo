import { createUploadHandler } from './uploads.ts';
import { createServer, type ServerResponse } from 'node:http';
import type { TokenList, TokenListQuery } from '../../shared/indexer.ts';
import { parseListQuery } from './list.ts';

export function createApiServer(options: { configured: boolean; platform?: () => Promise<unknown>; rewards?: (address: string) => Promise<unknown>; claims?: (address: string) => Promise<unknown>; list: (query: TokenListQuery) => Promise<TokenList | null> }) {
  function send(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
    response.end(JSON.stringify(body));
  }
  const upload = createUploadHandler();
  const server = createServer(async (request,response) => {
    if (['/api/ipfs/pin-file','/api/ipfs/pin-json'].includes((request.url ?? '').split('?')[0])) { await upload(request,response); return; }
    if (request.method !== 'GET') { response.setHeader('Allow','GET'); send(response,405,{success:false,code:'METHOD_NOT_ALLOWED'}); return; }
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/platform') {
      if (!options.configured) { send(response,503,{success:false,code:'CONTRACT_NOT_CONFIGURED'}); return; }
      try {
        const data=await options.platform?.();
        send(response,data?200:503,data?{success:true,data}:{success:false,code:'INDEXER_NOT_READY'});
      } catch { send(response,503,{success:false,code:'INDEXER_UNAVAILABLE'}); }
      return;
    }
    const walletRoute = /^\/api\/wallets\/([^/]+)\/(rewards|claims)$/.exec(url.pathname);
    if (walletRoute) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(walletRoute[1])) { send(response,400,{success:false,code:'INVALID_ADDRESS'}); return; }
      if (!options.configured) { send(response,503,{success:false,code:'CONTRACT_NOT_CONFIGURED'}); return; }
      try {
        const handler=walletRoute[2]==='rewards'?options.rewards:options.claims;
        const data=await handler?.(walletRoute[1].toLowerCase());
        if (!data) { send(response,503,{success:false,code:'INDEXER_NOT_READY'}); return; }
        send(response,200,{success:true,data});
      } catch { send(response,503,{success:false,code:'INDEXER_UNAVAILABLE'}); }
      return;
    }
    if (url.pathname !== '/api/tokens' && url.pathname !== '/api/health') { send(response,404,{success:false,code:'NOT_FOUND'}); return; }
    if (!options.configured) { send(response,503,{success:false,code:'CONTRACT_NOT_CONFIGURED'}); return; }
    let query;
    try { query = parseListQuery(url.searchParams); } catch { send(response,400,{success:false,code:'INVALID_QUERY'}); return; }
    try {
      const data = await options.list(query);
      if (!data) { send(response,503,{success:false,code:'INDEXER_NOT_READY'}); return; }
      send(response,200,{success:true,data:url.pathname === '/api/health' ? {indexedBlock:data.indexedBlock,updatedAt:data.updatedAt} : data});
    } catch {
      send(response,503,{success:false,code:'INDEXER_UNAVAILABLE'});
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
