import globals from 'globals';
import pluginJs from '@eslint/js';
import importPlugin from 'eslint-plugin-import-x';
import vitest from '@vitest/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier/recommended';

/** @type {import('eslint').Linter.Config[]} */
// @ts-ignore
export default [
  pluginJs.configs.recommended,
  importPlugin.flatConfigs.recommended,
  eslintConfigPrettier,
  prettierPlugin,
  {
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      globals: {
        ...globals.es2023,
        ...globals.node,
      },
    },
  },
  {
    rules: {
      'no-await-in-loop': 'error',
      'no-param-reassign': 'error',
      'class-methods-use-this': 'error',
      'no-shadow': 'error',
      'prefer-const': 'error',
      'import-x/no-extraneous-dependencies': ['error'],
      'import-x/first': ['error'],
      camelcase: ['error', { properties: 'never', ignoreDestructuring: false }],
      'prefer-destructuring': [
        'error',
        {
          VariableDeclarator: {
            array: false,
            object: true,
          },
          AssignmentExpression: {
            array: true,
            object: false,
          },
        },
        {
          enforceForRenamedProperties: false,
        },
      ],
      'no-plusplus': 'error',
      'consistent-return': 'error',
      'no-return-await': 'error',
      'arrow-body-style': 'error',
      'dot-notation': 'error',
      curly: 'error',
    },
  },
  {
    files: ['**/*.test.js'],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
    },
  },
];
