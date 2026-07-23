module.exports = {
  transform: { '^.+\\.(ts|js)$': 'ts-jest' },
  testEnvironment: 'node',
  testRegex: [
    '/tests/.*\\.(test|spec)\\.(ts)$',
    '/src/(dex|lib|executor)/.*\\.(test|spec)\\.(ts)$',
  ],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testTimeout: 30 * 1000,
  transformIgnorePatterns: ['node_modules/(?!.*uuid)'],
};
