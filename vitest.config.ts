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
    // Wave 0b ships configs before any unit suite exists. Wave 1.0b lands
    // the first real spec (cleanup.spec.ts). Until then, run with no failure.
    passWithNoTests: true,
    globals: false,
    reporters: ['default'],
  },
});
