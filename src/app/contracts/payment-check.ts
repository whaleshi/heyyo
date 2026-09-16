import { agentAddress, read, tokenInterface, type Rpc } from '../../../shared/contracts';

export class PaymentCheckError extends Error {
  constructor(public readonly english:string,public readonly chinese:string) {super(english);}
}
// Read-only transfer simulation catches broken payment contracts before asking for approval.
export async function checkPaymentTransfer(rpc:Rpc,owner:string,paymentToken:string,amount:bigint) {
  const [balance]=await read(rpc,paymentToken,tokenInterface,'balanceOf',[owner]);
  if(balance<amount)throw new PaymentCheckError('Insufficient payment-token balance for the initial buy.','支付币余额不足，无法完成首买。');
  try {
    const output=await rpc.request<string>('eth_call',[{from:owner,to:paymentToken,data:tokenInterface.encodeFunctionData('transfer',[agentAddress,amount])},'latest']);
    const [success]=tokenInterface.decodeFunctionResult('transfer',output);
    if(!success)throw new Error('Transfer returned false');
  } catch {
    throw new PaymentCheckError('Payment-token transfer failed on this network. Initial buy is unavailable; check the RPC and payment-token contract.','当前网络的支付币转账失败，暂时无法首买。请检查 RPC 和支付币合约。');
  }
}
