// Runs against the build output: `npm run build && npm test`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  crossOriginProps,
  cssReadinessScript,
  getPageOrigin,
  isCrossOrigin,
} from '../lib/esm/utils/HtmlAssets.js';

const PAGE = 'https://app.example.test';

describe('getPageOrigin', () => {
  it('uses the express request the browser actually asked for', () => {
    assert.equal(
      getPageOrigin({ protocol: 'https', get: () => 'app.example.test' }),
      PAGE
    );
    assert.equal(
      getPageOrigin({ protocol: 'http', headers: { host: 'localhost:8080' } }),
      'http://localhost:8080'
    );
  });

  it('falls back to SITE_ROOT when there is no request', () => {
    const previous = process.env.SITE_ROOT;
    process.env.SITE_ROOT = 'https://app.example.test/some/path';
    try {
      assert.equal(getPageOrigin(undefined), PAGE);
      assert.equal(getPageOrigin({}), PAGE);
    } finally {
      if (previous === undefined) delete process.env.SITE_ROOT;
      else process.env.SITE_ROOT = previous;
    }
  });

  it('returns undefined when neither is available', () => {
    const previous = process.env.SITE_ROOT;
    delete process.env.SITE_ROOT;
    try {
      assert.equal(getPageOrigin(undefined), undefined);
    } finally {
      if (previous !== undefined) process.env.SITE_ROOT = previous;
    }
  });
});

describe('isCrossOrigin', () => {
  for (const href of [
    '/assets/main.css',
    'assets/main.css',
    'https://app.example.test/assets/main.css',
    '',
    undefined,
  ]) {
    it(`treats ${JSON.stringify(href)} as same-origin`, () => {
      assert.equal(isCrossOrigin(href, PAGE), false);
    });
  }

  for (const href of [
    'https://cdn.example.test/r/1.2.3/main.css',
    'http://app.example.test/assets/main.css',
    'https://app.example.test:8443/assets/main.css',
    '//cdn.example.test/r/1.2.3/main.css',
  ]) {
    it(`treats ${href} as cross-origin`, () => {
      assert.equal(isCrossOrigin(href, PAGE), true);
    });
  }

  it('assumes same-origin when the page origin is unknown', () => {
    assert.equal(isCrossOrigin('https://cdn.example.test/a.css'), false);
    assert.equal(isCrossOrigin('https://cdn.example.test/a.css', 'nonsense'), false);
  });
});

describe('crossOriginProps', () => {
  it('adds nothing for a same-origin href', () => {
    assert.deepEqual(crossOriginProps('/assets/main.css', PAGE), {});
  });

  it('adds crossOrigin=anonymous for a cross-origin href', () => {
    assert.deepEqual(crossOriginProps('https://cdn.example.test/a.css', PAGE), {
      crossOrigin: 'anonymous',
    });
  });
});

function sheet(href, cssRules) {
  return {
    href,
    get cssRules() {
      if (typeof cssRules === 'function') throw cssRules();
      return cssRules;
    },
  };
}

function securityError() {
  const error = new Error('Cannot access rules');
  error.name = 'SecurityError';
  return error;
}

// Runs the pre-hydration script against fake browser globals and reports
// whether the first poll reveals the app.
function readyOnFirstPoll(routeStylesheets, styleSheets, mainCssReady = true) {
  let poll;
  const classes = [];
  const context = vm.createContext({
    document: {
      documentElement: { classList: { add: (name) => classes.push(name) } },
      styleSheets,
    },
    getComputedStyle: () => ({
      getPropertyValue: () => (mainCssReady ? '#123456' : ''),
    }),
    setInterval: (fn) => {
      poll = fn;
      return 1;
    },
    clearInterval: () => {},
    setTimeout: () => 2,
  });
  vm.runInContext(cssReadinessScript(routeStylesheets), context);
  poll();
  return classes.includes('css-ready');
}

describe('cssReadinessScript', () => {
  const route = 'https://cdn.example.test/r/1.2.3/signin.css';
  const local = '/assets/signin.css';

  it('waits for the main stylesheet', () => {
    assert.equal(readyOnFirstPoll([], [], false), false);
    assert.equal(readyOnFirstPoll([], [], true), true);
  });

  it('is unchanged for same-origin sheets', () => {
    assert.equal(readyOnFirstPoll([local], []), false);
    assert.equal(readyOnFirstPoll([local], [sheet(local, [])]), false);
    assert.equal(readyOnFirstPoll([local], [sheet(local, [{}])]), true);
  });

  it('treats a sheet whose CSSOM is locked as ready', () => {
    assert.equal(readyOnFirstPoll([route], [sheet(route, securityError)]), true);
  });

  it('still waits when the rules throw for another reason', () => {
    assert.equal(
      readyOnFirstPoll([route], [sheet(route, () => new Error('boom'))]),
      false
    );
  });
});

// The rendered markup is the thing that matters, but react-dom is not a
// dependency of this package, so this only runs where one is resolvable.
let renderToStaticMarkup;
let React;
let Html;
let AppContextProvider;
try {
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  React = (await import('react')).default;
  ({ Html } = await import('../lib/esm/components/Html.js'));
  ({ AppContextProvider } = await import('../lib/esm/components/AppContext.js'));
} catch {
  // left undefined; the suite below skips
}

describe('Html asset links', { skip: !renderToStaticMarkup }, () => {
  const render = (preloadScripts, preloadStyles) =>
    renderToStaticMarkup(
      React.createElement(
        AppContextProvider,
        {
          assets: { 'main.css': '/main.css' },
          preloadScripts,
          preloadStyles,
          expressRequest: { protocol: 'https', get: () => 'app.example.test' },
        },
        React.createElement(Html, { title: 'test', customHead: null })
      )
    );

  const links = (html, rel) =>
    (html.match(new RegExp(`<link rel="${rel}"[^>]*>`, 'g')) || []).filter(
      (tag) => !tag.includes('favicon')
    );

  it('leaves same-origin links untouched', () => {
    const html = render(['/assets/a.js'], ['/assets/a.css']);
    for (const rel of ['modulepreload', 'preload', 'stylesheet']) {
      const tags = links(html, rel);
      assert.ok(tags.length >= 1, `expected a ${rel} link`);
      for (const tag of tags) assert.ok(!tag.includes('crossorigin'), tag);
    }
  });

  it('marks cross-origin links, preload and stylesheet alike', () => {
    const base = 'https://cdn.example.test/r/1.2.3';
    const html = render([`${base}/a.js`], [`${base}/a.css`]);
    assert.ok(links(html, 'modulepreload')[0].includes('crossorigin="anonymous"'));
    assert.ok(links(html, 'preload')[0].includes('crossorigin="anonymous"'));
    const stylesheets = links(html, 'stylesheet');
    const route = stylesheets.find((tag) => tag.includes(base));
    const main = stylesheets.find((tag) => tag.includes('/main.css'));
    assert.ok(route.includes('crossorigin="anonymous"'), route);
    assert.ok(!main.includes('crossorigin'), main);
  });
});
