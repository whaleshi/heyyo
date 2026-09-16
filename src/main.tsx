import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';

const WalletProvider = lazy(() => import('./app/wallet'));
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim();
const configured = Boolean(projectId && /^[a-f0-9]{32}$/i.test(projectId));

createRoot(document.getElementById('root')!).render(
  configured ? <Suspense fallback={<div className="wallet-loading" role="status">Heyyo…</div>}>
    <WalletProvider><App /></WalletProvider>
  </Suspense> : <App />
);
