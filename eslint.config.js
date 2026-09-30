// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Determinism rules for packages/sim (ADR-002). The simulation must never read
 * wall-clock time, ambient randomness or floating-point transcendental functions,
 * and must not depend on rendering, DOM or network code.
 */
const nondeterministicMath = ['random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'exp', 'log', 'log2', 'log10', 'hypot', 'cbrt', 'sqrt', 'sinh', 'cosh', 'tanh', 'expm1', 'log1p', 'fround'];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/sim/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-properties': [
        'error',
        ...nondeterministicMath.map((property) => ({
          object: 'Math',
          property,
          message: 'Non-deterministic or float-transcendental Math in sim. Use core/trig.ts / core/rng.ts.',
        })),
        { object: 'Date', property: 'now', message: 'No wall-clock time in sim.' },
        { object: 'performance', property: 'now', message: 'No wall-clock time in sim.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'No wall-clock time in sim.' },
        { name: 'performance', message: 'No wall-clock time in sim.' },
        { name: 'crypto', message: 'No ambient randomness in sim; use state.rng.' },
        { name: 'setTimeout', message: 'Sim is driven by step() only.' },
        { name: 'setInterval', message: 'Sim is driven by step() only.' },
        { name: 'requestAnimationFrame', message: 'Sim is driven by step() only.' },
        { name: 'window', message: 'Sim must not touch the DOM.' },
        { name: 'document', message: 'Sim must not touch the DOM.' },
        { name: 'fetch', message: 'Sim must not do I/O.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['pixi.js', 'pixi.js/*', '@pixi/*'], message: 'Rendering does not belong in sim.' },
            { group: ['react', 'react-dom', 'howler', 'ws'], message: 'UI/audio/net do not belong in sim.' },
            { group: ['@gumfire/*'], message: 'sim imports nothing from other packages.' },
            { group: ['node:*', 'fs', 'path'], message: 'Sim must be platform-independent.' },
          ],
        },
      ],
    },
  },
);
