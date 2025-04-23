import globals from 'globals';
import pluginJs from '@eslint/js';
// eslint-disable-next-line import-x/no-unresolved
import tseslint from 'typescript-eslint';

import { flatConfigs as importPlugin } from 'eslint-plugin-import-x';
import vitest from '@vitest/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
// eslint-disable-next-line import-x/extensions
import prettierPlugin from 'eslint-plugin-prettier/recommended';

// /** @type {import('eslint').Linter.Config[]} */
export default tseslint.config([
  {
    ignores: ['dist/'],
  },
  // tseslint.configs.recommended,
  pluginJs.configs.recommended,
  importPlugin.recommended,
  eslintConfigPrettier,
  prettierPlugin,
  {
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      globals: {
        ...globals.es2024,
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
      'import-x/extensions': ['error', 'always'],
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
    files: ['**/*.test.js', '**/*.test.ts'],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
    },
  },
]);
