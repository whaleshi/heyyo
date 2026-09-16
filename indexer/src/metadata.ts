import { ipfsGateway } from '../../shared/ipfs.ts';
import type { Pool } from 'pg';
import type { IndexerConfig } from './config.ts';
import { safeImage } from './list.ts';
export function metadataUrl(uri: string): string | null {
  // Fetch only content-addressed uploads via a fixed gateway, never arbitrary server URLs.
  const match = /^ipfs:\/\/([a-zA-Z0-9]{20,120})$/.exec(uri);
  return match ? `${ipfsGateway}${match[1]}` : null;
}
export async function fetchMetadata(uri: string, request: typeof fetch = fetch) {
  const url = metadataUrl(uri);
  if (!url) throw new Error('Unsupported metadata URI');
  const response = await request(url, { redirect:'error', signal:AbortSignal.timeout(30000) });
  if (!response.ok || !response.body || Number(response.headers.get('content-length') ?? 0) > 65536) throw new Error('Metadata unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[]=[]; let size=0;
  try {
    while (true) {
      const {value,done}=await reader.read(); if(done) break;
      size+=value.length; if(size>65536) throw new Error('Metadata too large'); chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset=0;
  for(const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length; }
  const data=JSON.parse(new TextDecoder().decode(bytes));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid metadata');
  const image=safeImage(data.image);
  if (!image) throw new Error('No valid metadata image');
  return { image, description: typeof data.description === 'string' ? data.description.slice(0,4000) : '' };
}
export async function enrichMetadata(pool: Pool, config: IndexerConfig) {
  const rows=await pool.query<{token_address:string;metadata_uri:string}>(`SELECT token_address,metadata_uri FROM heyyo_tokens
    WHERE chain_id=$1 AND deployment_id=$2 AND image IS NULL AND metadata_uri IS NOT NULL
    AND (metadata_checked_at IS NULL OR metadata_checked_at < now()-interval '1 minute')
    ORDER BY metadata_checked_at NULLS FIRST,created_block LIMIT 5`,[config.chainId,config.deploymentId]);
  await Promise.all(rows.rows.map(async token=>{
    await pool.query('UPDATE heyyo_tokens SET metadata_checked_at=now() WHERE chain_id=$1 AND token_address=$2',[config.chainId,token.token_address]);
    try {
      const data=await fetchMetadata(token.metadata_uri);
      await pool.query(`UPDATE heyyo_tokens SET image=$3,description=$4,updated_at=now()
        WHERE chain_id=$1 AND token_address=$2 AND metadata_uri=$5`,[config.chainId,token.token_address,data.image,data.description,token.metadata_uri]);
    } catch { /* Metadata failures are retried independently and never invalidate chain events. */ }
  }));
}
