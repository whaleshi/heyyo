import type { Eip1193Provider } from 'ethers';
import { createContext, useContext } from 'react';

export type WalletSession = {
  provider?: Eip1193Provider;
  address: string | null;
  connecting: boolean;
  configured: boolean;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  manage: () => Promise<void>;
  switchNetwork: () => Promise<void>;
};
const unavailable = async () => { throw new Error('Wallet is not configured'); };
const disconnectedWallet: WalletSession = {
  address: null, connecting: false, configured: false, wrongNetwork: false,
  connect: unavailable, disconnect: unavailable, manage: unavailable, switchNetwork: unavailable,
};
export const WalletContext = createContext<WalletSession>(disconnectedWallet);
export const useWallet = () => useContext(WalletContext);

