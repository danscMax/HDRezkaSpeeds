import { defineConfig } from 'vitest/config';

// Vitest config for pure-module unit tests (i18n translator, hotkey normalizer,
// validators, AppContext cleanup, TM coexistence, etc.).
//
// Browser-side smoke tests live in tests/smoke/ and run via Playwright (see
// playwright.config.ts). Vitest never picks them up.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.spec.ts'],
    exclude: ['tests/smoke/**', 'node_modules/**', '.output/**', '.wxt/**'],
    globals: false,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/entrypoints/**',
        'src/userscript-entry.ts',
        'src/userscript-shims/**',
        'src/**/index.ts',
      ],
    },
  },
});
