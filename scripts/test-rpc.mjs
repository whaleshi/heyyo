import test from 'node:test';
import assert from 'node:assert/strict';
import {RpcClient} from '../indexer/src/rpc.ts';
test('RPC switches away from a rate-limited endpoint and retains the working endpoint',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{calls.push(url);return url.includes('primary')?new Response('',{status:429}):Response.json({jsonrpc:'2.0',id:1,result:'0x13b2'});};
 try{const rpc=new RpcClient('https://primary.example,https://secondary.example');assert.equal(await rpc.chainId(),5042);assert.equal(await rpc.chainId(),5042);assert.deepEqual(calls,['https://primary.example','https://secondary.example','https://secondary.example']);}finally{globalThis.fetch=original;}
});
