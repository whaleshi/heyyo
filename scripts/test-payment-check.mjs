import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkPaymentTransfer,PaymentCheckError} from '../src/app/contracts/payment-check.ts';
import {agentAddress,tokenInterface} from '../shared/contracts.ts';
const owner='0x'+'12'.repeat(20),token='0x'+'34'.repeat(20);
function rpc(mode){const calls=[];return {calls,async request(method,params){calls.push(method);assert.equal(method,'eth_call');const fn=tokenInterface.parseTransaction({data:params[0].data});if(fn.name==='balanceOf')return tokenInterface.encodeFunctionResult('balanceOf',[mode==='balance'?0:100]);assert.equal(params[0].from,owner);assert.equal(fn.name,'transfer');assert.equal(fn.args[0].toLowerCase(),agentAddress);if(mode==='revert')throw new Error('invalid opcode');return tokenInterface.encodeFunctionResult('transfer',[mode!=='false']);}};}
test('payment precheck accepts working transfers using only read-only calls',async()=>{const r=rpc('ok');await checkPaymentTransfer(r,owner,token,22n);assert.equal(r.calls.length,2);});
test('broken payment transfers and insufficient funds provide explicit errors before approvals',async()=>{for(const mode of ['balance','revert','false'])await assert.rejects(checkPaymentTransfer(rpc(mode),owner,token,22n),e=>e instanceof PaymentCheckError);});
