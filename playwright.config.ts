import { defineConfig } from '@playwright/test';

// Playwright config for extension smoke tests.
//
// Extension loading happens INSIDE each spec via chromium.launchPersistentContext
// (Playwright cannot load unpacked extensions through the top-level `use` block —
// extensions need a persistent profile). See tests/smoke/extension-loads.spec.ts.
//
// The build output at .output/chrome-mv3/ must exist before running these tests.
// CI builds it explicitly; local runs need `npx wxt build` first.
export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 60_000,
  retries: 0,
  workers: 1, // extension tests share Chrome user profile state
  reporter: [['list']],
  use: {
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
  },
});
