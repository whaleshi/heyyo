export type Locale = 'en' | 'zh';
export type Stage = 'new' | 'soon' | 'graduated';
export type Token = {
  id: string; name: string; ticker: string; emoji: string; color: string;
  contractAddress?: string;
  image?: string; description: string; descriptionZh?: string;
  marketCap: number; change: number; volume: number; progress: number;
  createdAt: number; holders: number; creator: 'community' | 'you';
  local?: boolean; website?: string; x?: string; telegram?: string;
};
export type Trade = { id: string; tokenId: string; side: 'buy' | 'sell'; quantity: number; total: number; time: number };
export type RewardClaim = { id: string; tokenId?: string; tokenTicker?: string; amount: number; time: number };
export type DemoState = { tokens: Token[]; connected: boolean; balance: number; holdings: Record<string, number>; trades: Trade[]; claimableRewardsByToken: Record<string, number>; rewardClaims: RewardClaim[] };
// Independent display fields: burned token quantity is not a USDC conversion.
export const platformStats = { burnedHeyyo: 24680, creatorRewardsUsdc: 24680 };
export const platformTokenAddress = '0x9A2265D05ac8950e644288471bfA52f1ebbB1257';
// Ayoo Arc routes use the token contract address, never a local slug or ticker.
export function ayooTokenUrl(token?: Pick<Token, 'contractAddress'>): string {
  const address = token?.contractAddress;
  return typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address)
    ? `https://ayoo.club/arc/token/${address}`
    : 'https://ayoo.club/arc';
}
export const TOTAL_SUPPLY = 1_000_000_000;
export const GRADUATION_TARGET = 8000;
export const priceOf = (token: Token) => token.marketCap / TOTAL_SUPPLY;
export const stageOf = (token: Token): Stage => token.progress >= 100 ? 'graduated' : token.progress >= 65 ? 'soon' : 'new';
export const money = (value: number, compact = false) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : value > 0 && value < 0.01 ? 8 : 2 }).format(value);
export const quantity = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: value > 0 && value < 1 ? 8 : 2, notation: value >= 100000 ? 'compact' : 'standard' }).format(value);
export function allocateCreatorFees(pool: number) {
  if (!Number.isFinite(pool) || pool < 0) throw new Error('Invalid creator fee pool');
  const heyyo = pool * 0.7;
  return { heyyo, buyback: heyyo * 0.5, creator: heyyo * 0.5 };
}
export function validateTrade(side: 'buy' | 'sell', amount: number, balance: number, holding: number, price: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'amount';
  if (!Number.isFinite(price) || price <= 0) return 'price';
  if (side === 'buy' && amount > balance + 1e-8) return 'balance';
  if (side === 'sell' && amount > holding + 1e-8) return 'holding';
  return null;
}
export const isSafeUrl = (value: string) => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
export const isImage = (value: unknown): value is string => typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 2_900_000;
export function isToken(value: unknown): value is Token {
  if (!value || typeof value !== 'object') return false;
  const t = value as Token;
  return typeof t.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(t.id) && typeof t.name === 'string' && t.name.length <= 40 && typeof t.ticker === 'string' && /^[A-Z0-9]{1,10}$/.test(t.ticker)
    && typeof t.description === 'string' && t.description.length <= 280 && typeof t.emoji === 'string' && typeof t.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.color)
    && ['marketCap', 'volume', 'progress', 'createdAt', 'holders'].every(k => Number.isFinite(t[k as keyof Token]) && Number(t[k as keyof Token]) >= 0)
    && Number.isFinite(t.change) && t.marketCap > 0 && t.progress <= 100 && ['you', 'community'].includes(t.creator)
    && (!t.image || isImage(t.image)) && ['website', 'x', 'telegram'].every(k => !t[k as keyof Token] || (typeof t[k as keyof Token] === 'string' && isSafeUrl(String(t[k as keyof Token]))));
}

