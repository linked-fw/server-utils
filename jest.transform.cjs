// Jest transform for @_linked/server-utils unit tests.
//
// The Babel presets in devDependencies are Babel 8, and Babel 8 plugins need Babel 8's core.
// `babel-jest` loads whichever `@babel/core` sits next to it: inside a workspace it is often
// hoisted to the root next to a Babel 7 core, and the TypeScript plugin then leaves type
// syntax such as `new Map<string, T>()` in the output. This transform loads `@babel/core`
// from this package, the copy the presets were installed against.
const babel = require('@babel/core');
const crypto = require('node:crypto');
const path = require('node:path');

// babel-jest's own preset hoists `jest.mock(...)` above the imports; it comes with babel-jest.
const jestPreset = require.resolve('babel-preset-jest', {
  paths: [path.dirname(require.resolve('babel-jest'))],
});

const options = {
  configFile: false,
  babelrc: false,
  sourceMaps: 'inline',
  presets: [
    [require.resolve('@babel/preset-env'), { targets: { node: 'current' } }],
    require.resolve('@babel/preset-typescript'),
    jestPreset,
  ],
};

module.exports = {
  process(source, filename, { supportsStaticESM, supportsDynamicImport }) {
    // The caller tells preset-env whether to keep ES modules; jest's CommonJS mode needs them compiled.
    const caller = { name: 'server-utils-jest', supportsStaticESM, supportsDynamicImport };
    const result = babel.transformSync(source, { ...options, filename, caller });
    return { code: result?.code ?? source };
  },
  getCacheKey(source, filename, { configString, supportsStaticESM }) {
    return crypto
      .createHash('sha1')
      .update(babel.version)
      .update('\0')
      .update(filename)
      .update('\0')
      .update(configString)
      .update('\0')
      .update(String(supportsStaticESM))
      .update('\0')
      .update(source)
      .digest('hex');
  },
};
