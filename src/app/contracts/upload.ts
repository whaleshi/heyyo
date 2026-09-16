const base = (import.meta.env?.VITE_INDEXER_API_URL ?? '/api').replace(/\/$/, '');
async function upload(path: string, body: BodyInit, headers?: HeadersInit, signal?: AbortSignal) {
  const response = await fetch(`${base}/ipfs/${path}`, { method: 'POST', body, headers,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
  const payload = await response.json();
  if (!response.ok || typeof payload.cid !== 'string' || !/^[a-zA-Z0-9]{20,120}$/.test(payload.cid)) throw new Error('Upload failed');
  return payload.cid as string;
}
export function pinFile(file: File, signal?: AbortSignal) {
  const body = new FormData(); body.append('file', file);
  return upload('pin-file', body, undefined, signal);
}
export function pinMetadata(metadata: Record<string,string>, signal?: AbortSignal) {
  return upload('pin-json', JSON.stringify(metadata), { 'Content-Type': 'application/json' }, signal);
}