const now = Date.now();
const make = (id: string, name: string, ticker: string, emoji: string, color: string, marketCap: number, change: number, volume: number, progress: number, minutes: number, description: string, descriptionZh: string): Token => ({ id, name, ticker, emoji, color, marketCap, change, volume, progress, createdAt: now - minutes * 60000, holders: Math.round(volume / 53), description, descriptionZh, creator: 'community' });
export const sampleTokens: Token[] = [
  make('good-morning', 'Good Morning Club', 'GM', '☀️', '#fff0c2', 12400, 24.8, 6820, 28, 4, 'A good morning is better when everyone is in on it.', '每一个早上，都值得和大家说一声 GM。'),
  make('little-frog', 'Just a little frog', 'LILFROG', '🐸', '#e8f2d4', 8600, 12.6, 3240, 17, 12, 'Small frog. Big pond. Absolutely no thoughts.', '小青蛙，大池塘，今天也没有烦恼。'),
  make('pink-noise', 'Pink Noise', 'PINK', '🎧', '#fce1ec', 5900, -3.2, 1890, 11, 23, 'For the ones who hear things a little differently.', '献给那些听见不同节奏的人。'),
  make('mood', 'Big Mood', 'MOOD', '🫠', '#e9e2f5', 4200, 8.4, 1240, 8, 36, 'Some days you are the vibe. Some days you melt.', '有时候你就是氛围，有时候只想融化。'),
  make('capy-club', 'Capybara Social Club', 'CAPY', '🦫', '#ede2d1', 42800, 68.2, 28500, 92, 72, 'Unbothered. Hydrated. Building a little community.', '松弛一点，喝口水，一起建立小小的社区。'),
  make('moon-cat', 'Moon Cat', 'MCAT', '🐈', '#e3e6f6', 36400, 42.1, 19300, 83, 110, 'Nine lives. One moon. A very curious cat.', '九条命，一个月亮，一只好奇的猫。'),
  make('stay-cozy', 'Stay Cozy', 'COZY', '☕', '#eee3d9', 29700, 18.9, 14200, 71, 180, 'Your favorite corner of the internet. Stay a while.', '互联网里你最喜欢的小角落。再待一会吧。'),
  make('cloud-nine', 'Cloud Nine', 'CLOUD', '☁️', '#dfeef4', 24600, 31.4, 11800, 67, 250, 'A little daydream, shared by a lot of people.', '一个小小的白日梦，被很多人共同拥有。'),
];
export function initialState(): DemoState { return { tokens: sampleTokens.map(token => ({ ...token })), connected: false, balance: 1000, holdings: {}, trades: [], claimableRewardsByToken: {}, rewardClaims: [] }; }

export function walletStorageKey(address: string | null): string | null {
  return address && /^0x[0-9a-fA-F]{40}$/.test(address) ? `heyyo.wallet.v1:${address.toLowerCase()}` : null;
}

export function restoreWalletState(raw: string | null): DemoState {
  return { ...restoreState(raw), connected: false };
}

export function restoreState(raw: string | null): DemoState {
  const fallback = initialState();
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || typeof data.state !== 'object') return fallback;
    const s = data.state;
    if (!Array.isArray(s.tokens) || !s.tokens.every(isToken) || typeof s.connected !== 'boolean'
      || !Number.isFinite(s.balance) || s.balance < 0 || !s.holdings || Array.isArray(s.holdings) || typeof s.holdings !== 'object' || !Object.values(s.holdings).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      || !Array.isArray(s.trades) || !s.trades.every((t: Trade) => t && typeof t.id === 'string' && typeof t.tokenId === 'string' && ['buy', 'sell'].includes(t.side) && Number.isFinite(t.quantity) && t.quantity > 0 && Number.isFinite(t.total) && t.total > 0 && Number.isFinite(t.time))) return fallback;
    // Retire the old graduated fixtures while preserving user-created and live tokens.
    const retired = new Set(['okay-bear', 'good-dog', 'tiny-world', 'peach']);
    const tokens = s.tokens.filter((token: Token) => !(token.creator === 'community' && !token.contractAddress && retired.has(token.id)));
    // Old aggregate balances cannot be attributed to a token; never distribute them arbitrarily.
    const ownedIds = new Set(tokens.filter((token: Token) => token.creator === 'you').map((token: Token) => token.id));
    const pending = s.claimableRewardsByToken;
    const claimableRewardsByToken = pending && typeof pending === 'object' && !Array.isArray(pending)
      ? Object.fromEntries(Object.entries(pending).filter((entry): entry is [string, number] => ownedIds.has(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0)) : {};
    const rewardClaims = Array.isArray(s.rewardClaims) && s.rewardClaims.every((claim: RewardClaim) => claim && typeof claim.id === 'string' && (claim.tokenId === undefined || typeof claim.tokenId === 'string') && (claim.tokenTicker === undefined || typeof claim.tokenTicker === 'string') && Number.isFinite(claim.amount) && claim.amount > 0 && Number.isFinite(claim.time) && claim.time >= 0) ? s.rewardClaims : [];
    return { tokens, connected: s.connected, balance: s.balance, holdings: s.holdings, trades: s.trades, claimableRewardsByToken, rewardClaims };
  } catch { return fallback; }
}

// Frontend state transition; replace with confirmed settlement when a service is connected.
export function claimCreatorRewards(state: DemoState, tokenId: string, id: string, time: number): DemoState {
  const token = state.tokens.find(token => token.id === tokenId && token.creator === 'you');
  const amount = state.claimableRewardsByToken[tokenId];
  if (!state.connected || !token || !Number.isFinite(amount) || amount <= 0) return state;
  return { ...state, balance: state.balance + amount,
    claimableRewardsByToken: { ...state.claimableRewardsByToken, [tokenId]: 0 },
    rewardClaims: [{ id, tokenId, tokenTicker: token.ticker, amount, time }, ...state.rewardClaims] };
}
