import { networkName } from './contracts/config';
import { useEffect, useState } from 'react';
import { Check, ArrowLeft } from 'lucide-react';
import { HeyyoProvider } from './store';
import { useHeyyo } from './context';
import { Empty, Footer, Header, Mechanism } from './components';
import { Explore } from './pages/Explore';
import { Create } from './pages/Create';
import { ayooTokenUrl } from './model';
import { Rewards } from './pages/Rewards';

function AppContent() {
  const { state, l, toast, storageError, connect, wrongNetwork, switchNetwork } = useHeyyo();
  const [path, setPath] = useState(() => window.location.hash.slice(1) || '/');
  const [mechanism, setMechanism] = useState(false);
  useEffect(() => { const onHash = () => { setPath(window.location.hash.slice(1) || '/'); window.scrollTo({ top: 0 }); }; window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  useEffect(() => { document.title = `${path === '/create' ? l('Create a token', '创建代币') : path === '/rewards' ? l('My rewards', '我的收益') : l('Small wave. Big ripple.', '小小招呼，层层回响。')} — Heyyo.club`; }, [path, l]);
  useEffect(() => {
    if (path.startsWith('/token/')) window.location.replace(ayooTokenUrl(state.tokens.find(t => t.id === path.slice(7))));
  }, [path, state.tokens]);
  return <div className="app"><a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById("main")?.focus(); }}>{l('Skip to content', '跳至内容')}</a><Header page={path} showMechanism={() => setMechanism(true)}/>
    {storageError && <div className="storage-warning" role="status">{l('Your changes could not be saved. Please free up storage and try again.', '更改暂时无法保存，请清理存储空间后重试。')}</div>}
    {wrongNetwork && <div className="network-warning" role="status"><span>{l(`Please switch to ${networkName} to continue.`, `请切换至 ${networkName} 后继续操作。`)}</span><button className="text-button" onClick={switchNetwork}>{l('Switch network', '切换网络')}</button></div>}
    <main id="main" tabIndex={-1} className={`main ${path === '/' ? 'main-explore' : ''}`} key={path}>
      {path === '/' ? <Explore showMechanism={() => setMechanism(true)}/> : path === '/create' ? <Create showWallet={connect}/> : path === '/rewards' ? <Rewards showWallet={connect}/> : <Empty title={l('This token took a different turn.', '没有找到这个页面。')} description={l('This page is unavailable. Try exploring other tokens.', '页面暂不可用，去发现其他代币吧。')} action={<a href="#/" className="button button-dark"><ArrowLeft size={16}/>{l('Back to explore', '返回发现')}</a>}/>}
    </main><Footer showMechanism={() => setMechanism(true)}/><Mechanism open={mechanism} onClose={() => setMechanism(false)}/>
    <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">{toast && <><Check size={17}/>{toast}</>}</div>
  </div>;
}
export default function App() { return <HeyyoProvider><AppContent/></HeyyoProvider>; }
