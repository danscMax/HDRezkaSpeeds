import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    globals: false,
    reporters: ['default'],
    // Run in node — the helpers we test are pure and use crypto.subtle
    // which Node 22+ provides natively under globalThis.crypto. Full
    // worker-runtime tests (via @cloudflare/vitest-pool-workers + SELF)
    // can be added later for the fetch handler.
    environment: 'node',
  },
});
