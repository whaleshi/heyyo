import { PaymentCheckError } from '../contracts/payment-check';
import { pinFile, pinMetadata } from '../contracts/upload';
import { parseUnits } from 'ethers';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ImagePlus, Leaf, X } from 'lucide-react';
import { Avatar, PlatformBadge } from '../components';
import { go } from '../navigation';
import { isSafeUrl, type Token } from '../model';
import { useHeyyo } from '../context';
import { useWallet } from '../wallet-context';
import { creationReady, launchConfig, networkName } from '../contracts/config';
import { createToken, createAndBuy } from '../contracts/client';
import { publicRpc } from '../contracts/rewards';
import { readCreationConfig } from '../../../shared/contracts';

export function Create({ showWallet }: { showWallet: () => void }) {
  const { state, l, notify, wrongNetwork, switchNetwork, walletConnecting } = useHeyyo();
  const wallet = useWallet();
  const submitting = useRef(false);
  const [txHash, setTxHash] = useState('');
  const [imageCid, setImageCid] = useState('');
  const uploadRequest = useRef<AbortController | null>(null);
  const selectedFile = useRef<File>();
  const metadataRequest = useRef<AbortController | null>(null);
  const [uploadingMetadata, setUploadingMetadata] = useState(false);
  const metadataCache = useRef<{key:string;uri:string} | null>(null);
  useEffect(() => () => { fileVersion.current++; uploadRequest.current?.abort(); metadataRequest.current?.abort(); }, []);
  const [initialBuy, setInitialBuy] = useState('');
  const [payment, setPayment] = useState<Awaited<ReturnType<typeof readCreationConfig>> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (creationReady) readCreationConfig(publicRpc(controller.signal), launchConfig).then(v => { if (!controller.signal.aborted) setPayment(v); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState({ name: '', ticker: '', description: '', image: '', website: '', x: '', telegram: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileVersion = useRef(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const tickerRef = useRef<HTMLInputElement>(null);
  const [publishing, setPublishing] = useState(false);
  const patch = (key: keyof typeof draft, value: string) => { setDraft(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: '' })); };
  async function readImage(file?: File) {
    if (!file) return;
    const version = ++fileVersion.current;
    uploadRequest.current?.abort();
    const controller = new AbortController(); uploadRequest.current = controller;
    selectedFile.current = file; setImageCid(''); patch('image', '');
    setReading(false);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setErrors(e => ({ ...e, image: 'imageType' })); return; }
    if (file.size > 2 * 1024 * 1024) { setErrors(e => ({ ...e, image: 'imageSize' })); return; }
    setReading(true);
    try {
      const result = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => image.width > 0 && image.height > 0 ? resolve() : reject(); image.onerror = reject; image.src = result; });
      if (version !== fileVersion.current) return;
      patch('image', result);
      const cid = await pinFile(file, controller.signal);
      if (version === fileVersion.current) setImageCid(cid);
    } catch { if (version === fileVersion.current) setErrors(e => ({ ...e, image: 'imageRead' })); }
    finally { if (version === fileVersion.current) setReading(false); }
  }
  const messages: Record<string, string> = {
    required: l('This field is required.', '请填写此项。'),
    ticker: l('Use 1–10 letters or numbers.', '使用 1–10 位字母或数字。'),
    duplicate: l('This ticker is already taken. Try another.', '此符号已被使用，请换一个。'),
    imageType: l('Choose a PNG, JPG or WebP image.', '请选择 PNG、JPG 或 WebP 图片。'),
    imageSize: l('The image must be 2 MB or smaller.', '图片不能超过 2 MB。'),
    imageRead: l('Image upload failed. Please retry.', '图片上传失败，请重试。'),
    url: l('Enter a full http:// or https:// URL.', '请输入完整的 http:// 或 https:// 链接。'),
  };
  function review(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    try {
      const amount = parseUnits(initialBuy.trim() || '0', payment?.decimals ?? 6);
      if (amount < 0n) throw new Error('Invalid buy');
    } catch { notify('Enter a valid initial buy amount.', '请填写有效的首买金额。'); return; }
    if (!imageCid || reading) { notify('Wait for the image upload to finish, or retry it.', '请等待图片上传完成，或重试上传。'); return; }
    if (!draft.name.trim()) next.name = 'required';
    if (!/^[A-Z0-9]{1,10}$/.test(draft.ticker)) next.ticker = 'ticker';

    (['website', 'x', 'telegram'] as const).forEach(key => { if (draft[key].trim() && !isSafeUrl(draft[key].trim())) next[key] = 'url'; });
    setErrors(next);
    if (Object.keys(next).length) { if (next.name) nameRef.current?.focus(); else if (next.ticker) tickerRef.current?.focus(); return; }
    setStep(2); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const preview: Token = { id: 'preview', name: draft.name.trim() || l('Your next big idea', '你的下一个好点子'), ticker: draft.ticker || 'TOKEN', description: draft.description.trim(), image: draft.image || undefined, emoji: '👋', color: '#eaf3d0', marketCap: 4000, change: 0, volume: 0, progress: 0, createdAt: Date.now(), holders: 0, creator: 'you', local: true };
  async function publish() {
    if (!state.connected) { showWallet(); return; }
    if (wrongNetwork) { switchNetwork(); return; }
    if (submitting.current || !wallet.provider || !wallet.address || !payment) return;
    submitting.current = true; setPublishing(true); setTxHash('');
    let transactionStarted = false;
    const controller = new AbortController(); metadataRequest.current = controller;
    setUploadingMetadata(true);
    try {
      if (!imageCid) throw new Error('Image upload required');
      const metadata = {name:draft.name.trim(),symbol:draft.ticker,description:draft.description.trim(),image:`ipfs://${imageCid}`,website:draft.website.trim(),x:draft.x.trim(),telegram:draft.telegram.trim()};
      const key = JSON.stringify(metadata);
      const metadataURI = metadataCache.current?.key === key ? metadataCache.current.uri : `ipfs://${await pinMetadata(metadata, controller.signal)}`;
      if (controller.signal.aborted) return;
      metadataCache.current = {key,uri:metadataURI};
      setUploadingMetadata(false); transactionStarted = true;
      const details = { name: draft.name.trim(), ticker: draft.ticker, metadataURI };
      if (parseUnits(initialBuy.trim() || '0', payment.decimals) > 0n) {
        await createAndBuy(wallet.provider, wallet.address, details, initialBuy, 1n, setTxHash);
      } else await createToken(wallet.provider, wallet.address, details, setTxHash);
      notify('Your token has been created on-chain.', '代币已在链上创建。');
      go('/rewards');
    } catch (error) { if (!controller.signal.aborted) { if (error instanceof PaymentCheckError) notify(error.english, error.chinese); else if (transactionStarted) notify('Creation was not confirmed. Check the amounts and wallet transaction before retrying.', '创建尚未确认，请检查金额及钱包交易后再重试。'); else notify('Token details upload failed. Please retry.', '代币资料上传失败，请重试。'); } }
    finally { submitting.current = false; setPublishing(false); setUploadingMetadata(false); }
  }
  return <div className="create-page"><a href="#/" className="back-link"><ArrowLeft size={15}/>{l('Back to explore', '返回发现')}</a><div className="page-heading"><div className="eyebrow">{l('YOUR LITTLE IDEA, OUT IN THE WORLD', '把你的小小灵感，带到更大的世界')}</div><h1>{l('It starts with a heyyo.', '从一句 Heyyo 开始。')}</h1><p>{l('One token. Two communities. A whole lot of possibility.', '一个代币，两个社区，无限可能。')}</p></div>
    <div className="create-layout"><div><ol className="steps"><li className={step === 1 ? 'active' : 'done'}><span>{step > 1 ? <Check size={14}/> : '1'}</span>{l('Make it yours', '定义你的代币')}</li><i/><li className={step === 2 ? 'active' : ''}><span>2</span>{l('One last look', '确认并创建')}</li></ol>
      {step === 1 ? <form className="form-card" onSubmit={review} noValidate><div className="form-section-heading"><h2>{l('The essentials', '基本信息')}</h2><span>{l('Make a good first impression.', '留下一个好的第一印象。')}</span></div><label className="field-label" htmlFor="token-image">{l('Token image', '代币图片')}</label><div className={`image-upload ${dragging ? 'dragging' : ''} ${draft.image ? 'has-image' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void readImage(e.dataTransfer.files[0]); }}><input ref={fileRef} id="token-image" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={e => { void readImage(e.target.files?.[0]); e.target.value = ''; }} aria-describedby={errors.image ? 'image-error' : undefined}/>{draft.image ? <><img src={draft.image} alt={l('Token image preview', '代币图片预览')}/><div><strong>{reading ? l('Uploading…', '上传中…') : imageCid ? l('Image uploaded.', '图片已上传。') : l('Upload incomplete', '上传未完成')}</strong><button type="button" className="text-button" onClick={() => fileRef.current?.click()}>{l('Choose another image', '换一张图片')}</button></div><button type="button" className="icon-button remove-image" aria-label={l('Remove image', '移除图片')} onClick={() => { fileVersion.current++; uploadRequest.current?.abort(); selectedFile.current = undefined; setImageCid(''); setReading(false); patch('image', ''); }}><X size={17}/></button></> : <button type="button" className="upload-target" onClick={() => fileRef.current?.click()}><span><ImagePlus size={23}/></span><strong>{reading ? l('Reading image…', '正在读取图片…') : l('Drop something iconic', '放上一张有记忆点的图')}</strong><small>{l('or click to upload · PNG, JPG, WebP · max 2 MB', '或点击上传 · PNG、JPG、WebP · 最大 2 MB')}</small></button>}</div>{errors.image && <p id="image-error" className="field-error" role="alert">{messages[errors.image]}{errors.image === 'imageRead' && <button type="button" className="text-button" disabled={reading} onClick={() => void readImage(selectedFile.current)}>{l('Retry upload','重试上传')}</button>}</p>}
      <div className="field-grid"><div><label htmlFor="token-name" className="field-label">{l('Token name', '代币名称')} <span>*</span></label><input ref={nameRef} id="token-name" value={draft.name} maxLength={40} placeholder={l('e.g. Good Morning Club', '例如 Good Morning Club')} onChange={e => patch('name', e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-error' : undefined}/>{errors.name && <p className="field-error" id="name-error" role="alert">{messages[errors.name]}</p>}</div><div><label htmlFor="token-ticker" className="field-label">{l('Ticker', '代币符号')} <span>*</span></label><div className="input-prefix"><span>$</span><input ref={tickerRef} id="token-ticker" value={draft.ticker} maxLength={10} placeholder="GM" onChange={e => patch('ticker', e.target.value.toUpperCase())} aria-invalid={!!errors.ticker} aria-describedby={errors.ticker ? 'ticker-error' : undefined}/></div>{errors.ticker && <p className="field-error" id="ticker-error" role="alert">{messages[errors.ticker]}</p>}</div></div>
      <label htmlFor="token-description" className="field-label">{l('A little backstory', '说说你的故事')}<small>{l('Optional', '选填')}</small></label><textarea id="token-description" value={draft.description} maxLength={280} rows={3} placeholder={l('What makes your little corner of the internet special?', '你的这片互联网小天地，有什么特别之处？')} onChange={e => patch('description', e.target.value)}/><div className="character-count">{draft.description.length}/280</div>
      <details className="optional-fields" open={['website', 'x', 'telegram'].some(k => !!errors[k]) || undefined}><summary>{l('Social links', '社交链接')}<span>{l('Optional', '选填')}<ChevronDown size={16}/></span></summary>{(['website', 'x', 'telegram'] as const).map(key => <div key={key}><label htmlFor={`token-${key}`} className="field-label">{key === 'website' ? l('Website', '网站') : key === 'x' ? 'X' : 'Telegram'}</label><input type="url" id={`token-${key}`} value={draft[key]} maxLength={300} placeholder={key === 'website' ? 'https://' : key === 'x' ? 'https://x.com/' : 'https://t.me/'} onChange={e => patch(key, e.target.value)} aria-invalid={!!errors[key]}/>{errors[key] && <p role="alert" className="field-error">{messages[errors[key]]}</p>}</div>)}</details>
      <label className="field-label" htmlFor="initial-buy">{l('Initial buy', '首笔买入')} {payment?.symbol}<small>{l('Optional · same transaction', '选填 · 同一笔交易')}</small></label><input id="initial-buy" inputMode="decimal" value={initialBuy} placeholder="0" onChange={e => setInitialBuy(e.target.value)}/>
      <button type="submit" className="button button-dark full" disabled={reading || !imageCid}>{l('Review your token', '预览你的代币')}<ArrowRight size={17}/></button></form> : <section className="form-card review-card"><span className="review-check"><Check size={23}/></span><h2>{l('Ready to make a little wave?', '准备好掀起一点波澜了吗？')}</h2><p>{l('Everything look right? Your token is almost here.', '确认信息无误后，即可创建你的代币。')}</p><div className="review-token"><Avatar token={preview} large/><h3>{preview.name}</h3><span>${preview.ticker}</span><p>{preview.description || l('A fresh idea, ready for its first heyyo.', '一个新灵感，等待第一声 Heyyo。')}</p></div><dl className="review-facts"><div><dt>{l('Launch mode', '发行模式')}</dt><dd>Ayoo Bonding Curve</dd></div><div><dt>{l('Quote currency', '报价币种')}</dt><dd>{payment?.symbol ?? 'USDC'}</dd></div><div><dt>{l('Token supply', '代币供应量')}</dt><dd>{l('Set by the on-chain template', '以链上模板为准')}</dd></div><div><dt>{l('Initial buy', '首笔买入')}</dt><dd>{initialBuy || '0'} {payment?.symbol}</dd></div><div><dt>{l('Platforms at launch', '上线展示平台')}</dt><dd>Heyyo + Ayoo</dd></div>{(['website', 'x', 'telegram'] as const).filter(k => draft[k]).map(k => <div key={k}><dt>{k === 'website' ? l('Website', '网站') : k === 'x' ? 'X' : 'Telegram'}</dt><dd><a href={draft[k]} target="_blank" rel="noreferrer">{draft[k]}</a></dd></div>)}</dl><button className="button button-lime full" disabled={publishing || walletConnecting || !creationReady || !payment} onClick={() => void publish()}>{publishing ? uploadingMetadata ? l('Uploading details…', '正在上传资料…') : l('Confirming…', '确认中…') : walletConnecting ? l('Connecting…', '连接中…') : !state.connected ? l('Connect wallet', '连接钱包') : wrongNetwork ? l(`Switch to ${networkName}`, `切换至 ${networkName}`) : l('Create token', '创建代币')}<ArrowRight size={17}/></button>{(!creationReady || !payment) && <p role="status">{l('Creation configuration is unavailable. Please try again later.', '创建配置暂不可用，请稍后重试。')}</p>}{txHash && <p className="transaction-status" role="status">{l('Transaction', '交易')}: <code>{txHash}</code></p>}<button className="button button-plain full" disabled={publishing} onClick={() => setStep(1)}><ArrowLeft size={15}/>{l('Edit details', '修改信息')}</button></section>}
    </div><aside className="create-aside"><div className="preview-label">{l('A LITTLE SNEAK PEEK', '抢先看一眼')}</div><div className="create-preview"><Avatar token={preview} large/><h3>{preview.name}</h3><span className="muted">${preview.ticker}</span><p>{preview.description || l('Your story goes here. Keep it short. Make it you.', '在这里写下你的故事。简单一点，像你一点。')}</p><PlatformBadge/></div><div className="creator-promise"><Leaf size={24}/><h3>{l('Made for the makers.', '为创作者而生。')}</h3><p>{l('Ayoo shares 70% of creator fees with Heyyo. Half buys back and burns $HEYYO. Half accumulates as your rewards, ready to claim per token.', 'Ayoo 将 70% 创作者手续费分配给 Heyyo。一半用于回购并销毁 $HEYYO，另一半累积为你的收益，需按代币手动领取。')}</p></div></aside></div>
  </div>;
}
