import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { readConfig, hasSourceConfig } from '../indexer/src/config.ts';
import { applyEvent } from '../indexer/src/processor.ts';
import { scanOnce, confirmedRange, ReorgError } from '../indexer/src/scanner.ts';
import { getTokenList, parseListQuery, safeImage } from '../indexer/src/list.ts';
import { createApiServer } from '../indexer/src/http.ts';
import { contractAdapterReady } from '../indexer/src/adapters/heyyo.ts';
import { parseTokenList } from '../src/app/indexer/api.ts';

const addr = n => `0x${n.toString(16).padStart(40,'0')}`;
const hash = n => `0x${n.toString(16).padStart(64,'0')}`;
const now = Math.floor(Date.now()/1000);
const config = {...readConfig({}),deploymentId:'heyyo-test',sourceAddresses:[addr(1)],startBlock:10n,confirmations:2,batchSize:5};
const block = n => ({number:BigInt(n),hash:hash(n),parentHash:hash(n-1),timestamp:now+n-20});
function created(n=2, height=10) {
  return {kind:'created',blockNumber:BigInt(height),blockHash:hash(height),txHash:hash(n+100),logIndex:0,
    tokenAddress:addr(n),sourceAddress:addr(1),launchAddress:addr(n+100),creatorAddress:addr(9),
    name:`Token ${n}`,ticker:`T${n}`,description:'Indexed token',image:'ipfs://bafy-test/icon.png',metadataUri:null,
    totalSupplyRaw:'1000000000000000000000000000',tokenDecimals:18,quoteDecimals:6,quoteSymbol:'USDC',graduationTargetRaw:'8000000000'};
}
function trade(n=2,height=11,extra={}) {
  return {kind:'trade',blockNumber:BigInt(height),blockHash:hash(height),txHash:hash(n+height+200),logIndex:1,
    tokenAddress:addr(n),sourceAddress:addr(n+100),side:'buy',quoteAmountRaw:'200000000',
    snapshot:{priceUsd:'0.0000123456789',quoteReserveRaw:'6000000000'},...extra};
}
async function database() {
  const db=new PGlite();
  await db.exec(await readFile(new URL('../indexer/sql/001-initial.sql',import.meta.url),'utf8'));
  const client={query:async(sql,params)=>{const r=await db.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};}};
  return {db,client};
}
const query = overrides => ({stage:'soon',sort:'recent',query:'',page:1,pageSize:12,...overrides});

test('configuration requires RPC even with the supplied Heyyo deployment',()=>{
  assert.equal(hasSourceConfig(readConfig({})),false);
  assert.equal(contractAdapterReady,true);
  assert.throws(()=>readConfig({INDEXER_SOURCE_ADDRESSES:'not-an-address'}));
  assert.throws(()=>readConfig({INDEXER_CONFIRMATIONS:'-1'}));
  assert.deepEqual(confirmedRange(10n,12n,2,5),null);
  assert.deepEqual(confirmedRange(10n,100n,2,5),{fromBlock:11n,toBlock:15n});
});

test('independent SQL schema rejects foreign sources, deduplicates trades and correctly scales 6-decimal USDC',async()=>{
  const {db,client}=await database();
  try {
    await assert.rejects(applyEvent(client,config,{...created(),sourceAddress:addr(8)},block(10)),/approved Heyyo/);
    await applyEvent(client,config,created(),block(10));
    await applyEvent(client,config,created(),block(10));
    await assert.rejects(applyEvent(client,config,{...trade(),sourceAddress:addr(8)},block(11)),/indexed Heyyo/);
    await applyEvent(client,config,trade(),block(11));
    await applyEvent(client,config,trade(),block(11));
    await client.query('INSERT INTO heyyo_cursor (chain_id,deployment_id,last_block,last_block_hash,updated_at) VALUES ($1,$2,$3,$4,now())',[config.chainId,config.deploymentId,11,hash(11)]);
    const result=await getTokenList(client,config,query());
    assert.equal(result.total,1);
    assert.equal(result.items[0].volume,200);
    assert.equal(result.items[0].marketCap,12345.6789);
    assert.equal(result.items[0].progress,75);
    assert.equal(result.items[0].change,0);
    assert.equal(result.items[0].stage,'soon');
    assert.equal(result.items[0].image,'https://ayoo.mypinata.cloud/ipfs/bafy-test/icon.png');
    assert.equal((await client.query('SELECT count(*)::integer n FROM heyyo_trades')).rows[0].n,1);
    assert.deepEqual(parseTokenList({success:true,data:result},query()),result);
    assert.equal(await getTokenList(client,{...config,deploymentId:'different'},query()),null);
  } finally {await db.close();}
});

