// Runs against the build output: `npm run build && npm test`.
//
// The ontology's prefix label equals its ontologySlug (`server-utils`, the package's publicSlug)
// and its namespace is `https://linked.cm/ont/server-utils/`. The old `lincd-server-utils` label
// and module paths stay as deprecated aliases.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Prefix } from '@_linked/core/utils/Prefix';
import * as current from '../lib/esm/ontologies/server-utils.js';
import * as legacy from '../lib/esm/ontologies/lincd-server-utils.js';
import '../lib/esm/ontologies/server-utils.register.js';
import '../lib/esm/ontologies/lincd-server-utils.register.js';

const NS = 'https://linked.cm/ont/server-utils/';

describe('server-utils ontology', () => {
  it('lives at the linked.cm namespace', () => {
    assert.equal(current.ns('').id, NS);
    assert.equal(current.serverUtils.Lincd_API_Client.id, NS + 'Lincd_API_Client');
  });

  it('compacts to the server-utils prefix', () => {
    assert.equal(Prefix.getPrefix(NS), 'server-utils');
    assert.equal(Prefix.toPrefixed(NS + 'Lincd_API_Client'), 'server-utils:Lincd_API_Client');
    assert.equal(Prefix.toFull('server-utils:Lincd_API_Client'), NS + 'Lincd_API_Client');
  });

  it('still expands the deprecated lincd-server-utils prefix', () => {
    assert.equal(Prefix.toFull('lincd-server-utils:Lincd_API_Client'), NS + 'Lincd_API_Client');
  });

  it('keeps the deprecated module path and terms object', () => {
    assert.equal(legacy.serverUtils, current.serverUtils);
    assert.equal(legacy.lincdServerUtils, current.serverUtils);
  });

  it('uses the server-utils prefix in its JSON-LD data', async () => {
    const data = JSON.parse(
      await readFile(new URL('../lib/esm/data/server-utils.json', import.meta.url), 'utf8'),
    );
    assert.equal(data['@context']['server-utils'], NS);
    assert.equal(data['@context']['lincd-server-utils'], undefined);
    assert.equal(data['@graph'][0]['@id'], 'server-utils:Lincd_API_Client');
    assert.equal(await current.loadData().then((d) => d['@context']['server-utils']), NS);
  });
});
