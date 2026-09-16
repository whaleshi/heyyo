import {test} from 'node:test';
import assert from 'node:assert/strict';
import {metadataUrl,fetchMetadata} from '../indexer/src/metadata.ts';
const cid='QmXCtZTPAqnV7N1t66e7wGioGieaX5uLSs5BrjDfLiuJRQ';
test('metadata fetching only uses a fixed gateway, and preserves on-chain identity',async()=>{
  assert.equal(metadataUrl('http://127.0.0.1/private'),null);
  assert.equal(metadataUrl(`ipfs://${cid}/../../private`),null);
  const result=await fetchMetadata(`ipfs://${cid}`,async(url,options)=>{
    assert.equal(url,`https://ayoo.mypinata.cloud/ipfs/${cid}`);
    assert.equal(options.redirect,'error');
    return Response.json({name:'Not trusted',image:`ipfs://${cid}`,description:'Story'});
  });
  assert.deepEqual(result,{image:`https://ayoo.mypinata.cloud/ipfs/${cid}`,description:'Story'});
});
test('unavailable or unsafe metadata cannot overwrite token data',async()=>{
  await assert.rejects(fetchMetadata(`ipfs://${cid}`,async()=>new Response('offline',{status:503})));
  await assert.rejects(fetchMetadata(`ipfs://${cid}`,async()=>Response.json({image:'javascript:alert(1)'})));
  await assert.rejects(fetchMetadata(`ipfs://${cid}`,async()=>new Response('x'.repeat(65537))),/too large/);
});
