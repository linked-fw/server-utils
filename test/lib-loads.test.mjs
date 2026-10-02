// Runs against the build output: `npm run build && npm test`.
// The new modules load in plain Node from the published lib, with their exports.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('built lib', () => {
  it('exports the callable, call-context and query-access API', async () => {
    const callable = await import('../lib/esm/utils/callable.js');
    const ctx = await import('../lib/esm/utils/CallContext.js');
    const qa = await import('../lib/esm/utils/QueryAccess.js');
    const bp = await import('../lib/esm/utils/BackendProvider.js');
    for (const name of ['callable', 'declareCallable', 'getOwnCallableLevel', 'internal', 'declareInternal', 'isDeclaredInternal']) {
      assert.equal(typeof callable[name], 'function', name);
    }
    for (const name of ['getCallContext', 'runWithCallContext', 'runAsSystem', 'currentRequest', 'currentResponse', 'requireSessionUser', 'httpCallContext', 'runInHttpContext']) {
      assert.equal(typeof ctx[name], 'function', name);
    }
    for (const name of ['registerProtectedShapes', 'registerQueryAuthorizer', 'checkQueryAccess', 'collectQueryTargets', 'getProtectedShapeIds', 'getQueryAuthorizers', 'registerRawQueryAuthorizer', 'getRawQueryAuthorizers', 'collectMutationNodes', 'getProtectedClassIds', 'getContainsPredicates']) {
      assert.equal(typeof qa[name], 'function', name);
    }
    const desc = Object.getOwnPropertyDescriptor(bp.BackendProvider.prototype, 'request');
    assert.equal(typeof desc.get, 'function');
  });
});
