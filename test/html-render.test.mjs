// Html's server render: data in AppContext that holds `</script>` stays inside its <script>, and
// the client reads back the same value. Runs against the build output: `npm run build && npm test`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../lib/esm/components/AppContext.js';
import { Html } from '../lib/esm/components/Html.js';

const HOSTILE = '</script><b>x</b>';

function render(context) {
  return renderToStaticMarkup(
    React.createElement(
      AppContext.Provider,
      { value: { assets: {}, ...context } },
      React.createElement(Html, { title: 't', customHead: null })
    )
  );
}

function scriptText(html, id) {
  const match = html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  assert.ok(match, `a #${id} script`);
  return match[1];
}

describe('Html', () => {
  const frontendData = { x: HOSTILE, list: ['<!--', '&amp;', 'a\u2028b'] };
  const html = render({
    requestObject: JSON.stringify(frontendData),
    requestLD: JSON.stringify({ '@id': HOSTILE }),
    assets: { 'main.js': `/${HOSTILE}.js` },
    expressRequest: { matchedRouteKey: HOSTILE, protocol: 'https', get: () => 'app.test' },
  });

  it('writes no raw `</script><b>` from the data', () => {
    assert.ok(!html.includes(HOSTILE), html);
  });

  it('request-json parses back to the same frontendData', () => {
    assert.deepEqual(JSON.parse(scriptText(html, 'request-json')), frontendData);
  });

  it('request-ld parses back to the same value', () => {
    assert.deepEqual(JSON.parse(scriptText(html, 'request-ld')), { '@id': HOSTILE });
  });

  it('the preload routes and the asset manifest stay valid script', () => {
    assert.ok(html.includes('window.__PRELOAD_ROUTES__ = ["\\u003c/script\\u003e'));
    const manifest = html.match(/assetManifest = (\{[\s\S]*?\});<\/script>/);
    assert.ok(manifest, 'an assetManifest script');
    assert.deepEqual(JSON.parse(manifest[1]), { 'main.js': `/${HOSTILE}.js` });
  });
});