test('stage, search and sorting happen before pagination; only migration marks a token graduated',async()=>{
  const {db,client}=await database();
  try {
    for (let n=2;n<6;n++) {
      await applyEvent(client,config,created(n),block(10));
      await applyEvent(client,config,trade(n,11,{quoteAmountRaw:String(n*1000000),snapshot:{priceUsd:String(n/1000000),quoteReserveRaw:'8000000000'}}),block(11));
    }
    await client.query('INSERT INTO heyyo_cursor (chain_id,deployment_id,last_block,last_block_hash,updated_at) VALUES ($1,$2,$3,$4,now())',[config.chainId,config.deploymentId,11,hash(11)]);
    const sorted=await getTokenList(client,config,query({sort:'volume',pageSize:2}));
    assert.equal(sorted.total,4);
    assert.deepEqual(sorted.items.map(t=>t.ticker),['T5','T4']);
    assert.equal(sorted.items[0].stage,'soon');
    const page2=await getTokenList(client,config,query({sort:'market',pageSize:2,page:2}));
    assert.deepEqual(page2.items.map(t=>t.ticker),['T3','T2']);
    assert.equal((await getTokenList(client,config,query({query:'T4'}))).total,1);
    assert.equal((await getTokenList(client,config,query({query:'%'}))).total,0);
    const graduation={...trade(5,12),kind:'graduated',poolAddress:addr(88)};
    await applyEvent(client,config,graduation,block(12));
    const graduated=await getTokenList(client,config,query({stage:'graduated'}));
    assert.equal(graduated.total,1);
    assert.equal(graduated.items[0].ticker,'T5');
    assert.deepEqual(graduated.counts,{new:0,soon:3,graduated:1});
  } finally {await db.close();}
});

test('scanner atomically advances the cursor and refuses a changed chain',async()=>{
  const {db,client}=await database();
  try {
    const rpc={head:async()=>13n,block:async n=>block(Number(n)),chainId:async()=>5042};
    const adapter={readEvents:async()=>[trade(),created()]};
    assert.equal(await scanOnce(client,config,rpc,adapter),true);
    assert.equal((await client.query('SELECT last_block::text FROM heyyo_cursor')).rows[0].last_block,'11');
    assert.equal(await scanOnce(client,config,rpc,adapter),false);
    await assert.rejects(scanOnce(client,config,{...rpc,block:async n=>({...block(Number(n)),hash:hash(999)})},adapter),ReorgError);
    assert.equal((await client.query('SELECT count(*)::integer n FROM heyyo_trades')).rows[0].n,1);
  } finally {await db.close();}
});

test('malformed or unowned batch rolls back tokens, trades and the cursor together',async()=>{
  const {db,client}=await database();
  try {
    const rpc={head:async()=>13n,block:async n=>block(Number(n)),chainId:async()=>5042};
    await assert.rejects(scanOnce(client,config,rpc,{readEvents:async()=>[created(),trade(33)]}),/indexed Heyyo/);
    for(const table of ['heyyo_cursor','heyyo_tokens','heyyo_events','heyyo_trades']) {
      assert.equal((await client.query(`SELECT count(*)::integer n FROM ${table}`)).rows[0].n,0);
    }
  } finally {await db.close();}
});

test('query and image validation reject unsafe inputs',()=>{
  for (const params of ['stage=other','sort=unsafe','page=0','pageSize=51','query='+('x'.repeat(65))]) assert.throws(()=>parseListQuery(new URLSearchParams(params)));
  for(const url of ['javascript:alert(1)','data:image/svg+xml,test','http://example.com/a.png','ipfs://../etc/passwd','https://user:pass@example.com']) assert.equal(safeImage(url),undefined);
});

test('HTTP API returns explicit not-configured, invalid-query and unavailable states',async()=>{
  let requests=0;
  const missing=createApiServer({configured:false,list:async()=>{requests++;return null;}});
  await new Promise(resolve=>missing.listen(0,'127.0.0.1',resolve));
  try {
    const response=await fetch(`http://127.0.0.1:${missing.address().port}/api/tokens`);
    assert.equal(response.status,503); assert.equal((await response.json()).code,'CONTRACT_NOT_CONFIGURED');
    assert.equal(requests,0);
  } finally {await new Promise(resolve=>missing.close(resolve));}
  const server=createApiServer({configured:true,list:async()=>{throw new Error('secret postgres URL');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base+'/api/tokens?stage=wrong')).status,400);
    const response=await fetch(base+'/api/tokens');
    assert.deepEqual(await response.json(),{success:false,code:'INDEXER_UNAVAILABLE'});
  } finally {await new Promise(resolve=>server.close(resolve));}
});


test('Agent registry preserves unknown market data and deduplicates protocol events', async () => {
  const {db,client}=await database();
  try {
    await applyEvent(client,config,{...created(),graduationTargetRaw:null,launchId:'7'},block(10));
    const event={...created(),kind:'protocol',eventName:'CreatorFeeClaimed',args:{sourceLaunchId:'7',amount:'900719925474099300000'},logIndex:3};
    await applyEvent(client,config,event,block(10));
    await applyEvent(client,config,event,block(10));
    assert.equal((await client.query("SELECT count(*)::integer n FROM heyyo_events WHERE kind='protocol'")).rows[0].n,1);
    await client.query('INSERT INTO heyyo_cursor (chain_id,deployment_id,last_block,last_block_hash) VALUES ($1,$2,$3,$4)',[config.chainId,config.deploymentId,10,hash(10)]);
    const result=await getTokenList(client,config,query({stage:'new'}));
    assert.equal(result.items[0].progress,null);
    assert.equal(result.items[0].volume,null);
    assert.equal(result.items[0].marketCap,null);
    assert.deepEqual(parseTokenList({success:true,data:result},query({stage:'new'})),result);
  } finally { await db.close(); }
});
