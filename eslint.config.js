// ESLint 10 flat config.
// Enforces SPEC 5.2 (no `any` in domain), 5.3 (dependency rule) and 5.4
// (every mutation goes through the optimistic wrapper in apps/web/src/lib/mutation.ts).
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TS = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];

/** Forbid every @velocity/* import except the allowed packages (SPEC 5.3). */
function workspaceOnly(allowed, extra = []) {
  const group = ['@velocity/*', ...allowed.map((p) => `!@velocity/${p}`), ...extra];
  const list = allowed.length > 0 ? allowed.map((p) => `@velocity/${p}`).join(', ') : 'no other workspace package';
  return {
    patterns: [
      {
        group,
        message: `Dependency rule (SPEC 5.3): this package may import only ${list}.`,
      },
    ],
  };
}

const APPS = ['@velocity/server', '@velocity/web', '@velocity/mcp'];
const appsNeverImportApps = {
  group: APPS.flatMap((a) => [a, `${a}/*`]),
  message: 'Apps never import other apps (SPEC 5.3). Share code through packages/*.',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/web/src/gql/**',
      '**/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: TS })),

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // react-hooks (rules-of-hooks, exhaustive-deps and the React Compiler rules).
  {
    files: ['**/*.tsx', '**/*.jsx'],
    ...reactHooks.configs.flat.recommended,
  },

  // "no any in domain" (SPEC 5.2)
  {
    files: [
      'packages/schema/**/*.{ts,tsx}',
      'packages/events/**/*.{ts,tsx}',
      'packages/services/**/*.{ts,tsx}',
      'packages/graphql/**/*.{ts,tsx}',
    ],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },

  // Dependency rule (SPEC 5.3): schema <- events <- services <- graphql <- apps; ui <- tokens.
  { files: ['packages/schema/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', workspaceOnly([])] } },
  { files: ['packages/events/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', workspaceOnly(['schema'])] } },
  {
    files: ['packages/services/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', workspaceOnly(['schema', 'events', 'importers'])] },
  },
  {
    files: ['packages/graphql/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', workspaceOnly(['schema', 'events', 'services'])] },
  },
  { files: ['packages/ui/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', workspaceOnly(['tokens'])] } },
  {
    files: ['apps/server/**/*.{ts,tsx}', 'apps/mcp/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [appsNeverImportApps] }] },
  },

  // apps/web: no apps, and no raw useMutation outside the optimistic wrapper (SPEC 5.4).
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [appsNeverImportApps],
          paths: [
            {
              name: '@apollo/client',
              importNames: ['useMutation'],
              message: 'Use the wrapper in apps/web/src/lib/mutation.ts: every mutation ships an optimistic counterpart (SPEC 5.4).',
            },
            {
              name: '@apollo/client/react',
              importNames: ['useMutation'],
              message: 'Use the wrapper in apps/web/src/lib/mutation.ts: every mutation ships an optimistic counterpart (SPEC 5.4).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/lib/mutation.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [appsNeverImportApps] }] },
  },
);
