import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Interface, ZeroAddress } from 'ethers';
import { agentAddress, factoryAddress, agentInterface, chainId, readSource, verifyDeployment, ledgerAsset, parseAgentLog, readCreationConfig } from '../shared/contracts.ts';
import { confirmed } from '../src/app/contracts/client.ts';
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const interfaces = ['ICurveCreatorAgentFactory','ICurveCreatorAgentLaunch','ICurveCreatorAgentManagedToken','ERC20'].map(name => new Interface(json(`../contracts/heyyo/abis/${name}.abi.json`)));
interfaces.push(agentInterface, new Interface(json('../contracts/heyyo/FactoryConfig.abi.json')));
const addr = n => `0x${n.toString(16).padStart(40, '0')}`;
function mockRpc(overrides = {}) {
  const methods = {
    version:'1.1.0',launchpadFactory: factoryAddress,
    sourceLaunches: [addr(1),addr(2),addr(3),addr(4),addr(5),1,true],
    getLaunchRecord: [1,agentAddress,addr(2),addr(6),addr(1),2,1,1,`0x${'00'.repeat(32)}`,'ipfs://metadata',`0x${'00'.repeat(32)}`],
    factory: factoryAddress, creator: agentAddress, token: addr(2), feeVault: addr(4), paymentToken: addr(5), paymentKind: 1, launchId: 7,
    pool: ZeroAddress, state: 1, transferController: addr(1), name: 'Verified', symbol: 'T', decimals: 6, totalSupply: 10n**27n,
    getLaunchTemplate: [1,true],getDexConfig:[addr(8),addr(9),addr(10),10000,200,true],getPaymentTokenConfig:[addr(5),6,1,true,false,0],
    getTemplateModeConfigId: 1,getCurveProfile:[10n**27n,8n*10n**26n,2n*10n**26n,8000n*10n**6n,400n*10n**6n,6],sourcePaymentConfigured:false,
    ...overrides,
  };
  return { async request(method, params) {
    if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
    if (method === 'eth_blockNumber') return '0x99';
    assert.equal(method, 'eth_call');
    const abi = interfaces.find(i => i.getFunction(params[0].data.slice(0,10)));
    const fn = abi.getFunction(params[0].data.slice(0,10));
    const value = methods[fn.name];
    return abi.encodeFunctionResult(fn, fn.outputs.length === 1 ? [value] : value);
  } };
}
test('verified source requires Agent, Factory, Launch and token relationships', async () => {
  const rpc = mockRpc(); await verifyDeployment(rpc);
  const source = await readSource(rpc, 7n, '0x99');
  assert.equal(source.creator, addr(3));
  assert.equal(source.totalSupplyRaw, '1000000000000000000000000000');
  await assert.rejects(readSource(mockRpc({ sourceLaunches:[addr(1),addr(2),addr(3),addr(4),addr(5),1,false] }),7n), /Unregistered/);
  await assert.rejects(readSource(mockRpc({token:addr(99)}),7n),/binding mismatch/);
  await assert.rejects(readSource(mockRpc({transferController:addr(99)}),7n),/controller mismatch/);
  await assert.rejects(verifyDeployment(mockRpc({launchpadFactory:addr(99)})),/Factory mismatch/);
});
test('payment domain and disabled template checks reject invalid creation settings', async () => {
  assert.equal(ledgerAsset(0, addr(5)), ZeroAddress);
  assert.equal(ledgerAsset(1, addr(5)), addr(5));
  assert.throws(() => ledgerAsset(2, addr(5)), /Unknown/);
  const ids = {templateId:'2',dexConfigId:'1',paymentTokenConfigId:'1'};
  assert.equal((await readCreationConfig(mockRpc(),ids)).decimals,6);
  await assert.rejects(readCreationConfig(mockRpc({getLaunchTemplate:[2,true]}),ids),/not a curve/);
  await assert.rejects(readCreationConfig(mockRpc({decimals:18}),ids),/precision mismatch/);
});
test('receipts only accept events emitted by the actual Agent proxy', () => {
  const event = agentInterface.encodeEventLog(agentInterface.getEvent('TokenCreated'),[7,addr(1),addr(2),addr(3),addr(4),addr(5)]);
  assert.equal(parseAgentLog({...event,address:addr(99)}),null);
  assert.equal(parseAgentLog({...event,address:agentAddress}).args.launchId,7n);
});
test('confirmation waits for inclusion once, rejects failed and cancelled transactions', async () => {
  let confirmations;
  const receipt = {status:1,hash:'0xabc'};
  assert.equal(await confirmed({hash:'0xabc',wait:async n => { confirmations=n; return receipt; }},()=>{}),receipt);
  assert.equal(confirmations,1);
  await assert.rejects(confirmed({hash:'x',wait:async()=>({status:0})},()=>{}),/failed/);
  const cancel={code:'TRANSACTION_REPLACED',cancelled:true,reason:'cancelled',receipt};
  await assert.rejects(confirmed({hash:'x',wait:async()=>{throw cancel;}},()=>{}), e=>e===cancel);
});

test('v1.1.0 validates implementation version and decodes separate allocation and buyback events',async()=>{
  await assert.rejects(verifyDeployment(mockRpc({version:'1.0.0'})),/version mismatch/);
  const distribution=agentInterface.encodeEventLog(agentInterface.getEvent('CreatorFeeDistributed'),[7,addr(3),addr(5),101,50,51]);
  const parsed=parseAgentLog({...distribution,address:agentAddress});assert.equal(parsed.args.asset.toLowerCase(),addr(5));assert.equal(parsed.args.buybackAmount,51n);assert.equal(parsed.args.targetTokenOut,undefined);
  const bought=agentInterface.encodeEventLog(agentInterface.getEvent('BuybackExecuted'),[7,addr(2),addr(5),25,100,26]);
  const event=parseAgentLog({...bought,address:agentAddress});assert.equal(event.args.amountSpent,25n);assert.equal(event.args.remainingBuyback,26n);
});
