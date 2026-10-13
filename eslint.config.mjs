import typescriptEslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import terrariumPlugin from './eslint-rules/terrarium-rules.mjs';

export default [
  {
    files: ['**/*.ts'],
  },
  {
    plugins: {
      '@typescript-eslint': typescriptEslint.plugin,
      'simple-import-sort': simpleImportSort,
      terrarium: terrariumPlugin,
    },

    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },

    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
      ],

      curly: 'error',
      eqeqeq: 'error',
      'no-throw-literal': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'terrarium/no-inline-colors': 'error',
    },
  },
  {
    files: ['server/src/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      'max-lines': ['error', { max: 600 }],
    },
  },
  {
    files: [
      'server/src/providers/claude/claudeFileWatcher.ts',
      'server/src/providers/claude/claudeHookHandler.ts',
      'server/src/providers/claude/claudeHookInstaller.ts',
      'server/src/providers/claude/claudeTranscriptParser.ts',
    ],
    rules: {
      'max-lines': 'off',
    },
  },
  eslintConfigPrettier,
];
