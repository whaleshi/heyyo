import type { IndexEvent, KnownToken } from '../events.ts';
import type { RpcClient } from '../rpc.ts';
import type { IndexerConfig } from '../config.ts';
import { agentAddress, chainId, verifyDeployment, readSource, parseAgentLog, sameAddress, type ChainLog } from '../../../shared/contracts.ts';

export interface ContractAdapter {
  readEvents(params: { fromBlock: bigint; toBlock: bigint; knownTokens: KnownToken[] }): Promise<IndexEvent[]>;
}
export const contractAdapterReady = true;
export function createHeyyoAdapter(config: IndexerConfig, rpc: RpcClient): ContractAdapter {
  if (config.chainId !== chainId || config.sourceAddresses.length !== 1 || !sameAddress(config.sourceAddresses[0], agentAddress)) throw new Error('Configuration does not match the supplied Heyyo deployment');
  return {
    async readEvents({ fromBlock, toBlock }) {
      await verifyDeployment(rpc, `0x${toBlock.toString(16)}`);
      const logs = await rpc.request<ChainLog[]>('eth_getLogs', [{ address: agentAddress, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }]);
      const events: IndexEvent[] = [];
      for (const log of logs) {
        if (log.removed) throw new Error('Removed log in canonical batch');
        const parsed = parseAgentLog(log);
        if (!parsed) continue;
        const base = { blockNumber: BigInt(log.blockNumber), blockHash: log.blockHash, txHash: log.transactionHash,
          logIndex: Number(BigInt(log.logIndex)), sourceAddress: agentAddress };
        if (parsed.name === 'TokenCreated') {
          const source = await readSource(rpc, parsed.args.launchId, log.blockNumber);
          if (!sameAddress(source.token, parsed.args.token) || !sameAddress(source.launch, parsed.args.launch)
            || !sameAddress(source.creator, parsed.args.creatorRecipient) || !sameAddress(source.feeVault, parsed.args.feeVault)
            || !sameAddress(source.paymentToken, parsed.args.paymentToken)) throw new Error('TokenCreated binding mismatch');
          events.push({ ...base, kind: 'created', tokenAddress: source.token, launchAddress: source.launch, creatorAddress: source.creator,
            name: source.name, ticker: source.ticker, description: '', image: null, metadataUri: source.metadataUri || null,
            totalSupplyRaw: source.totalSupplyRaw, tokenDecimals: source.tokenDecimals, quoteDecimals: source.paymentDecimals,
            quoteSymbol: source.paymentSymbol, graduationTargetRaw: null, launchId: source.launchId });
        } else {
          // Preserve exact Agent events for claims, accruals, initial buys and latest-target reconstruction.
          // They are not curve trade volume or price observations.
          const args = Object.fromEntries(parsed.fragment.inputs.map((input, i) => [input.name, String(parsed.args[i])]));
          const tokenAddress = String(parsed.args.token ?? parsed.args.targetToken ?? agentAddress).toLowerCase();
          events.push({ ...base, kind: 'protocol', tokenAddress, eventName: parsed.name, args });
        }
      }
      return events;
    },
  };
}
