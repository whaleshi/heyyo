import { Interface, ZeroAddress } from 'ethers';
import deployment from '../contracts/heyyo/deployment.json';
import agentAbi from '../contracts/heyyo/abis/CurveCreatorAgent.abi.json';
import factoryAbi from '../contracts/heyyo/abis/ICurveCreatorAgentFactory.abi.json';
import launchAbi from '../contracts/heyyo/abis/ICurveCreatorAgentLaunch.abi.json';
import tokenAbi from '../contracts/heyyo/abis/ERC20.abi.json';
import managedAbi from '../contracts/heyyo/abis/ICurveCreatorAgentManagedToken.abi.json';
export { deployment, agentAbi, tokenAbi };
export const agentAddress = deployment.addresses.CurveCreatorAgent.toLowerCase();
export const factoryAddress = deployment.addresses.LaunchpadFactory.toLowerCase();
export const chainId = deployment.chain.chainId;
// Verified against the successful frontend 44 proxy deployment receipt.
export const startBlock = BigInt(deployment.contracts.CurveCreatorAgentProxy.blockNumber);
export const agentInterface = new Interface(agentAbi);
export const tokenInterface = new Interface(tokenAbi);
const factoryInterface = new Interface(factoryAbi);
const launchInterface = new Interface(launchAbi);
const managedInterface = new Interface(managedAbi);
export interface Rpc { request<T>(method: string, params: unknown[]): Promise<T> }
export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const ledgerAsset = (kind: number, token: string) => {
  if (kind !== 0 && kind !== 1) throw new Error('Unknown payment kind');
  return kind === 0 ? ZeroAddress : token;
};
export async function read(rpc: Rpc, address: string, abi: Interface, method: string, args: unknown[] = [], block = 'latest') {
  const data = await rpc.request<string>('eth_call', [{ to: address, data: abi.encodeFunctionData(method, args) }, block]);
  return abi.decodeFunctionResult(method, data);
}
export async function verifyDeployment(rpc: Rpc, block = 'latest') {
  if (Number(BigInt(await rpc.request<string>('eth_chainId', []))) !== chainId) throw new Error('Wrong deployment network');
  const [factory] = await read(rpc, agentAddress, agentInterface, 'launchpadFactory', [], block);
  if (!sameAddress(factory, factoryAddress)) throw new Error('Agent Factory mismatch');
  const [version] = await read(rpc, agentAddress, agentInterface, 'version', [], block);
  if (version !== deployment.config.agent.version) throw new Error('Agent implementation version mismatch');
}
export async function readSource(rpc: Rpc, id: bigint, block = 'latest') {
  const source = await read(rpc, agentAddress, agentInterface, 'sourceLaunches', [id], block);
  if (!source.registered) throw new Error('Unregistered Heyyo launch');
  const [record] = await read(rpc, factoryAddress, factoryInterface, 'getLaunchRecord', [id], block);
  if (!sameAddress(record.token, source.token) || !sameAddress(record.launch, source.launch) || !sameAddress(record.creator, agentAddress)) throw new Error('Factory record mismatch');
  const fields = ['factory','creator','token','feeVault','paymentToken','paymentKind','launchId','pool','state'] as const;
  const values = await Promise.all(fields.map(method => read(rpc, source.launch, launchInterface, method, [], block).then(v => v[0])));
  const [factory, creator, token, vault, payment, kind, launchId, pool, state] = values;
  if (!sameAddress(factory, factoryAddress) || !sameAddress(creator, agentAddress) || !sameAddress(token, source.token)
    || !sameAddress(vault, source.feeVault) || !sameAddress(payment, source.paymentToken) || kind !== source.paymentKind || launchId !== id) throw new Error('Launch binding mismatch');
  const [controller] = await read(rpc, source.token, managedInterface, 'transferController', [], block);
  if (!sameAddress(controller, source.launch)) throw new Error('Token controller mismatch');
  const [name, symbol, decimals, supply, paymentDecimals, paymentSymbol] = await Promise.all([
    read(rpc, token, tokenInterface, 'name', [], block), read(rpc, token, tokenInterface, 'symbol', [], block),
    read(rpc, token, tokenInterface, 'decimals', [], block), read(rpc, token, tokenInterface, 'totalSupply', [], block),
    read(rpc, payment, tokenInterface, 'decimals', [], block), read(rpc, payment, tokenInterface, 'symbol', [], block),
  ]);
  ledgerAsset(Number(kind), payment);
  return { launchId: id.toString(), launch: source.launch.toLowerCase(), token: token.toLowerCase(), creator: source.creatorRecipient.toLowerCase(),
    feeVault: vault.toLowerCase(), paymentToken: payment.toLowerCase(), paymentKind: Number(kind), paymentDecimals: Number(paymentDecimals[0]), paymentSymbol: String(paymentSymbol[0]),
    name: String(name[0]), ticker: String(symbol[0]), tokenDecimals: Number(decimals[0]), totalSupplyRaw: supply[0].toString(),
    metadataUri: String(record.metadataURI), pool: String(pool).toLowerCase(), state: Number(state), mode: Number(record.mode) };
}
export type SourceLaunch = Awaited<ReturnType<typeof readSource>>;
export type ChainLog = { address: string; topics: string[]; data: string; blockNumber: string; blockHash: string; transactionHash: string; logIndex: string; removed?: boolean };
export function parseAgentLog(log: Pick<ChainLog, 'address' | 'topics' | 'data'>) {
  return sameAddress(log.address, agentAddress) ? agentInterface.parseLog(log) : null;
}

