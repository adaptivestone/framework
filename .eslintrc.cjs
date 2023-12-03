module.exports = {
  env: {
    es2023: true,
    node: true,
  },
  extends: ['airbnb-base', 'prettier'],
  plugins: ['prettier'],
  parserOptions: {
    ecmaVersion: 2023,
  },
  rules: {
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
    'prettier/prettier': 'error',
    'import/extensions': 'off', // it have a problem with dynamic imports
  },
  overrides: [
    {
      files: ['**/*.test.js'],
      extends: ['plugin:vitest/all', 'plugin:vitest/recommended'],
      plugins: ['vitest'],
    },
  ],
};
