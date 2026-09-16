import test from 'node:test';
import assert from 'node:assert/strict';
import {RpcClient} from '../indexer/src/rpc.ts';
test('RPC switches away from a rate-limited endpoint and retains the working endpoint',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{calls.push(url);return url.includes('primary')?new Response('',{status:429}):Response.json({jsonrpc:'2.0',id:1,result:'0x13b2'});};
 try{const rpc=new RpcClient('https://primary.example,https://secondary.example');assert.equal(await rpc.chainId(),5042);assert.equal(await rpc.chainId(),5042);assert.deepEqual(calls,['https://primary.example','https://secondary.example','https://secondary.example']);}finally{globalThis.fetch=original;}
});
test('parallel reads use one batch and match out-of-order replies by id',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_,options)=>{calls++;const batch=JSON.parse(options.body);assert.equal(batch.length,3);return Response.json(batch.map(q=>({jsonrpc:'2.0',id:q.id,result:q.params[0]})).reverse());};
 try{const rpc=new RpcClient('https://primary.example');assert.deepEqual(await Promise.all([1,2,3].map(n=>rpc.request('eth_call',[n]))),[1,2,3]);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('partial batch failure retries only failed requests on the alternate endpoint',async()=>{
 const original=globalThis.fetch;const bodies=[];
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);bodies.push(body);return url.includes('primary')?Response.json([{id:1,result:'ok'},{id:2,error:{code:-32000}}]):Response.json({id:2,result:'recovered'});};
 try{const rpc=new RpcClient('https://primary.example,https://secondary.example');assert.deepEqual(await Promise.all([rpc.request('eth_call',[1]),rpc.request('eth_call',[2])]),['ok','recovered']);assert.equal(bodies[1].id,2);}finally{globalThis.fetch=original;}
});
