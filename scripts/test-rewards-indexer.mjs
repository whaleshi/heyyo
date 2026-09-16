import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {once} from 'node:events';
import {readConfig} from '../indexer/src/config.ts';
import {getWalletRewards,getWalletClaims} from '../indexer/src/rewards.ts';
import {applyEvent} from '../indexer/src/processor.ts';
import {createApiServer} from '../indexer/src/http.ts';
import {loadRewards,loadClaimHistory} from '../src/app/contracts/rewards.ts';
const addr=n=>`0x${n.toString(16).padStart(40,'0')}`;
const hash=n=>`0x${n.toString(16).padStart(64,'0')}`;
const config={...readConfig({}),deploymentId:'rewards-test',sourceAddresses:[addr(1)]};
const block={number:10n,hash:hash(10),parentHash:hash(9),timestamp:1000};
test('wallet endpoints isolate owners, retain raw precision, show indexed metadata and reject stale snapshots',async()=>{
  const db=new PGlite();await db.exec(await readFile(new URL('../indexer/sql/001-initial.sql',import.meta.url),'utf8'));
  const client={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length};}};
  try {
    for(const n of [2,3]) {
      await applyEvent(client,config,{kind:'created',blockNumber:10n,blockHash:hash(10),txHash:hash(n),logIndex:0,
        tokenAddress:addr(n),sourceAddress:addr(1),launchAddress:addr(n+10),creatorAddress:addr(n+20),
        name:`Token ${n}`,ticker:`T${n}`,description:'Indexed story',image:'https://example.com/icon.png',metadataUri:null,
        totalSupplyRaw:'1000000000000000000000000000',tokenDecimals:18,quoteDecimals:6,quoteSymbol:'USDC',graduationTargetRaw:null,launchId:String(n)},block);
      await client.query('INSERT INTO heyyo_reward_snapshots VALUES($1,$2,$3,$4::jsonb)',[config.chainId,config.deploymentId,addr(n),JSON.stringify({creator:addr(n+20),claimable:'900719925474099312345',claimed:'0',pending:'7'})]);
    }
    await client.query('INSERT INTO heyyo_cursor(chain_id,deployment_id,last_block,last_block_hash) VALUES($1,$2,10,$3)',[config.chainId,config.deploymentId,hash(10)]);
    assert.equal(await getWalletRewards(client,config,addr(22)),null);
    await client.query('INSERT INTO heyyo_reward_state(chain_id,deployment_id,block_number,block_hash) VALUES($1,$2,10,$3)',[config.chainId,config.deploymentId,hash(10)]);
    const rewards=await getWalletRewards(client,config,addr(22));
    assert.equal(rewards.items.length,1);assert.equal(rewards.items[0].claimable,'900719925474099312345');
    assert.equal(rewards.items[0].image,'https://example.com/icon.png');
    assert.equal((await getWalletRewards(client,config,addr(99))).items.length,0);
    const claim={kind:'protocol',eventName:'CreatorFeeClaimed',args:{sourceLaunchId:'2',creatorRecipient:addr(22),asset:addr(50),amount:'900719925474099312345'},
      blockNumber:10n,blockHash:hash(10),txHash:hash(99),logIndex:2,tokenAddress:addr(1),sourceAddress:addr(1)};
    await applyEvent(client,config,claim,block);await applyEvent(client,config,claim,block);
    const claims=await getWalletClaims(client,config,addr(22));assert.equal(claims.items.length,1);assert.equal(claims.items[0].decimals,6);assert.equal(claims.items[0].amount,claim.args.amount);
    assert.equal((await getWalletClaims(client,config,addr(23))).items.length,0);
    await client.query('UPDATE heyyo_cursor SET last_block=11');
    assert.equal(await getWalletRewards(client,config,addr(22)),null);
    assert.equal(await getWalletClaims(client,config,addr(22)),null);
  } finally {await db.close();}
});
test('HTTP routes normalize wallet addresses and reject invalid input or unavailable index',async()=>{
  const seen=[];
  const server=createApiServer({configured:true,list:async()=>null,rewards:async a=>{seen.push(a);return {items:[]};},claims:async()=>null});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/wallets/${addr(22)}/rewards`)).status,200);
    assert.deepEqual(seen,[addr(22)]);
    assert.equal((await fetch(`${base}/api/wallets/not-wallet/rewards`)).status,400);
    assert.equal((await fetch(`${base}/api/wallets/${addr(22)}/claims`)).status,503);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('frontend rewards and history use HTTP index APIs only and preserve bigint precision',async()=>{
  const original=globalThis.fetch; const paths=[];
  const reward={launchId:'2',token:addr(2),launch:addr(12),creator:addr(22),feeVault:addr(4),paymentToken:addr(5),paymentKind:1,paymentDecimals:6,
    name:'Token',ticker:'T',paymentSymbol:'USDC',pending:'0',pendingBuyback:'0',claimable:'900719925474099312345',claimed:'0',image:'https://example.com/image.png'};
  try {
    globalThis.fetch=async url=>{paths.push(url);return Response.json({success:true,data:{address:addr(22),chainId:config.chainId,indexedBlock:'10',items:url.endsWith('/rewards')?[reward]:[]}});};
    assert.equal((await loadRewards(addr(22)))[0].claimable,900719925474099312345n);
    assert.deepEqual(await loadClaimHistory(addr(22)),[]);
    assert.deepEqual(paths,[`/api/wallets/${addr(22)}/rewards`,`/api/wallets/${addr(22)}/claims`]);
    await assert.rejects(loadRewards(addr(23)),/unavailable/);
  } finally {globalThis.fetch=original;}
});
