import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { claimCreatorRewards, initialState, restoreWalletState, walletStorageKey, type DemoState, type Locale } from './model';
import { Context } from './context';
import { useWallet } from './wallet-context';

// Keep persisted demo state separate from the stable shared React context.
const getStored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export function HeyyoProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const storageKey = walletStorageKey(wallet.address);
  const [accounts, setAccounts] = useState<Record<string, DemoState>>({});
  const restored = useMemo(() => restoreWalletState(storageKey ? getStored(storageKey) : null), [storageKey]);
  // The active wallet is authoritative; a saved connected flag never authenticates an account.
  const state = { ...(storageKey ? accounts[storageKey] ?? restored : restored), connected: !!wallet.address };
  const stateRef = useRef(state);
  stateRef.current = state;
  const [locale, setLocale] = useState<Locale>('en');
  const [toast, setToast] = useState('');
  const [storageError, setStorageError] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const l = (en: string, zh: string) => locale === 'en' ? en : zh;
  function update(next: DemoState) {
    if (!storageKey) return;
    stateRef.current = next;
    setAccounts(current => ({ ...current, [storageKey]: next }));
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, state: { ...next, connected: false } }));
      setStorageError(false);
    } catch { setStorageError(true); }
  }
  useEffect(() => { setStorageError(false); setToast(''); }, [storageKey]);
  useEffect(() => { document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'; }, [locale]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const notify = (en: string, zh: string) => { clearTimeout(toastTimer.current); setToast(l(en, zh)); toastTimer.current = setTimeout(() => setToast(''), 3800); };
  const walletAction = (action: () => Promise<void>) => {
    if (!wallet.configured) { notify('Wallet connection is not available yet.', '钱包连接暂未开放。'); return; }
    void action().catch(() => notify('Wallet request could not be completed. Please try again.', '钱包请求未完成，请重试。'));
  };
  return <Context.Provider value={{ state, walletAddress: wallet.address, walletConnecting: wallet.connecting, wrongNetwork: wallet.wrongNetwork, locale, setLocale, l, notify, toast, storageError,
    connect: () => walletAction(wallet.connect),
    disconnect: () => walletAction(wallet.disconnect),
    manageWallet: () => walletAction(wallet.manage),
    switchNetwork: () => walletAction(wallet.switchNetwork),
    claimRewards: tokenId => {
      const current = stateRef.current;
      if (!wallet.address || wallet.wrongNetwork) return 0;
      const next = claimCreatorRewards(current, tokenId, crypto.randomUUID(), Date.now());
      if (next === current) return 0;
      update(next);
      return current.claimableRewardsByToken[tokenId];
    },
    resetDemo: () => update(initialState()),
    create: token => {
      if (!wallet.address || wallet.wrongNetwork) return false;
      const s = stateRef.current;
      update({ ...s, tokens: [token, ...s.tokens] });
      return true;
    },

  }}>{children}</Context.Provider>;
}
