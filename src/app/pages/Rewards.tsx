import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Coins, Layers3, Leaf, Wallet } from 'lucide-react';
import { Avatar, CreateButton, Empty } from '../components';
import { useHeyyo } from '../context';
import { useWallet } from '../wallet-context';
import { claimToken, formatUnits } from '../contracts/client';
import { loadRewards, loadClaimHistory, type ClaimRecord, type Reward } from '../contracts/rewards';

function RewardsLoading({ label, history = false }: { label: string; history?: boolean }) {
  return <div className={`rewards-loading ${history ? 'rewards-loading-history' : ''}`} role="status" aria-live="polite">
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">{[0, 1].map(row => <div className="rewards-loading-row" key={row}>
      {!history && <span className="rewards-loading-avatar"/>}
      <div className="rewards-loading-identity"><span className="rewards-loading-name"/><span className="rewards-loading-detail"/></div>
      <div className="rewards-loading-value"><span/><span/></div>
      {!history && <span className="rewards-loading-button"/>}
    </div>)}</div>
  </div>;
}

export function Rewards({ showWallet }: { showWallet: () => void }) {
  const { l, notify, walletConnecting, wrongNetwork } = useHeyyo();
  const wallet = useWallet();
  const [result, setResult] = useState<{ address: string; rewards: Reward[] } | null>(null);
  const [history, setHistory] = useState<{address: string; records: ClaimRecord[]} | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [tab, setTab] = useState('tokens');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, refresh] = useState(0);
  const [claiming, setClaiming] = useState('');
  const busy = useRef(false);
  useEffect(() => {
    if (!wallet.address) return;
    const address = wallet.address, controller = new AbortController();
    setError(false);
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      setLoading(true);
      try {
        const rewards = await loadRewards(address, controller.signal);
        if (!controller.signal.aborted) { setResult({ address, rewards }); setError(false); }
      } catch { if (!controller.signal.aborted) { setError(true); } }
      finally { if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(update, 15000); } }
    }
    void update();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [wallet.address, revision]);
  useEffect(() => {
    if (!wallet.address || tab !== 'history') return;
    const address = wallet.address, controller = new AbortController();
    setHistoryError(false);
    loadClaimHistory(address, controller.signal).then(records => {
      if (!controller.signal.aborted) setHistory({address,records});
    }).catch(() => { if (!controller.signal.aborted) setHistoryError(true); });
    return () => controller.abort();
  }, [wallet.address, tab, revision]);
  const created = result?.address === wallet.address ? result.rewards : [];
  const totals = new Map<string, { decimals: number; symbol: string; claimable: bigint; claimed: bigint }>();
  for (const token of created) {
    const key = `${token.paymentKind}:${token.paymentToken}`;
    const total = totals.get(key) ?? { decimals: token.paymentDecimals, symbol: token.paymentSymbol, claimable: 0n, claimed: 0n };
    total.claimable += token.claimable; total.claimed += token.claimed; totals.set(key, total);
  }
  const totalText = (field: 'claimable' | 'claimed') => result?.address !== wallet.address || !result ? '0' : totals.size ? [...totals.values()].map(t => `${formatUnits(t[field], t.decimals)} ${t.symbol}`).join(' + ') : '0';
  async function claim(token: Reward) {
    if (busy.current || !wallet.provider || !wallet.address || wrongNetwork) return;
    busy.current = true; setClaiming(token.launchId);
    try {
      const receipt = await claimToken(wallet.provider, wallet.address, token.launchId, () => {});
      notify(`Claimed ${receipt.amount} ${receipt.symbol}.`, `已领取 ${receipt.amount} ${receipt.symbol}。`);
      refresh(v => v + 1);
    } catch { notify('Claim was not confirmed. Check your wallet transaction before retrying.', '领取尚未确认，请检查钱包交易后再重试。'); }
    finally { busy.current = false; setClaiming(''); }
  }
  return <div className="rewards-page"><div className="page-heading"><div className="eyebrow">{l('GOOD IDEAS DESERVE GOOD THINGS', '好灵感，值得好回报')}</div><h1>{l('Your creativity. Your upside.', '你的灵感，你的回报。')}</h1><p>{l('A home for your tokens and the rewards they bring.', '你的代币和它们带来的每一份回报，都在这里。')}</p></div>
    {!wallet.address ? <section className="rewards-connect"><div className="rewards-connect-art"><img src="/heyyo-logo.png" alt="Heyyo waving hello"/><span>good things<br/>come around.</span></div><div><span className="eyebrow">{l('HEY, CREATOR', 'HEY，创作者')}</span><h2>{l('Make yourself at home.', '欢迎来到你的主场。')}</h2><p>{l('Connect your wallet to see your creations and rewards.', '连接钱包，查看你的代币和收益。')}</p><button className="button button-dark" onClick={showWallet} disabled={walletConnecting}><Wallet size={17}/>{l('Connect wallet', '连接钱包')}</button></div></section> : <>
      <div className="reward-stats"><article><span><Coins size={17}/>{l('Claimable rewards', '待领取收益')}</span><strong>{totalText('claimable')}</strong><p>{l('Claim separately for each token.', '请逐个代币领取。')}</p></article><article><span><Wallet size={17}/>{l('Total claimed', '累计已领取')}</span><strong>{totalText('claimed')}</strong><p>{l('Confirmed on-chain rewards', '链上已确认的收益')}</p></article><article><span><Layers3 size={17}/>{l('Tokens created', '已创建代币')}</span><strong>{result?.address === wallet.address ? created.length : '0'}</strong><p>{l('Your creations on Heyyo', '你在 Heyyo 创建的代币')}</p></article></div>
      <section className="reward-workspace"><div className="reward-workspace-heading"><div className="content-tabs"><button className={tab === 'tokens' ? 'active' : ''} onClick={() => setTab('tokens')}>{l('Your tokens', '我的代币')}</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>{l('Claim history', '领取记录')}</button></div><a href="#/create" className="text-button">{l('Create a token', '创建代币')}<ArrowUpRight size={15}/></a></div>
      {tab === 'history' ? historyError ? <Empty title={l('Unable to load claim history', '领取记录加载失败')} description="" action={<button className="button" onClick={() => refresh(v => v + 1)}>{l('Retry','重试')}</button>}/> : history?.address !== wallet.address ? <RewardsLoading history label={l('Loading history…','正在读取记录…')}/> : history.records.length ? <ul className="claim-history">{history.records.map(record => { return <li key={`${record.hash}-${record.logIndex}`}><div><strong>{`$${record.ticker}`}</strong><span>{l('Block','区块')} {record.block.toString()}</span><code className="transaction-status">{record.hash}</code></div><b>{formatUnits(record.amount, record.decimals)} {record.symbol}</b></li>; })}</ul> : <Empty title={l('No claims yet','暂无领取记录')} description=""/> : error && result?.address !== wallet.address ? <Empty title={l('Unable to load rewards', '收益加载失败')} description={l('Please retry to verify your on-chain balances.', '请重试以核验链上余额。')} action={<button className="button" onClick={() => refresh(v => v + 1)}>{l('Retry', '重试')}</button>}/> : result?.address !== wallet.address ? <RewardsLoading label={l('Loading rewards…', '正在读取收益…')}/> : created.length ? <div className="created-list">{created.map(token => <div className="token-reward-row" key={token.launchId}>
        <div className="token-reward-identity"><Avatar token={{ name: token.name, image: token.image, color: '#eaf3d0', emoji: token.ticker.slice(0,2) }}/><div><strong>{token.name}</strong><span>${token.ticker}</span></div></div>
        <div className="token-reward-amount"><span>{l('Claimable', '待领取')}</span><strong>{formatUnits(token.claimable, token.paymentDecimals)} <small>{token.paymentSymbol}</small></strong><small>{l('Pending allocation', '待分配')}: {formatUnits(token.pending, token.paymentDecimals)} {token.paymentSymbol}</small><small>{l('Pending buyback', '待回购')}: {formatUnits(token.pendingBuyback, token.paymentDecimals)} {token.paymentSymbol}</small></div>
        <button className="button button-dark token-claim-button" disabled={error || loading || !!claiming || token.claimable === 0n || wrongNetwork} onClick={() => void claim(token)}>{claiming === token.launchId ? l('Confirming…', '确认中…') : l('Claim', '领取收益')}</button>
      </div>)}</div> : <Empty title={l('No data yet', '暂无数据')} description="" action={<CreateButton/>}/>}
      {error && result?.address === wallet.address && <p className="indexer-notice" role="status">{l('Refresh failed. Showing the last indexed balances.', '刷新失败，当前显示上次索引的余额。')}<button className="text-button" onClick={() => refresh(v=>v+1)}>{l('Retry','重试')}</button></p>}
      </section></>}
    <div className="rewards-footnote"><Leaf size={21}/><div><strong>{l('Built to give back.', '为回馈而构建。')}</strong><p>{l('Your share becomes claimable after allocation. Pending fees are shown separately.', '你的份额在分配入账后可领取，尚未分配的费用单独展示。')}</p></div></div>
  </div>;
}
