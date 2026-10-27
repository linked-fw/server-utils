// Jest config for @_linked/server-utils unit tests.
//
// The package is ESM-only. Rather than configure jest's ESM mode (notoriously
// fiddly), tests import raw `src/` .ts and let Babel transpile ESM→CJS —
// the same arrangement @_linked/cli uses. The `moduleNameMapper` strips the
// `.js` suffix from relative specifiers (src uses the published-output
// `./foo.js` convention) so they resolve back to the `.ts` source.
const fs = require('node:fs');
const path = require('node:path');

// Where `@_linked/core` is installed: next to this package standalone, hoisted in a workspace.
function coreDir() {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', '@_linked', 'core');
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (dir === path.dirname(dir)) throw new Error('@_linked/core is not installed');
  }
}

module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.{ts,tsx,js}'],
  // `jest.transform.cjs` runs Babel with this package's own `@babel/core` (see there).
  transform: { '^.+\\.[jt]sx?$': '<rootDir>/jest.transform.cjs' },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // `@_linked/core`'s export map is `import`-only, which jest's CJS resolver cannot follow.
    // These two modules have no imports, so their build output is mapped directly and
    // transpiled like the source (see `transformIgnorePatterns`).
    '^@_linked/core/utils/(sharedState|linkedError)$':
      path.join(coreDir(), 'lib/esm/utils/$1.js'),
  },
  transformIgnorePatterns: ['/node_modules/(?!@_linked/core/)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
