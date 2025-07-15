module.exports = {
  env: {
    node: true,
  },
  extends: [
    // Enable other rules gradually when you really to rewrite everything

    // 'eslint:recommended',
    // 'airbnb-base',
    // 'plugin:import/typescript',
    // 'plugin:@typescript-eslint/eslint-recommended',
    // 'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'ES2019',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    'import/no-unresolved': 0,
    'import/prefer-default-export': 0,
    'import/extensions': 0,
    'no-underscore-dangle': 0,
    'no-shadow': 'off',
    // '@typescript-eslint/no-shadow': ['error'],
    'no-plusplus': 'off',
    'no-continue': 'off',
    'no-param-reassign': 'off',
    'no-console': 'error',
    'max-classes-per-file': 'off',
    'no-await-in-loop': 'off',
    '@typescript-eslint/no-unused-vars': ['off'],
    '@typescript-eslint/no-var-requires': 0,
    '@typescript-eslint/no-non-null-assertion': 0,
    'class-methods-use-this': 0,
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ForInStatement',
        message:
          'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.',
      },
      {
        selector: 'LabeledStatement',
        message:
          'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.',
      },
      {
        selector: 'WithStatement',
        message:
          '`with` is disallowed in strict mode because it makes code impossible to predict and optimize.',
      },
    ],
  },
  overrides: [
    {
      files: ['tests/**/*.ts', '*.test.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
};
