import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowRight, Check, ChevronDown, ChevronRight, Copy, LogOut, ExternalLink, Globe2, Leaf, Plus, Sparkles, Wallet, X } from 'lucide-react';
import { allocateCreatorFees, money, type Token } from './model';
import { useHeyyo } from './context';

export function Brand({ small = false }: { small?: boolean }) { return <a href="#/" className={`brand ${small ? 'small' : ''}`} aria-label="Heyyo! home"><img src="/heyyo-logo.png" alt=""/><span className="brand-wordmark">Heyyo<span className="brand-bang">!</span></span></a>; }
export function Avatar({ token, large = false }: { token: Pick<Token, 'name' | 'image' | 'color' | 'emoji'>; large?: boolean }) { return <span className={`avatar ${large ? 'large' : ''}`} style={{ background: token.color }}>{token.image ? <img src={token.image} alt={token.name}/> : <span aria-hidden="true">{token.emoji}</span>}</span>; }
export function PlatformBadge() {
  return <span className="platform-badge"><span className="tiny-dot"/> Heyyo <span className="badge-plus">+</span> Ayoo</span>;
}
export function Modal({ open, onClose, title, description, children, wide = false }: { open: boolean; onClose: () => void; title: string; description: string; children: ReactNode; wide?: boolean }) {
  const { l } = useHeyyo();
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className={`modal ${wide ? 'wide' : ''}`} onCloseAutoFocus={event => { if (!(document.activeElement instanceof HTMLElement)) event.preventDefault(); }}><div className="modal-heading"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div><Dialog.Close className="icon-button" aria-label={l('Close dialog', '关闭弹窗')}><X size={20}/></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
function WalletButton() {
  const { walletAddress, walletConnecting, manageWallet, connect, disconnect, l, notify } = useHeyyo();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (!walletAddress) setOpen(false); }, [walletAddress]);
  async function copyAddress() {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      notify('Wallet address copied.', '钱包地址已复制。');
    } catch { notify('Could not copy the address. Please try again.', '地址复制失败，请重试。'); }
    setOpen(false); trigger.current?.focus();
  }
  if (!walletAddress) return <button className="button button-dark wallet-button" onClick={connect} disabled={walletConnecting} aria-label={l('Connect wallet', '连接钱包')}><Wallet size={16}/><span>{walletConnecting ? l('Connecting…', '连接中…') : l('Connect wallet', '连接钱包')}</span></button>;
  return <div className="wallet-dropdown" ref={container} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button ref={trigger} className="button button-dark wallet-button wallet-account" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)}><span>{walletAddress.slice(0, 4)}…{walletAddress.slice(-4)}</span><ChevronDown size={14} className={open ? 'expanded' : ''}/></button>
    {open && <div id={menuId} className="wallet-dropdown-panel"><button onClick={() => { setOpen(false); manageWallet(); }}><Wallet size={15}/>{l('Manage wallet', '管理钱包')}</button><button onClick={() => void copyAddress()}><Copy size={15}/>{l('Copy wallet address', '复制钱包地址')}</button><button onClick={() => { setOpen(false); disconnect(); }}><LogOut size={15}/>{l('Disconnect', '断开连接')}</button></div>}
  </div>;
}
export function Header({ page, showMechanism }: { page: string; showMechanism: () => void }) {
  const { l, locale, setLocale } = useHeyyo();
  return <header className="header"><div className="header-inner"><Brand/><nav aria-label={l('Main navigation', '主导航')}><a href="#/" aria-current={page === '/' ? 'page' : undefined} className={page === '/' ? 'active' : ''}>{l('Explore', '发现')}</a><a href="#/rewards" aria-current={page === '/rewards' ? 'page' : undefined} className={page === '/rewards' ? 'active' : ''}>{l('My rewards', '我的收益')}</a><button onClick={showMechanism}>{l('How it works', '运作机制')}</button></nav><div className="header-actions"><button className="language-button" onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')} aria-label={l('Switch to Chinese', '切换到英文')}><Globe2 size={16}/><span>{locale === 'en' ? '中文' : 'EN'}</span></button><a className="x-link" href="https://x.com/heyyo_club" target="_blank" rel="noopener noreferrer" aria-label={l('Heyyo on X (opens in a new tab)', 'Heyyo 的 X 主页（新标签页打开）')}><svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817-5.963 6.817H1.683l7.73-8.835L1.254 2.25H8.08l4.713 6.231L18.244 2.25Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/></svg></a><WalletButton/></div></div></header>;
}
export function Footer({ showMechanism }: { showMechanism: () => void }) {
  const { l } = useHeyyo();
  return <footer className="footer"><Brand small/><p>{l('A little wave goes a long way.', '一个小小的招呼，也能激起涟漪。')}</p><div><button onClick={showMechanism}>{l('How it works', '运作机制')} <ChevronRight size={13}/></button><a href="https://ayoo.club/arc" target="_blank" rel="noreferrer">{l('Built on Ayoo', '基于 Ayoo')}<ExternalLink size={12}/></a></div></footer>;
}
export function Mechanism({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { l } = useHeyyo();
  const [pool, setPool] = useState('100');
  const validPool = pool !== '' && Number.isFinite(Number(pool)) && Number(pool) >= 0 && Number(pool) <= 1e9;
  const fees = allocateCreatorFees(validPool ? Number(pool) : 0);
  return <Modal open={open} onClose={onClose} wide title={l('Good things come full circle.', '让每一次交易，都有回响。')} description={l('One launch. Two communities. Shared upside.', '一次创建，两个社区，共享成长。')}>
    <div className="mechanism-intro"><div className="mechanism-icon"><img src="/heyyo-logo.png" alt="Heyyo"/></div><p>{l('Launch on Heyyo using the Ayoo bonding curve. Your token appears on both Heyyo and Ayoo.', '使用 Ayoo Bonding Curve 在 Heyyo 创建代币，同步展示在 Heyyo 与 Ayoo。')}</p></div>
    <div className="flow-top"><span>{l('Ayoo creator fees', 'Ayoo 创作者手续费')}</span><strong>70% <ArrowRight size={17}/> Heyyo</strong></div><ArrowDown className="flow-arrow" size={20}/>
    <div className="flow-split"><div><Leaf size={23}/><strong>50%</strong><b>{l('$HEYYO buyback & burn', '$HEYYO 回购并销毁')}</b><p>{l('Bought back. Burned for good.', '回购 $HEYYO，并永久销毁。')}</p></div><div><Sparkles size={23}/><strong>50%</strong><b>{l('Creator rewards', '创作者奖励')}</b><p>{l('Accumulates for the token creator to claim per token.', '累积为创作者收益，需按代币手动领取。')}</p></div></div>
    <p className="fine-print">{l('Both 50% shares are calculated from fees received by Heyyo, not trading volume. Each equals 35% of the original creator fee pool.', '两个 50% 均以 Heyyo 收到的手续费为基数，而非交易额；各占原始创作者手续费的 35%。')}</p>
    <div className="fee-calculator"><label htmlFor="creator-fees">{l('Fee distribution', '手续费分配')}<span>{l('Original creator fees · USDC', '原始创作者手续费 · USDC')}</span></label><input id="creator-fees" type="number" min="0" max="1000000000" step="any" value={pool} onChange={e => setPool(e.target.value)} aria-invalid={!validPool}/><div><span>{l('Buyback & burn budget', '回购销毁预算')}<b>{validPool ? money(fees.buyback) : '—'}</b></span><span>{l('Creator earns', '创作者获得')}<b>{validPool ? money(fees.creator) : '—'}</b></span></div></div>
    <p className="mechanism-bottom">{l('More trading → more fees → more buybacks & burns + more creator rewards.', '更多交易 → 更多手续费 → 更多回购销毁 + 更多创作者收入。')}</p>
    <button className="button button-dark full" onClick={onClose}>{l('Got it. Say heyyo.', '明白了，Heyyo！')} <Check size={16}/></button>
  </Modal>;
}
export function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Leaf size={25}/></span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>; }
export function CreateButton() { const { l } = useHeyyo(); return <a className="button button-lime" href="#/create"><Plus size={18}/>{l('Create a token', '创建代币')}</a>; }