export async function readCreationConfig(rpc: Rpc, ids: { templateId: string; dexConfigId: string; paymentTokenConfigId: string }) {
  const { default: configAbi } = await import('../contracts/heyyo/FactoryConfig.abi.json');
  const abi = new Interface(configAbi);
  await verifyDeployment(rpc);
  const block = await rpc.request<string>('eth_blockNumber', []);
  const [[template], [dex], [payment], [profileId]] = await Promise.all([
    read(rpc, factoryAddress, abi, 'getLaunchTemplate', [BigInt(ids.templateId)], block),
    read(rpc, factoryAddress, abi, 'getDexConfig', [BigInt(ids.dexConfigId)], block),
    read(rpc, factoryAddress, abi, 'getPaymentTokenConfig', [BigInt(ids.paymentTokenConfigId)], block),
    read(rpc, factoryAddress, abi, 'getTemplateModeConfigId', [BigInt(ids.templateId)], block),
  ]);
  if (template.mode !== 1n || !template.enabled || !dex.enabled || !payment.enabled) throw new Error('Creation configuration is disabled or not a curve');
  ledgerAsset(Number(payment.kind), payment.asset);
  const [[profile], [decimals], [symbol]] = await Promise.all([
    read(rpc, factoryAddress, abi, 'getCurveProfile', [profileId], block),
    read(rpc, payment.asset, tokenInterface, 'decimals', [], block),
    read(rpc, payment.asset, tokenInterface, 'symbol', [], block),
  ]);
  if (decimals !== payment.decimals || profile.quoteDecimals !== payment.decimals) throw new Error('Payment precision mismatch');
  const [sourceConfigured] = await read(rpc, agentAddress, agentInterface, 'sourcePaymentConfigured', [], block);
  if (sourceConfigured) {
    const [[kind], [asset]] = await Promise.all(['sourcePaymentKind', 'sourcePaymentToken'].map(method => read(rpc, agentAddress, agentInterface, method, [], block)));
    if (kind !== payment.kind || !sameAddress(asset, payment.asset)) throw new Error('Agent payment domain mismatch');
  }
  return { token: payment.asset as string, kind: Number(payment.kind) as 0 | 1, decimals: Number(decimals), symbol: String(symbol), totalSupplyRaw: profile.totalTokenSupply.toString() as string };
}
