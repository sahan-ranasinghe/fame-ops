// Hotfix O2-H2: React's rules of hooks over the whole app. A hook called after an early return (the Who step's
// useEffect after `if (!d) return`) throws "Rendered fewer hooks than expected" the moment the condition changes; a
// release build shows a white screen. `npm run lint:hooks` fails the build on any such call. Only this rule is on:
// the codebase is checked by TypeScript and the test scripts for everything else.
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'android/**', 'ios/**', '.expo/**', 'scripts/**', '**/*.test.tsx', '**/*.test.ts'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' } },
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
];
