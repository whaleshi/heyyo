import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createUploadHandler, sanitizeMetadata, validImage } from '../indexer/src/uploads.ts';
const cid='bafybeigdyrztq5sfp7udm7hu76uh7y26nf3odne45c6pgxvp2x5eqvqnuu';
const metadata={name:'Heyyo',symbol:'HEY',image:`ipfs://${cid}`,description:'Story',website:'https://example.com'};
async function withServer(handler, run) {
  const server=createServer(handler); server.listen(0,'127.0.0.1'); await once(server,'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}
test('metadata rejects unsafe links, data URLs and excess content',()=>{
  assert.equal(sanitizeMetadata({...metadata,website:'javascript:alert(1)'}),null);
  assert.equal(sanitizeMetadata({...metadata,image:'data:image/png;base64,abc'}),null);
  assert.equal(sanitizeMetadata({...metadata,name:'x'.repeat(41)}),null);
  assert.equal(sanitizeMetadata({...metadata,secret:'excluded'}).secret,undefined);
  assert.equal(validImage(new Uint8Array([255,216,255]),'image/png'),false);
});
test('upload service keeps JWT server-side, validates inputs and returns only CID',async()=>{
  const calls=[];
  const handler=createUploadHandler(()=> 'test-server-token',async(url,options)=>{calls.push({url,options});return Response.json({IpfsHash:cid});});
  await withServer(handler,async base=>{
    const post = value => fetch(`${base}/api/ipfs/pin-json`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(value)});
    const result=await post(metadata);
    assert.equal(result.status,200);assert.deepEqual(await result.json(),{cid});
    assert.equal(calls[0].options.headers.Authorization,'Bearer test-server-token');
    assert.equal((await post({...metadata,image:'invalid'})).status,400);
    assert.equal(calls.length,1);
    const form = new FormData();form.append('file',new File([new Uint8Array([137,80,78,71,13,10,26,10])],'test.png',{type:'image/png'}));
    assert.equal((await fetch(`${base}/api/ipfs/pin-file`,{method:'POST',body:form,headers:{Origin:base}})).status,200);
    assert.match(calls[1].url,/pinFileToIPFS$/);
    assert.equal((await fetch(`${base}/api/ipfs/pin-json`,{method:'POST',headers:{Origin:'https://other.example'},body:'{}'})).status,403);
  });
});
test('missing credentials and upstream errors never appear as successful uploads',async()=>{
  await withServer(createUploadHandler(()=>undefined),async base=>{assert.equal((await fetch(`${base}/api/ipfs/pin-json`,{method:'POST',body:'{}'})).status,503);});
  await withServer(createUploadHandler(()=>'test',async()=>Response.json({error:'secret upstream details'},{status:500})),async base=>{
    const result=await fetch(`${base}/api/ipfs/pin-json`,{method:'POST',body:JSON.stringify(metadata)});
    assert.equal(result.status,502);assert.equal((await result.text()).includes('secret'),false);
  });
});
