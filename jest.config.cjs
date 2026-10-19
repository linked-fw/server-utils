// Jest config for @_linked/server-utils unit tests.
//
// The package is ESM-only. Rather than configure jest's ESM mode (notoriously
// fiddly), tests import raw `src/` .ts and let babel-jest transpile ESM→CJS —
// the same arrangement @_linked/cli uses. The `moduleNameMapper` strips the
// `.js` suffix from relative specifiers (src uses the published-output
// `./foo.js` convention) so they resolve back to the `.ts` source.
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.{ts,tsx,js}'],
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        configFile: false,
        babelrc: false,
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // `@_linked/core`'s export map is `import`-only, which jest's CJS resolver cannot follow.
    // These two modules have no imports, so their build output is mapped directly and
    // transpiled like the source (see `transformIgnorePatterns`).
    '^@_linked/core/utils/(sharedState|linkedError)$':
      '<rootDir>/node_modules/@_linked/core/lib/esm/utils/$1.js',
  },
  transformIgnorePatterns: ['/node_modules/(?!@_linked/core/)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
