import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { HeyyoProvider } from '../src/app/store.tsx';
import { useHeyyo } from '../src/app/context.ts';
import { WalletContext } from '../src/app/wallet-context.ts';
import { initialState, sampleTokens, walletStorageKey } from '../src/app/model.ts';

const a = `0x${'ab'.repeat(20)}`;
const b = `0x${'cd'.repeat(20)}`;
const token = { ...sampleTokens[0], id: 'local-wallet-test', creator: 'you', local: true };

function harness(saved = new Map()) {
  globalThis.document = { documentElement: { lang: 'en' } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  } });
  let store;
  function Probe() { store = useHeyyo(); return null; }
  let session = { address: null, configured: true, connecting: false, wrongNetwork: false,
    connect: async () => {}, disconnect: async () => {}, manage: async () => {}, switchNetwork: async () => {} };
  const tree = () => React.createElement(WalletContext.Provider, { value: session },
    React.createElement(HeyyoProvider, null, React.createElement(Probe)));
  let root;
  act(() => { root = create(tree()); });
  return {
    get store() { return store; }, saved,
    change(patch) { session = { ...session, ...patch }; act(() => root.update(tree())); },
    close() { act(() => root.unmount()); },
  };
}

test('wallet address controls connection; local data is isolated across account switches and reloads', () => {
  const saved = new Map([['heyyo.preview.v1', JSON.stringify({ version: 1, state: { ...initialState(), connected: true, tokens: [token] } })]]);
  const h = harness(saved);
  assert.equal(h.store.state.connected, false);
  assert.equal(h.store.create(token), false);
  h.change({ address: a });
  assert.equal(h.store.walletAddress, a);
  assert.equal(h.store.state.tokens.some(t => t.creator === 'you'), false);
  act(() => assert.equal(h.store.create(token), true));
  assert.equal(JSON.parse(saved.get(walletStorageKey(a))).state.connected, false);
  h.change({ address: b });
  assert.equal(h.store.state.tokens.some(t => t.id === token.id), false);
  h.change({ address: a.toUpperCase().replace('0X', '0x') });
  assert.equal(h.store.state.tokens[0].id, token.id);
  h.change({ address: null });
  assert.equal(h.store.state.connected, false);
  assert.equal(h.store.state.tokens.some(t => t.creator === 'you'), false);
  h.close();
  const reload = harness(saved);
  assert.equal(reload.store.state.connected, false);
  reload.change({ address: a });
  assert.equal(reload.store.state.tokens[0].id, token.id);
  reload.close();
});

test('rejected connection and disconnect requests do not fake session changes', async () => {
  const h = harness();
  let opens = 0;
  h.change({ connect: async () => { opens++; throw new Error('User rejected'); } });
  await act(async () => h.store.connect());
  assert.equal(opens, 1);
  assert.equal(h.store.state.connected, false);
  assert.match(h.store.toast, /could not be completed/);
  h.change({ address: a, disconnect: async () => { throw new Error('Disconnected failed'); } });
  await act(async () => h.store.disconnect());
  assert.equal(h.store.walletAddress, a);
  h.change({ address: null, configured: false });
  await act(async () => h.store.connect());
  assert.equal(opens, 1);
  assert.match(h.store.toast, /not available/);
  h.close();
});

test('wrong network blocks local mutations; claims remain per account and cannot run twice', () => {
  const saved = new Map([[walletStorageKey(a), JSON.stringify({ version: 1, state: {
    ...initialState(), connected: true, tokens: [token], claimableRewardsByToken: { [token.id]: 35 },
  } })]]);
  const h = harness(saved);
  h.change({ address: a, wrongNetwork: true });
  assert.equal(h.store.create(token), false);
  assert.equal(h.store.claimRewards(token.id), 0);
  h.change({ wrongNetwork: false });
  act(() => {
    assert.equal(h.store.claimRewards(token.id), 35);
    assert.equal(h.store.claimRewards(token.id), 0);
  });
  assert.equal(h.store.state.rewardClaims.length, 1);
  h.change({ address: b });
  assert.equal(h.store.state.rewardClaims.length, 0);
  assert.equal(h.store.claimRewards(token.id), 0);
  h.close();
});

test('storage failures preserve in-memory records without mixing wallets', () => {
  const h = harness();
  h.change({ address: a });
  globalThis.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  act(() => h.store.create(token));
  assert.equal(h.store.storageError, true);
  h.change({ address: b });
  assert.equal(h.store.state.tokens.some(t => t.id === token.id), false);
  h.change({ address: a });
  assert.equal(h.store.state.tokens[0].id, token.id);
  h.close();
});
