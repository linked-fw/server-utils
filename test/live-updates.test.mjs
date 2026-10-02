// Runs against the build output: `npm run build && npm test`.
// getUpdatesSince is callable by signed-in users only, and each user sees the
// broadcast updates plus the ones addressed to them.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LincdServerUtilsBackendProvider } from '../lib/esm/backend.js';
import { getOwnCallableLevel } from '../lib/esm/utils/callable.js';
import { runAsSystem, runWithCallContext } from '../lib/esm/utils/CallContext.js';
import { LinkedLiveUpdate, updates } from '../lib/esm/utils/LinkedLiveUpdates.js';
import { ServerCallError } from '../lib/esm/utils/ServerCallError.js';

const asUser = (userAccount, fn) =>
  runWithCallContext(
    {
      kind: 'http',
      request: { linkedAuth: userAccount ? { userAccount } : undefined },
      response: {},
    },
    fn
  );

describe('LincdServerUtilsBackendProvider.getUpdatesSince', () => {
  const provider = new LincdServerUtilsBackendProvider();

  beforeEach(() => {
    updates.length = 0;
    LinkedLiveUpdate.batchedUpdates = [];
  });

  it('is declared callable for signed-in users only', () => {
    assert.equal(getOwnCallableLevel(LincdServerUtilsBackendProvider, 'getUpdatesSince'), 'user');
    assert.equal(getOwnCallableLevel(LincdServerUtilsBackendProvider, 'setupLiveUpdatesMulticore'), undefined);
  });

  it('answers 401 to an http call without a session', () => {
    LinkedLiveUpdate.send('activity', { n: 1 });
    assert.throws(
      () => asUser(undefined, () => provider.getUpdatesSince(0)),
      (e) => e instanceof ServerCallError && e.status === 401
    );
  });

  it('refuses a system context and a call outside any request', () => {
    assert.throws(() => runAsSystem(() => provider.getUpdatesSince(0)), /no user/);
    assert.throws(() => provider.getUpdatesSince(0), /no user/);
  });

  it("returns broadcasts and the caller's own updates, never another user's", () => {
    LinkedLiveUpdate.send('activity', { n: 1 });
    LinkedLiveUpdate.send('private', { n: 2 }, { to: 'https://x/alice' });
    LinkedLiveUpdate.send('private', { n: 3 }, { to: 'https://x/bob' });
    const alice = asUser({ id: 'https://x/alice' }, () => provider.getUpdatesSince(0, 0));
    assert.deepEqual(alice.map((u) => u.data.n), [1, 2]);
    const bob = asUser('https://x/bob', () => provider.getUpdatesSince(0, 0));
    assert.deepEqual(bob.map((u) => u.data.n), [1, 3]);
  });

  it('caps the number of updates per call', () => {
    for (let i = 0; i < 150; i++) LinkedLiveUpdate.send('activity', { n: i });
    const all = asUser({ id: 'u' }, () => provider.getUpdatesSince(0, 0));
    assert.equal(all.length, 100);
    assert.equal(all[99].data.n, 149);
    const few = asUser({ id: 'u' }, () => provider.getUpdatesSince(0, 3));
    assert.deepEqual(few.map((u) => u.data.n), [147, 148, 149]);
    assert.equal(asUser({ id: 'u' }, () => provider.getUpdatesSince(0, 1e9)).length, 100);
  });

  it('only returns updates after the timestamp', () => {
    updates.push({ timestamp: 10, type: 't', data: 'old' }, { timestamp: 20, type: 't', data: 'new' });
    const res = asUser({ id: 'u' }, () => provider.getUpdatesSince(15));
    assert.deepEqual(res.map((u) => u.data), ['new']);
  });
});
