// Runs against the build output: `npm run build && npm test`.
// Loads a second copy of each module (a `?copy` query is a distinct module instance to Node)
// and shows that state one copy is given reaches the other, and that an error thrown by one
// copy is recognised by the other.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SITE_ROOT ??= 'http://example.test';

const load = (path, copy) => import(new URL(`${path}?copy=${copy}`, import.meta.url).href);
const twice = async (path) => [await load(path, 'a'), await load(path, 'b')];

describe('a second copy of server-utils shares its state', () => {
  it('Server: the local server set on one copy is used by the other', async () => {
    const [a, b] = await twice('../lib/esm/utils/Server.js');
    assert.notEqual(a.Server, b.Server);
    const localServer = { name: 'local' };
    a.Server.setLocalServer(localServer);
    assert.equal(b.Server.getLocalServer(), localServer);
  });

  it('LincdServerProxy: default headers, auth handler and action handlers', async () => {
    const [a, b] = await twice('../lib/esm/utils/LincdServerProxy.js');
    assert.notEqual(a.LincdServerProxy, b.LincdServerProxy);

    a.LincdServerProxy.addDefaultHeaders({ 'X-Two-Copies': '1' });
    assert.equal(b.LincdServerProxy.defaultHeaders['X-Two-Copies'], '1');
    b.LincdServerProxy.removeDefaultHeaders('X-Two-Copies');
    assert.equal(a.LincdServerProxy.defaultHeaders['X-Two-Copies'], undefined);

    const handler = { onUnauthenticated: () => {} };
    a.LincdServerProxy.setAuthHandler(handler);
    assert.equal(b.LincdServerProxy.getAuthHandler(), handler);
    a.LincdServerProxy.setAuthHandler(null);

    const action = () => {};
    a.LincdServerProxy.registerActionHandler('two-copies', action);
    assert.deepEqual(b.LincdServerProxy.actionHandlers.get('two-copies'), [action]);
    a.LincdServerProxy.actionHandlers.delete('two-copies');
  });

  it('Server.addDefaultHeaders on one copy reaches the proxy of the other', async () => {
    const [server] = await twice('../lib/esm/utils/Server.js');
    const [, proxy] = await twice('../lib/esm/utils/LincdServerProxy.js');
    server.Server.addDefaultHeaders({ 'X-Via-Server': 'yes' });
    assert.equal(proxy.LincdServerProxy.defaultHeaders['X-Via-Server'], 'yes');
    server.Server.removeDefaultHeaders('X-Via-Server');
  });

  it('LinkedEmail: the provider set on one copy sends for the other', async () => {
    const [a, b] = await twice('../lib/esm/utils/LinkedEmail.js');
    const sent = [];
    a.LinkedEmail.setDefaultProvider({ send: async (o) => void sent.push(o) });
    assert.equal(b.LinkedEmail.hasDefaultProvider(), true);
    await b.LinkedEmail.send({ to: [], subject: 's', htmlbody: '' });
    assert.equal(sent.length, 1);
  });

  it('LinkedLiveUpdate: an update sent through one copy is in the other copy\'s log', async () => {
    const [a, b] = await twice('../lib/esm/utils/LinkedLiveUpdates.js');
    a.LinkedLiveUpdate.send('two-copies', { n: 1 });
    assert.equal(b.updates.at(-1).type, 'two-copies');
    assert.equal(b.LinkedLiveUpdate.batchedUpdates.at(-1).type, 'two-copies');
    b.LinkedLiveUpdate.batchedUpdates = [];
    assert.equal(a.LinkedLiveUpdate.batchedUpdates.length, 0);
  });

  it('RequestData: data set on one copy is read by the other', async () => {
    const [a, b] = await twice('../lib/esm/utils/RequestData.js');
    a.setRequestData({ page: 'home' });
    assert.deepEqual(b.getRequestData(), { page: 'home' });
    a.setRequestData('user', 'u1');
    assert.equal(b.getRequestData('user'), 'u1');
  });
});

describe('a ServerCallError from another copy', () => {
  it('matches by brand where instanceof does not', async () => {
    const [a, b] = await twice('../lib/esm/utils/ServerCallError.js');
    const { isLinkedError } = await import('@_linked/core/utils/linkedError');
    const err = new a.ServerCallError(500, 'boom');
    assert.equal(err instanceof b.ServerCallError, false);
    assert.equal(isLinkedError(err, b.ServerCallError), true);
    assert.equal(b.ServerCallError.is(err), true);
    assert.equal(isLinkedError(new Error('boom'), b.ServerCallError), false);
  });
});

describe('JSONWriter with values from a second copy of core', () => {
  // `?copy` makes each core module a distinct instance, as a second installed copy would be.
  const coreCopy = (sub) => import(`${import.meta.resolve(`@_linked/core/${sub}`)}?copy=b`);

  it('recognises a Shape, a Shape class, a ShapeSet and a CoreSet from the other copy', async () => {
    const { JSONWriter } = await import('../lib/esm/utils/JSONWriter.js');
    const { Shape: OwnShape } = await import('@_linked/core/shapes/Shape');
    const { Shape } = await coreCopy('shapes/Shape');
    const { ShapeSet } = await coreCopy('collections/ShapeSet');
    const { CoreSet } = await coreCopy('collections/CoreSet');
    assert.notEqual(Shape, OwnShape);

    class Person extends Shape {}
    Object.defineProperty(Person, 'shape', { value: { id: 'urn:shape:Person' } });
    const person = Object.create(Person.prototype, {
      id: { value: 'urn:person:1' },
      nodeShape: { value: { id: 'urn:shape:Person' } },
    });
    assert.equal(person instanceof OwnShape, false);

    assert.deepEqual(JSONWriter.toJsObject(person), { __s: 'urn:shape:Person', u: 'urn:person:1' });
    assert.deepEqual(JSONWriter.toJsObject(Person), { __sc: 'urn:shape:Person' });
    assert.equal(JSONWriter.toJsObject(Shape).__sc, Shape.shape?.id);
    assert.deepEqual(JSONWriter.toJsObject(new ShapeSet([person])), {
      __type: 'ss',
      entries: [{ __s: 'urn:shape:Person', u: 'urn:person:1' }],
    });
    assert.deepEqual(JSONWriter.toJsObject(new CoreSet([1, 2])), { __type: 'cs', entries: [1, 2] });
  });

  it('leaves plain classes and objects alone', async () => {
    const { JSONWriter } = await import('../lib/esm/utils/JSONWriter.js');
    class Plain {}
    assert.equal(typeof JSONWriter.toJsObject(Plain), 'function');
    assert.deepEqual(JSONWriter.toJsObject({ a: new Set() }), { a: {} });
  });
});
