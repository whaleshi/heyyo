import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimCreatorRewards, ayooTokenUrl, allocateCreatorFees, validateTrade, initialState, restoreState, isSafeUrl, isToken, sampleTokens, stageOf } from '../src/app/model.ts';

test('fee split uses creator fee pool rather than trade volume', () => {
  assert.deepEqual(allocateCreatorFees(100), { heyyo: 70, buyback: 35, creator: 35 });
  for (const pool of [0, 0.01, 1234.56, 1000000]) {
    const split = allocateCreatorFees(pool);
    assert.equal(split.buyback + split.creator, split.heyyo);
    assert.ok(Math.abs(split.creator - pool * 0.35) < 1e-8);
  }
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => allocateCreatorFees(invalid));
});
test('trading checks both budget and holdings before changing state', () => {
  assert.equal(validateTrade('buy', 100, 100, 0, .001), null);
  assert.equal(validateTrade('buy', 101, 100, 0, .001), 'balance');
  assert.equal(validateTrade('sell', 10, 100, 10, .001), null);
  assert.equal(validateTrade('sell', 11, 100, 10, .001), 'holding');
  for (const amount of [0, -1, NaN, Infinity]) assert.equal(validateTrade('buy', amount, 100, 10, .001), 'amount');
  assert.equal(validateTrade('buy', 10, 100, 10, 0), 'price');
});
test('persistence keeps created tokens, balances and activity', () => {
  const state = initialState();
  state.connected = true;
  state.balance = 975;
  state.holdings = { 'good-morning': 123 };
  state.tokens = [{ ...sampleTokens[0], id: 'local-check', creator: 'you', local: true }, ...state.tokens];
  state.trades = [{ id: 'check', tokenId: 'good-morning', side: 'buy', total: 25, quantity: 123, time: Date.now() }];
  assert.deepEqual(restoreState(JSON.stringify({ version: 1, state })), state);
});
test('invalid or old saved state recovers without crashing', () => {
  for (const value of [null, '', 'not json', '{"version":0}', '{"version":1,"state":null}', '{"version":1,"state":{}}']) {
    assert.equal(restoreState(value).balance, 1000);
  }
  const state = initialState();
  state.tokens[0] = { ...state.tokens[0], website: 'javascript:alert(1)' };
  assert.equal(restoreState(JSON.stringify({ version: 1, state })).tokens[0].website, undefined);
  assert.equal(restoreState(JSON.stringify({ version: 1, state: { ...initialState(), balance: -10 } })).balance, 1000);
});
test('token inputs reject unsafe links and malformed images', () => {
  assert.equal(isSafeUrl('https://example.com'), true);
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'not-a-url']) assert.equal(isSafeUrl(value), false);
  assert.ok(sampleTokens.every(isToken));
  assert.equal(isToken({ ...sampleTokens[0], image: 'data:image/svg+xml;base64,PHN2Zz4=' }), false);
  assert.equal(isToken({ ...sampleTokens[0], ticker: 'BAD TICKER' }), false);
});
test('stage boundaries match filters', () => {
  assert.equal(stageOf({ progress: 64 }), 'new');
  assert.equal(stageOf({ progress: 65 }), 'soon');
  assert.equal(stageOf({ progress: 99 }), 'soon');
  assert.equal(stageOf({ progress: 100 }), 'graduated');
});

test('Ayoo links use contract addresses and never local token IDs', () => {
  const address = '0x' + '12'.repeat(20);
  assert.equal(ayooTokenUrl({ contractAddress: address }), `https://ayoo.club/arc/token/${address}`);
  for (const contractAddress of [undefined, '', 'good-morning', '0x123', 'javascript:alert(1)', '../../other']) {
    assert.equal(ayooTokenUrl({ contractAddress }), 'https://ayoo.club/arc');
  }
  const state = initialState();
  state.tokens[0].contractAddress = address;
  const restored = restoreState(JSON.stringify({ version: 1, state }));
  assert.equal(ayooTokenUrl(restored.tokens[0]), `https://ayoo.club/arc/token/${address}`);
});

test('claiming one token preserves the other token rewards and prevents duplicate claims', () => {
  const a = { ...sampleTokens[0], creator: 'you' };
  const b = { ...sampleTokens[1], creator: 'you' };
  const pending = { ...initialState(), tokens: [a, b], claimableRewardsByToken: { [a.id]: 35, [b.id]: 70 } };
  assert.equal(claimCreatorRewards(pending, a.id, 'claim-1', 100), pending);
  pending.connected = true;
  assert.equal(claimCreatorRewards(pending, 'unknown', 'claim-1', 100), pending);
  const claimed = claimCreatorRewards(pending, a.id, 'claim-1', 100);
  assert.equal(pending.claimableRewardsByToken[a.id], 35);
  assert.deepEqual(claimed.claimableRewardsByToken, { [a.id]: 0, [b.id]: 70 });
  assert.equal(claimed.balance, 1035);
  assert.deepEqual(claimed.rewardClaims, [{ id: 'claim-1', tokenId: a.id, tokenTicker: a.ticker, amount: 35, time: 100 }]);
  assert.equal(claimCreatorRewards(claimed, a.id, 'claim-2', 101), claimed);
  const second = claimCreatorRewards(claimed, b.id, 'claim-2', 102);
  assert.equal(second.balance, 1105);
  assert.equal(second.rewardClaims.length, 2);
  assert.deepEqual(restoreState(JSON.stringify({ version: 1, state: second })), second);
});
test('claims cannot settle another creator token', () => {
  const state = { ...initialState(), connected: true, claimableRewardsByToken: { [sampleTokens[0].id]: 100 } };
  assert.equal(claimCreatorRewards(state, sampleTokens[0].id, 'claim', 100), state);
});
test('reward storage rejects unowned or invalid amounts and never assigns legacy totals', () => {
  const a = { ...sampleTokens[0], creator: 'you' };
  const b = { ...sampleTokens[1], creator: 'you' };
  const state = { ...initialState(), tokens: [a, b], claimableRewardsByToken: { [a.id]: 25, [b.id]: -1, unknown: 100 } };
  const restored = restoreState(JSON.stringify({ version: 1, state }));
  assert.deepEqual(restored.claimableRewardsByToken, { [a.id]: 25 });
  delete state.claimableRewardsByToken;
  state.claimableRewards = 100;
  state.rewardClaims = [{ id: 'legacy', amount: 12, time: 100 }];
  const legacy = restoreState(JSON.stringify({ version: 1, state }));
  assert.deepEqual(legacy.claimableRewardsByToken, {});
  assert.deepEqual(legacy.rewardClaims, state.rewardClaims);
  assert.equal(legacy.tokens.length, state.tokens.length);
});
