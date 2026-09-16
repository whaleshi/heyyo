import type { IncomingMessage, ServerResponse } from 'node:http';
const maxFileBytes = 2 * 1024 * 1024;
export function validImage(bytes: Uint8Array, mime: string) {
  const starts = (expected: number[], offset=0) => expected.every((v,i) => bytes[i+offset] === v);
  return mime === 'image/png' ? starts([137,80,78,71,13,10,26,10]) : mime === 'image/jpeg' ? starts([255,216,255])
    : mime === 'image/webp' && starts([82,73,70,70]) && starts([87,69,66,80],8);
}
export function sanitizeMetadata(input: unknown): Record<string,string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string,unknown>;
  const limits: Record<string,number> = { name:40,symbol:10,description:280,image:140,website:300,x:300,telegram:300 };
  const result: Record<string,string> = {};
  for (const [key,limit] of Object.entries(limits)) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return null;
    const text = ((value[key] ?? '') as string).trim();
    if (text.length > limit) return null;
    result[key] = text;
  }
  if (!result.name || !/^[A-Z0-9]{1,10}$/.test(result.symbol) || !/^ipfs:\/\/[a-zA-Z0-9]{20,120}$/.test(result.image)) return null;
  for (const key of ['website','x','telegram']) {
    if (!result[key]) continue;
    try { const url = new URL(result[key]); if (!['https:','http:'].includes(url.protocol) || url.username || url.password) return null; } catch { return null; }
  }
  return result;
}
export function createUploadHandler(getJwt: () => string | undefined = () => process.env.PINATA_JWT, upstream: typeof fetch = fetch) {
  const limits = new Map<string,{count:number;until:number}>();
  return async (request: IncomingMessage, response: ServerResponse) => {
    const send = (status:number, body:unknown) => { response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); response.end(JSON.stringify(body)); };
    if (request.method !== 'POST') { response.setHeader('Allow','POST'); send(405,{message:'Method not allowed'}); return; }
    if (request.headers.origin) {
      try { if (new URL(request.headers.origin).host !== request.headers.host) { send(403,{message:'Invalid origin'}); return; } } catch { send(403,{message:'Invalid origin'}); return; }
    }
    const now = Date.now();
    for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    const ip = request.socket.remoteAddress ?? 'local';
    const usage = limits.get(ip) ?? {count:0,until:now+60000}; usage.count++; limits.set(ip,usage);
    if (usage.count > 10) { send(429,{message:'Please retry later'}); return; }
    const jwt = getJwt()?.trim();
    if (!jwt) { send(503,{message:'Upload service is not configured'}); return; }
    const isFile = request.url?.split('?')[0] === '/api/ipfs/pin-file';
    const maxBytes = isFile ? maxFileBytes + 65536 : 8192;
    if (Number(request.headers['content-length'] ?? 0) > maxBytes) { send(413,{message:'Upload too large'}); return; }
    let upstreamBody: BodyInit;
    let headers: Record<string,string> = {Authorization:`Bearer ${jwt}`};
    try {
      const chunks: Buffer[] = []; let size=0;
      for await (const chunk of request) { size += chunk.length; if (size > maxBytes) { send(413,{message:'Upload too large'}); return; } chunks.push(Buffer.from(chunk)); }
      const bytes = Buffer.concat(chunks);
      if (isFile) {
        const form = await new Response(bytes, {headers:{'Content-Type':request.headers['content-type'] ?? ''}}).formData();
        const file = form.get('file');
        if (!(file instanceof File) || !file.size || file.size > maxFileBytes || !validImage(new Uint8Array(await file.slice(0,12).arrayBuffer()),file.type)) { send(400,{message:'Invalid image'}); return; }
        const body = new FormData(); body.append('file',file); upstreamBody = body;
      } else {
        const metadata = sanitizeMetadata(JSON.parse(bytes.toString('utf8')));
        if (!metadata) { send(400,{message:'Invalid metadata'}); return; }
        upstreamBody = JSON.stringify(metadata); headers = {...headers,'Content-Type':'application/json'};
      }
    } catch { send(400,{message:'Invalid upload'}); return; }
    try {
      const upstreamResponse = await upstream(`https://api.pinata.cloud/pinning/${isFile ? 'pinFileToIPFS' : 'pinJSONToIPFS'}`, {method:'POST',headers,body:upstreamBody,signal:AbortSignal.timeout(45000)});
      const data = await upstreamResponse.json() as {IpfsHash?: string};
      if (!upstreamResponse.ok || typeof data.IpfsHash !== 'string' || !/^[a-zA-Z0-9]{20,120}$/.test(data.IpfsHash)) throw new Error('Pin failed');
      send(200,{cid:data.IpfsHash});
    } catch { send(502,{message:'Unable to upload. Please retry.'}); }
  };
}
