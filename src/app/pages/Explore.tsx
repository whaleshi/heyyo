import { useEffect, useState } from 'react';
import { ArrowDownUp, ArrowRight, ArrowUpRight, Clock3, Flame, Leaf, Rocket, Search, TrendingUp, X } from 'lucide-react';
import { Avatar, CreateButton, Empty, PlatformBadge } from '../components';
import { ayooTokenUrl, money, platformTokenAddress } from '../model';
import { useHeyyo } from '../context';
import { useIndexedTokens, type BoardPages } from '../indexer/use-indexed-tokens';
import type { IndexedToken, TokenSort, TokenStage } from '../../../shared/indexer';

function TokenCard({ token }: { token: IndexedToken }) {
  const { l } = useHeyyo();
  const minutes = Math.max(1, Math.floor((Date.now() - token.createdAt) / 60000));
  const age = minutes < 60 ? `${minutes}${l('m', '分钟')}` : minutes < 1440 ? `${Math.floor(minutes / 60)}${l('h', '小时')}` : `${Math.floor(minutes / 1440)}${l('d', '天')}`;
  const graduated = token.stage === 'graduated';
  const href = ayooTokenUrl(token);
  return <article className="token-card">
    <a href={href} target="_blank" rel="noopener noreferrer" className="token-card-main" aria-label={`${token.name} (${token.ticker})`}>
      <div className="token-top"><Avatar token={{name:token.name,image:token.image,emoji:token.ticker.slice(0,2),color:'#eaf3d0'}}/><div className="token-identity"><h3>{token.name}</h3><p>${token.ticker}<span>·</span>{age}</p></div></div>
      <p className="token-description">{token.description}</p>
      <div className="token-metrics"><div><span>{l('Market cap', '市值')}</span><strong>{token.marketCap === null ? '0' : money(token.marketCap,true)}</strong></div>
        <div className="align-right"><span>{l('24h change','24h 涨跌')}</span><strong className={token.change === null ? 'muted' : token.change >= 0 ? 'positive' : 'negative'}>{token.change === null ? '0' : `${token.change>0?'+':''}${token.change.toFixed(1)}%`}{token.change!==null && <TrendingUp size={12}/>}</strong></div></div>
      <div className="indexed-volume"><span>{l('24h volume','24h 交易量')}</span><span>{token.volume===null?'0':money(token.volume,true)}</span></div>
      <div className={`progress-track ${graduated?'complete':''}`} aria-label={`${l('Curve progress','曲线进度')} ${token.progress === null ? '0' : `${token.progress}%`}`}><span style={{width:`${token.progress ?? 0}%`}}/></div>
      <div className="token-bottom"><PlatformBadge/><span>{graduated ? <><Rocket size={11}/>{l('Graduated','已毕业')}</> : token.progress === null ? '0' : `${Math.floor(token.progress*100)/100}%`}</span></div>
    </a>
  </article>;
}
const showPlatformToken = import.meta.env.VITE_SHOW_PLATFORM_TOKEN === 'true';
const firstPages: BoardPages = {new:1,soon:1,graduated:1};
export function Explore({ showMechanism }: { showMechanism: () => void }) {
  const { l } = useHeyyo();
  const [query,setQuery] = useState('');
  const [debouncedQuery,setDebouncedQuery] = useState('');
  const [sort,setSort] = useState<TokenSort>('recent');
  const [pages,setPages] = useState<BoardPages>(firstPages);
  const [mobileLane,setMobileLane] = useState<TokenStage>('new');
  useEffect(() => { const timer=setTimeout(() => {setDebouncedQuery(query.trim());setPages(firstPages);},350); return () => clearTimeout(timer); },[query]);
  const board = useIndexedTokens(debouncedQuery,sort,pages);
  const counts = board.data?.new.counts;
  useEffect(() => {
    if (debouncedQuery && counts && counts[mobileLane]===0) {
      const match = (['new','soon','graduated'] as const).find(stage => counts[stage]>0);
      if (match) setMobileLane(match);
    }
  },[debouncedQuery,counts,mobileLane]);
  const lanes = [
    {id:'new' as const,title:l('Just said heyyo','刚刚打个招呼'),subtitle:l('Fresh faces. First waves.','新面孔，第一波。'),icon:Clock3},
    {id:'soon' as const,title:l('Making waves','正在掀起波澜'),subtitle:l('A little closer to graduation.','距离毕业，又近了一步。'),icon:Flame},
    {id:'graduated' as const,title:l('Out in the world','走向更大世界'),subtitle:l('Graduated. Still growing.','已经毕业，继续生长。'),icon:Rocket},
  ];
  const pendingContract = board.error==='CONTRACT_NOT_CONFIGURED';
  return <>
    <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="status-dot"/>{l('GOOD MEMES. SHARED UPSIDE.', '好 MEME，一起成长。')}</div><h1>{l('Small wave.', '小小招呼，')} <span>{l('Big ripple.', '层层回响。')}</span></h1><p>{l('Launch on Heyyo. Grow with Ayoo.club. Earn as you go.', '在 Heyyo 创建，与 Ayoo.club 一起成长，让每次交易带来回响。')}</p><div className="hero-actions"><CreateButton/><button className="text-button" onClick={showMechanism}>{l('How it works', '了解运作机制')}<ArrowUpRight size={16}/></button></div></div><div className="hero-art" aria-hidden="true"><span className="hero-caption">oh, hey you!</span><img src="/heyyo-logo.png" alt=""/><span className="hero-sticker">say heyyo.</span></div></section>
    {showPlatformToken && <section className="heyyo-strip" aria-label={l('HEYYO overview', 'HEYYO 概览')}><div className="platform-identity"><img src="/heyyo-logo.png" alt="HEYYO"/><div><h2>$HEYYO <span>{l('THE COMMUNITY TOKEN', '社区代币')}</span></h2><p>{l('Every little wave gives back.', '每一次涟漪，都有回馈。')}</p></div></div><div className="strip-stat"><span>{l('Total bought back & burned', '累计回购并销毁')}</span><strong>0<span> $HEYYO</span></strong></div><div className="strip-stat"><span>{l('Creator rewards', '创作者奖励')} </span><strong>0<span> USDC</span></strong></div><a className="strip-link" href={ayooTokenUrl({contractAddress:platformTokenAddress})} target="_blank" rel="noopener noreferrer" aria-label={l('View HEYYO on Ayoo', '在 Ayoo 查看 HEYYO')}><span>50% {l('buyback & burn', '回购并销毁')}<br/>50% {l('to creators', '创作者奖励')}</span><ArrowUpRight size={19}/></a></section>}
    <div className="explore-toolbar"><div className="search-wrap"><Search size={18}/><input maxLength={64} aria-label={l('Search tokens','搜索代币')} placeholder={l('Find your next little obsession…','发现下一个让你心动的 Meme…')} value={query} onChange={e=>setQuery(e.target.value)}/>{query ? <button className="icon-button" aria-label={l('Clear search','清空搜索')} onClick={()=>setQuery('')}><X size={15}/></button> : <span className="search-hint">{l('name / ticker','名称 / 符号')}</span>}</div>
      <label className="sort-control"><ArrowDownUp size={15}/><select aria-label={l('Sort tokens','代币排序')} value={sort} onChange={e=>{setSort(e.target.value as TokenSort);setPages(firstPages);}}><option value="recent">{l('Newest','最新')}</option><option value="market">{l('Market cap','市值')}</option><option value="volume">{l('24h volume','24h 交易量')}</option></select></label></div>
    <div className="board-caption"><span><span className="sample-dot"/>{l('Discover Heyyo tokens','发现 Heyyo 代币')}</span><span><Leaf size={12}/>{l('Powered by Ayoo bonding curve','基于 Ayoo Bonding Curve')}</span></div>
    {board.error && board.data && <div className="indexer-notice" role="status">{l('Refresh failed. Showing the last available data.','刷新失败，当前显示上次获取的数据。')}<button className="text-button" onClick={board.retry}>{l('Retry','重试')}</button></div>}
    {<div className="mobile-lane-tabs" role="group" aria-label={l('Token stages','代币阶段')}>{lanes.map(lane=><button key={lane.id} aria-pressed={mobileLane===lane.id} aria-controls={`lane-${lane.id}`} className={mobileLane===lane.id?'active':''} onClick={()=>setMobileLane(lane.id)}>{lane.id==='new'?l('New','新上线'):lane.id==='soon'?l('Soon','即将毕业'):l('Graduated','已毕业')}<span>{counts?.[lane.id]??0}</span></button>)}</div>}
    {!board.data && board.error ? <Empty title={pendingContract?l('No data yet','暂无数据'):l('The token list is unavailable.','暂时无法获取代币列表。')} description={pendingContract?'':l('Please try again in a moment.','请稍后重试。')} action={!pendingContract && <button className="button button-dark" onClick={board.retry}>{l('Try again','重试')}</button>}/> : <>
      {board.loading && <p className="sr-only" role="status">{board.data?l('Updating…','正在更新…'):l('Loading tokens…','正在加载代币…')}</p>}
      <div className="token-board" aria-busy={board.loading}>{lanes.map(({id,title,subtitle,icon:Icon})=>{
        const data=board.data?.[id];
        const totalPages=data?Math.max(1,Math.ceil(data.total/data.pageSize)):1;
        return <section key={id} id={`lane-${id}`} className={`lane lane-${id} ${mobileLane===id?'mobile-active':''}`}><header className="lane-heading"><div><h2><Icon size={18}/>{title}<span>{data?.total??'0'}</span></h2><p>{subtitle}</p></div></header>
          <div className="lane-cards">{!data ? <><div className="token-skeleton"/><div className="token-skeleton"/></> : data.items.length ? data.items.map(token=><TokenCard key={token.id} token={token}/>) : <div className="lane-empty"><div className="lane-empty-art" aria-hidden="true"><Icon size={32} strokeWidth={1.2}/></div><h3>{debouncedQuery?l('No matching tokens','没有匹配的代币'):l('No data yet','暂无数据')}</h3></div>}</div>
          {data && (totalPages>1 || pages[id]>1) && <nav className="lane-pagination" aria-label={l(`${title} pages`,`${title}分页`)}><button className="text-button" disabled={pages[id]<=1||board.loading} onClick={()=>setPages(current=>({...current,[id]:Math.max(1,current[id]-1)}))}>{l('Previous','上一页')}</button><span>{pages[id]} / {totalPages}</span><button className="text-button" disabled={pages[id]>=totalPages||board.loading} onClick={()=>setPages(current=>({...current,[id]:current[id]+1}))}>{l('Next','下一页')}</button></nav>}
        </section>;
      })}</div>
      {board.data && <p className="indexer-update">{l('Data updated','数据更新于')} {new Date(board.data.new.updatedAt).toLocaleTimeString()}</p>}
    </>}
    <div className="explore-end">{l('A good idea starts with a heyyo.','每一个好点子，都从一句 Heyyo 开始。')}<a href="#/create">{l('Make yours','创建你的代币')}<ArrowRight size={14}/></a></div>
  </>;
}
