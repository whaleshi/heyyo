import { checkPaymentTransfer } from './payment-check';
import { BrowserProvider, Contract, formatUnits, parseUnits, type Eip1193Provider, type TransactionResponse, type TransactionReceipt } from 'ethers';
import { agentAbi, agentAddress, agentInterface, tokenAbi, verifyDeployment, readSource, readCreationConfig, read, sameAddress, parseAgentLog, type Rpc } from '../../../shared/contracts';
import { launchConfig, creationReady } from './config';
export { formatUnits };
export function walletRpc(provider: Eip1193Provider): Rpc {
  return { request: <T,>(method: string, params: unknown[]) => provider.request({ method, params }) as Promise<T> };
}
async function assertAccount(rpc: Rpc, address: string) {
  const accounts = await rpc.request<string[]>('eth_accounts', []);
  if (!accounts[0] || !sameAddress(accounts[0], address)) throw new Error('Wallet account changed');
}
export async function walletClient(provider: Eip1193Provider, address: string) {
  const rpc = walletRpc(provider);
  await verifyDeployment(rpc);
  await assertAccount(rpc, address);
  const browser = new BrowserProvider(provider);
  const signer = await browser.getSigner(address);
  if (!sameAddress(await signer.getAddress(), address)) throw new Error('Wallet account changed');
  return { rpc, signer, contract: new Contract(agentAddress, agentAbi, signer) };
}
export async function confirmed(tx: TransactionResponse, onHash: (hash: string) => void): Promise<TransactionReceipt> {
  onHash(tx.hash);
  try {
    const receipt = await tx.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error('Transaction failed');
    return receipt;
  } catch (error) {
    const replacement = error as { code?: string; cancelled?: boolean; reason?: string; receipt?: TransactionReceipt };
    if (replacement.code === 'TRANSACTION_REPLACED' && !replacement.cancelled && replacement.reason === 'repriced' && replacement.receipt?.status === 1) {
      onHash(replacement.receipt.hash);
      return replacement.receipt;
    }
    throw error;
  }
}
export function creationArgs(name: string, ticker: string, metadataURI: string) {
  if (!creationReady) throw new Error('Creation settings are not configured');
  if (!name.trim() || name.trim().length > 40 || !/^[A-Z0-9]{1,10}$/.test(ticker)) throw new Error('Invalid token details');
  if (metadataURI.length > 2048 || !/^(https:\/\/|ipfs:\/\/)/.test(metadataURI)) throw new Error('A published HTTPS or IPFS metadata URL is required');
  return [BigInt(launchConfig.templateId), BigInt(launchConfig.dexConfigId), BigInt(launchConfig.paymentTokenConfigId), name.trim(), ticker, metadataURI];
}
export async function createToken(provider: Eip1193Provider, address: string, draft: { name: string; ticker: string; metadataURI: string }, onHash: (hash: string) => void) {
  const { contract, rpc } = await walletClient(provider, address);
  const args = creationArgs(draft.name, draft.ticker, draft.metadataURI);
  await readCreationConfig(rpc, launchConfig);
  await assertAccount(rpc, address);
  const receipt = await confirmed(await contract.getFunction('createCurveLaunch(uint256,uint256,uint256,string,string,string)')(...args), onHash);
  const event = receipt.logs.map(log => parseAgentLog({ ...log, topics: [...log.topics] })).find(e => e?.name === 'TokenCreated' && sameAddress(e.args.creatorRecipient, address));
  if (!event) throw new Error('Creation receipt could not be verified. Check the transaction before retrying.');
  const source = await readSource(rpc, event.args.launchId, `0x${receipt.blockNumber.toString(16)}`);
  if (!sameAddress(source.token, event.args.token) || !sameAddress(source.launch, event.args.launch)) throw new Error('Creation event mismatch');
  return { source, hash: receipt.hash };
}
export async function claimToken(provider: Eip1193Provider, address: string, launchId: string, onHash: (hash: string) => void) {
  const { contract, rpc } = await walletClient(provider, address);
  const source = await readSource(rpc, BigInt(launchId));
  if (!sameAddress(source.creator, address)) throw new Error('Only the token creator can claim');
  const [claimable] = await read(rpc, agentAddress, agentInterface, 'claimableCreatorFee', [BigInt(launchId)]);
  if (claimable <= 0n) throw new Error('No claimable rewards');
  await assertAccount(rpc, address);
  const receipt = await confirmed(await contract.claimCreatorFee(BigInt(launchId)), onHash);
  const event = receipt.logs.map(log => parseAgentLog({ ...log, topics: [...log.topics] })).find(e => e?.name === 'CreatorFeeClaimed' && e.args.sourceLaunchId === BigInt(launchId) && sameAddress(e.args.creatorRecipient, address));
  if (!event) throw new Error('Claim receipt could not be verified. Check the transaction before retrying.');
  return { amount: formatUnits(event.args.amount, source.paymentDecimals), symbol: source.paymentSymbol, hash: receipt.hash };
}
// Atomic create-and-buy uses the same exported overload; no follow-up transaction or block delay.
export async function createAndBuy(provider: Eip1193Provider, address: string, draft: { name: string; ticker: string; metadataURI: string },
  amount: string, minimumTokenOutRaw: bigint, onHash: (hash: string) => void) {
  const { contract, signer, rpc } = await walletClient(provider, address);
  const payment = await readCreationConfig(rpc, launchConfig);
  const amountRaw = parseUnits(amount, payment.decimals);
  if (amountRaw <= 0n || minimumTokenOutRaw <= 0n) throw new Error('Invalid initial buy amounts');
  const args = creationArgs(draft.name, draft.ticker, draft.metadataURI);
  if (payment.kind === 1) {
    await checkPaymentTransfer(rpc, address, payment.token, amountRaw);
    const token = new Contract(payment.token, tokenAbi, signer);
    if (await token.allowance(address, agentAddress) < amountRaw) {
      await confirmed(await token.approve(agentAddress, amountRaw), onHash);
    }
  }
  await verifyDeployment(rpc);
  await assertAccount(rpc, address);
  const block = await rpc.request<{ timestamp: string }>('eth_getBlockByNumber', ['latest', false]);
  const receipt = await confirmed(await contract.getFunction('createCurveLaunch((uint256,uint256,uint256,string,string,string,uint256,uint256,uint256))')(
    [...args, amountRaw, minimumTokenOutRaw, BigInt(block.timestamp) + 1200n], { value: payment.kind === 0 ? amountRaw : 0n }), onHash);
  const events = receipt.logs.map(log => parseAgentLog({ ...log, topics: [...log.topics] }));
  const created = events.find(e => e?.name === 'TokenCreated' && sameAddress(e.args.creatorRecipient, address));
  const bought = events.find(e => e?.name === 'InitialBuyExecuted' && e.args.launchId === created?.args.launchId && sameAddress(e.args.buyer, address) && sameAddress(e.args.token, created?.args.token ?? ''));
  if (!created || !bought) throw new Error('Creation/buy receipt could not be verified. Check the transaction before retrying.');
  await readSource(rpc, created.args.launchId, `0x${receipt.blockNumber.toString(16)}`);
  return { hash: receipt.hash, launchId: created.args.launchId.toString(), token: created.args.token, tokenOut: bought.args.tokenOut.toString(), refund: bought.args.refundAmount.toString() };
}
