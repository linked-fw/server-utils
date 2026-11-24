// Runs against the build output: `npm run build && npm test`.
//
// The ontology is registered by `ontologies/index` under its name `server-utils`, with the
// namespace `https://linked.cm/ont/server-utils/` and the suggested prefix its data states. It
// registers no prefix: an app's prefix map holds the prefixes. The old `lincd-server-utils`
// module path stays as a deprecated alias.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Prefix } from '@_linked/core/utils/Prefix';
import { getRegisteredOntologies, suggestedPrefixes } from '@_linked/core/utils/Package';
import * as current from '../lib/esm/ontologies/server-utils.js';
import * as legacy from '../lib/esm/ontologies/lincd-server-utils.js';
import '../lib/esm/ontologies/index.js';

const NS = 'https://linked.cm/ont/server-utils/';

describe('server-utils ontology', () => {
  it('lives at the linked.cm namespace', () => {
    assert.equal(current.ns('').id, NS);
    assert.equal(current.serverUtils.Lincd_API_Client.id, NS + 'Lincd_API_Client');
  });

  it('is registered by the index with its suggested prefix, and adds no prefix', () => {
    const registration = getRegisteredOntologies().find((r) => r.packageName === '@_linked/server-utils');
    assert.equal(registration?.name, 'server-utils');
    assert.equal(registration?.namespace, NS);
    assert.deepEqual(
      suggestedPrefixes().filter((p) => p.packageName === '@_linked/server-utils'),
      [{ packageName: '@_linked/server-utils', name: 'server-utils', namespace: NS, prefix: 'server-utils' }],
    );
    assert.equal(Prefix.getPrefix(NS), undefined);
  });

  it('compacts with the prefix an app maps it to', () => {
    const map = { server_utils: NS };
    assert.equal(Prefix.toPrefixed(NS + 'Lincd_API_Client', map), 'server_utils:Lincd_API_Client');
    assert.equal(Prefix.toFull('server_utils:Lincd_API_Client', map), NS + 'Lincd_API_Client');
  });

  it('keeps the deprecated module path and terms object', () => {
    assert.equal(legacy.serverUtils, current.serverUtils);
    assert.equal(legacy.lincdServerUtils, current.serverUtils);
  });

  it('states its suggested prefix in its Turtle data', async () => {
    const turtle = await readFile(new URL('../lib/esm/data/server-utils.ttl', import.meta.url), 'utf8');
    assert.match(turtle, /^@prefix server-utils: <https:\/\/linked\.cm\/ont\/server-utils\/> \.$/m);
    assert.match(turtle, /vann:preferredNamespacePrefix "server-utils"/);
    assert.doesNotMatch(turtle, /lincd-server-utils/);
    assert.match(turtle, /^server-utils:Lincd_API_Client$/m);
  });
});
