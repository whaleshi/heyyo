import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {syncPlatform,getPlatformStats} from '../indexer/src/platform.ts';
import {tokenInterface,agentAddress} from '../shared/contracts.ts';
import {platformTokenAddress,burnAddress} from '../shared/platform.ts';
const hash='0x'+'ab'.repeat(32);
const config={chainId:5042,deploymentId:'platform-test',sourceAddresses:[agentAddress]};
async function fixture(){
 const db=new PGlite();await db.exec(readFileSync(new URL('../indexer/sql/001-initial.sql',import.meta.url),'utf8'));
 const pool={query:(sql,args)=>db.query(sql,args)};
 await pool.query('INSERT INTO heyyo_cursor(chain_id,deployment_id,last_block,last_block_hash) VALUES($1,$2,100,$3)',[5042,config.deploymentId,hash]);
 const rpc={block:async()=>({hash}),request:async(method,params)=>{
  assert.equal(params[1],'0x64');
  if(method==='eth_getCode')return '0x1234';
  assert.equal(params[0].to,platformTokenAddress);
  const tx=tokenInterface.parseTransaction({data:params[0].data});
  if(tx.name==='balanceOf')assert.equal(tx.args[0].toLowerCase(),burnAddress.toLowerCase());
  return tokenInterface.encodeFunctionResult(tx.name,[tx.name==='balanceOf'?4357111413948340124826425n:18]);
 }};
 async function event(name,asset,amount,block=99,source=agentAddress){
  const n=(await pool.query('SELECT count(*)::int AS n FROM heyyo_events')).rows[0].n;
  await pool.query(`INSERT INTO heyyo_events(chain_id,deployment_id,tx_hash,log_index,block_number,block_hash,source_address,token_address,kind,payload,event_timestamp)
   VALUES($1,$2,$3,0,$4,$5,$6,$7,'protocol',$8,1)`,[5042,config.deploymentId,'0x'+n.toString(16).padStart(64,'0'),block,hash,source,agentAddress,JSON.stringify({eventName:name,args:{asset,creatorAmount:amount}})]);
 }
 return {db,pool,rpc,event};
}
test('platform aggregates only distributed creator share, normalizes native/ERC20 units, and preserves exact burned balance',async()=>{
 const f=await fixture();try{
  await f.event('CreatorFeeDistributed','0x3600000000000000000000000000000000000000','1234567');
  await f.event('CreatorFeeDistributed','0x0000000000000000000000000000000000000000','2000000000000000000');
  await f.event('CreatorFeeClaimed','0x3600000000000000000000000000000000000000','999999');
  await f.event('CreatorFeeDistributed','0x3600000000000000000000000000000000000000','999999',101);
  await f.event('CreatorFeeDistributed','0x1111111111111111111111111111111111111111','999999');
  await f.event('CreatorFeeDistributed','0x3600000000000000000000000000000000000000','999999',99,'0x1111111111111111111111111111111111111111');
  await syncPlatform(f.pool,config,f.rpc);
  const result=await getPlatformStats(f.pool,config);
  assert.equal(result.burnedHeyyo,'4357111.413948340124826425');
  assert.equal(result.creatorRewardsUsdc,'3.234567');
  await syncPlatform(f.pool,config,f.rpc);assert.deepEqual(await getPlatformStats(f.pool,config),result);
 }finally{await f.db.close();}
});
test('platform rejects changed blocks and skips blocks before token deployment',async()=>{
 const f=await fixture();try{
  await syncPlatform(f.pool,config,{...f.rpc,request:async()=> '0x'});assert.equal(await getPlatformStats(f.pool,config),null);
  await assert.rejects(syncPlatform(f.pool,config,{...f.rpc,block:async()=>({hash:'different'})}),/block changed/);
  assert.equal(await getPlatformStats(f.pool,config),null);
 }finally{await f.db.close();}
});
