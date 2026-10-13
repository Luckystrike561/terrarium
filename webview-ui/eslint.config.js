import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import terrariumPlugin from '../eslint-rules/terrarium-rules.mjs';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'simple-import-sort': simpleImportSort,
      terrarium: terrariumPlugin,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // These react-hooks rules misfire on this project's imperative game-state patterns:
      // - immutability: singleton OfficeState/EditorState mutations are by design
      // - refs: containerRef reads during render feed canvas pipeline, not React state
      // - set-state-in-effect: timer-based animations and async error handling are legitimate
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'terrarium/no-inline-colors': 'error',
      'terrarium/pixel-shadow': 'error',
      'terrarium/pixel-font': 'error',
    },
  },
  {
    files: ['src/constants.ts', 'src/fonts/**', 'src/office/sprites/**'],
    rules: {
      'terrarium/no-inline-colors': 'off',
      'terrarium/pixel-shadow': 'off',
      'terrarium/pixel-font': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'max-lines': ['error', { max: 600 }],
    },
  },
  eslintConfigPrettier,
]);
