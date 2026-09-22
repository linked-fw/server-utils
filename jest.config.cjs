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
    '^.+\\.tsx?$': [
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
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
