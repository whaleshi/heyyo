import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {parseLaunchConfig,amountRaw,uniqueBuyers,safeError} from './lib/launch-config.ts';
import {runBuyers} from './launch.ts';
const key=n=>`0x${n.toString(16).padStart(64,'0')}`;
function fixture(){const c=JSON.parse(readFileSync(new URL('launch.example.json',import.meta.url)));c.creator={privateKey:key(1)};c.token={name:'Test',symbol:'TEST',metadataURI:'ipfs://'+'a'.repeat(46)};c.buyers=[{privateKey:key(1),amount:'10'},{privateKey:key(2),amount:'20.25'}];return parseLaunchConfig(c);}
test('launch config needs only ordinary RPC, preserves USDC precision and masks external errors',()=>{
  const c=fixture();assert.equal(c.buyers.length,2);assert.equal(amountRaw('20.25',6),20250000n);
  assert.equal(c.relay,undefined);assert.throws(()=>amountRaw('0.0000001',6));
  assert.throws(()=>parseLaunchConfig({...c,chainId:1}));assert.throws(()=>parseLaunchConfig({...c,slippageBps:500}));
  assert.ok(!safeError(new Error(key(1))).includes(key(1)));
});
test('all buyer workflows start concurrently and one failure does not cancel other wallets',async()=>{
  const started=[],release=[];
  const result=runBuyers([1,2,3],async n=>{started.push(n);await new Promise(resolve=>release.push(resolve));if(n===2)throw new Error('failure');return n;});
  assert.deepEqual(started,[1,2,3]);release.forEach(r=>r());
  assert.deepEqual((await result).map(r=>r.status),['fulfilled','rejected','fulfilled']);
});
test('duplicate buyer addresses and malformed money are rejected before transactions',()=>{
  assert.throws(()=>uniqueBuyers(['0xABC','0xabc']));
  for(const amount of ['0','-1','1e6','NaN',1]){const c=fixture();c.buyers[0].amount=amount;assert.throws(()=>parseLaunchConfig(c));}
});


test('legacy gas price only needs to cover base fee, not twice the base fee', async()=>{
  const {validateGasPrice}=await import('./lib/launch-prepare.ts');
  const gwei=1000000000n;
  assert.doesNotThrow(()=>validateGasPrice(25n*gwei,20n*gwei));
  assert.doesNotThrow(()=>validateGasPrice(20n*gwei,20n*gwei));
  assert.doesNotThrow(()=>validateGasPrice(gwei,null));
  assert.throws(()=>validateGasPrice(10n*gwei,20n*gwei),/10.0 Gwei.*20.0 Gwei/);
});
