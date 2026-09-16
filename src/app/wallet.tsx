import '@rainbow-me/rainbowkit/styles.css';
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getDefaultConfig, RainbowKitProvider, lightTheme, useConnectModal, useAccountModal } from '@rainbow-me/rainbowkit';
import { bitgetWallet, binanceWallet, okxWallet, metaMaskWallet, rainbowWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { WagmiProvider, useAccount, useDisconnect, useSwitchChain, http } from 'wagmi';
import { defineChain } from 'viem';
import type { Eip1193Provider } from 'ethers';
import { chainId } from '../../shared/contracts';
import { rpcUrl, networkName, nativeSymbol, networkReady } from './contracts/config';
import { WalletContext } from './wallet-context';

export const walletNetwork = defineChain({
  id: chainId, name: networkName,
  nativeCurrency: { name: nativeSymbol, symbol: nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: networkName.includes('Development'),
});
// The existing Reown project ID is also a WalletConnect project ID.
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim();
export const walletConfigured = Boolean(networkReady && projectId && /^[a-f0-9]{32}$/i.test(projectId));
const config = walletConfigured ? getDefaultConfig({
  appName: 'Heyyo.club', projectId: projectId!, chains: [walletNetwork],
  transports: { [walletNetwork.id]: http(rpcUrl) },
  wallets: [
    { groupName: 'Wallets', wallets: [bitgetWallet, binanceWallet, okxWallet] },
    { groupName: 'Popular', wallets: [metaMaskWallet, rainbowWallet, walletConnectWallet] },
  ],
  ssr: false,
}) : undefined;
const queryClient = new QueryClient();

function WalletBridge({ children }: { children: ReactNode }) {
  const { address, isConnected, status, chainId: activeChainId, connector } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const [selected, setSelected] = useState<{ uid: string; provider: Eip1193Provider }>();
  useEffect(() => {
    let disposed = false;
    setSelected(undefined);
    if (isConnected && connector && typeof connector.getProvider === 'function') {
      void connector.getProvider().then(provider => {
        if (!disposed && provider && typeof (provider as Eip1193Provider).request === 'function') {
          setSelected({ uid: connector.uid, provider: provider as Eip1193Provider });
        }
      }).catch(() => { if (!disposed) setSelected(undefined); });
    }
    return () => { disposed = true; };
  }, [connector, isConnected]);
  return <WalletContext.Provider value={{
    address: isConnected && address ? address : null,
    provider: isConnected && selected?.uid === connector?.uid ? selected?.provider : undefined,
    connecting: status === 'connecting' || status === 'reconnecting',
    configured: true,
    wrongNetwork: isConnected && activeChainId !== walletNetwork.id,
    connect: async () => { if (!openConnectModal) throw new Error('Wallet modal is not ready'); openConnectModal(); },
    manage: async () => { if (!openAccountModal) throw new Error('Wallet is not connected'); openAccountModal(); },
    disconnect: async () => { await disconnectAsync(); },
    switchNetwork: async () => { await switchChainAsync({ chainId: walletNetwork.id }); },
  }}>{children}</WalletContext.Provider>;
}

export default function WalletProvider({ children }: { children: ReactNode }) {
  if (!config) return <>{children}</>;
  return <WagmiProvider config={config}><QueryClientProvider client={queryClient}>
    <RainbowKitProvider locale="en-US" theme={lightTheme({ accentColor: '#24271d', accentColorForeground: '#ffffff', borderRadius: 'large' })}>
      <WalletBridge>{children}</WalletBridge>
    </RainbowKitProvider>
  </QueryClientProvider></WagmiProvider>;
}
