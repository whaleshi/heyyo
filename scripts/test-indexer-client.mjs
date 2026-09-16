import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useIndexedTokens } from '../src/app/indexer/use-indexed-tokens.ts';
import { IndexerRequestError, parseTokenList } from '../src/app/indexer/api.ts';

const pages={new:1,soon:1,graduated:1};
const response=q=>({items:[],page:q.page,pageSize:q.pageSize,total:0,counts:{new:0,soon:0,graduated:0},indexedBlock:'123',updatedAt:new Date().toISOString()});
function mount(loader,initial='') {
  globalThis.document=new EventTarget();
  globalThis.document.hidden=false;
  let result;
  function Probe({query}) {result=useIndexedTokens(query,'recent',pages,loader,0);return null;}
  let root;
  act(()=>{root=create(React.createElement(Probe,{query:initial}));});
  return {get result(){return result;},change(query){act(()=>root.update(React.createElement(Probe,{query})));},close(){act(()=>root.unmount());}};
}

test('a new search aborts the old board and ignores responses arriving out of order',async()=>{
  const pending=[];
  const h=mount((query,signal)=>new Promise(resolve=>pending.push({query,signal,resolve})),'old');
  assert.equal(pending.length,3);
  h.change('new');
  assert.ok(pending.slice(0,3).every(p=>p.signal.aborted));
  await act(async()=>{pending.slice(3).forEach(p=>p.resolve(response(p.query)));});
  const current=h.result.data;
  assert.ok(current);
  await act(async()=>{pending.slice(0,3).forEach(p=>p.resolve({...response(p.query),indexedBlock:'1'}));});
  assert.equal(h.result.data,current);
  h.close();
});

test('first-load failures show no demo data; retry recovers and refresh failures retain the last board',async()=>{
  let mode='missing';
  const h=mount(async q=>{
    if(mode==='missing')throw new IndexerRequestError('CONTRACT_NOT_CONFIGURED');
    if(mode==='failure')throw new Error('Network failed');
    return response(q);
  });
  await act(async()=>{});
  assert.equal(h.result.error,'CONTRACT_NOT_CONFIGURED');
  assert.equal(h.result.data,null);
  mode='ok';
  await act(async()=>h.result.retry());
  assert.ok(h.result.data);
  const previous=h.result.data;
  mode='failure';
  await act(async()=>h.result.retry());
  assert.equal(h.result.data,previous);
  assert.equal(h.result.error,'INDEXER_UNAVAILABLE');
  h.close();
});

test('changing search does not display rows from the old query while waiting',async()=>{
  let pending=false;
  const h=mount(async q=>pending?new Promise(()=>{}):response(q));
  await act(async()=>{});
  assert.ok(h.result.data);
  pending=true;
  h.change('another');
  assert.equal(h.result.data,null);
  assert.equal(h.result.loading,true);
  h.close();
});

test('client rejects invalid envelopes and mismatched pagination',()=>{
  const q={stage:'new',sort:'recent',query:'',page:1,pageSize:12};
  for(const value of [null,{}, {success:false,data:response(q)}, {success:true,data:{...response(q),page:2}},
    {success:true,data:{...response(q),counts:{new:1,soon:0,graduated:0}}},
    {success:true,data:{...response(q),items:[{id:'fake-token'}]}},
    {success:true,data:{...response(q),updatedAt:'bad date'}}]) assert.throws(()=>parseTokenList(value,q));
  assert.deepEqual(parseTokenList({success:true,data:response(q)},q).items,[]);
});

test('returning to the same board keeps cached cards throughout background refresh',async()=>{
  let pending=false;
  const loader=async q=>pending?new Promise(()=>{}):response(q);
  const first=mount(loader);await act(async()=>{});const cached=first.result.data;first.close();
  pending=true;
  const second=mount(loader);assert.equal(second.result.data,cached);assert.equal(second.result.loading,true);
  second.close();
});
