import { createContext, useContext } from 'react';
import type { DemoState, Locale, Token } from './model';

type Store = {
  state: DemoState; locale: Locale; setLocale: (v: Locale) => void;
  l: (en: string, zh: string) => string; notify: (en: string, zh: string) => void;
  walletAddress: string | null; walletConnecting: boolean; wrongNetwork: boolean;
  manageWallet: () => void; switchNetwork: () => void;
  toast: string; storageError: boolean; connect: () => void; disconnect: () => void; resetDemo: () => void;
  create: (token: Token) => boolean;
  claimRewards: (tokenId: string) => number;
};
export const Context = createContext<Store | null>(null);
export const useHeyyo = () => { const context = useContext(Context); if (!context) throw new Error('Missing HeyyoProvider'); return context; };
