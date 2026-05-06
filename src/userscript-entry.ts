/**
 * Userscript build entry. Wraps `bootstrap` from src/index.ts with a
 * synthetic ctx (no wxtCtx in Tampermonkey) and a GM-storage adapter so
 * the same source produces the .user.js output for users who prefer
 * Tampermonkey over the extension.
 *
 * Built by `vite.userscript.config.ts` via vite-plugin-monkey. The Vite
 * config aliases `wxt/browser` to a Proxy shim so any accidental access
 * throws an actionable error instead of silently no-op-ing.
 */

import { bootstrap } from './index';
import { createGmStorageAdapter } from './storage/adapter-gm';

(async () => {
  // Synthesize the WXT ContentScriptContext surface that bootstrap reads.
  // `onInvalidated` is the only field used; in TM there is no invalidation
  // event, so a no-op is correct.
  const tmCtx = {
    onInvalidated: (_fn: () => void) => {
      /* no-op in TM */
    },
  } as Parameters<typeof bootstrap>[0];

  await bootstrap(tmCtx, { adapter: createGmStorageAdapter() });
})().catch((e) => {
  console.error('[HDREZKA-SPEEDS] userscript bootstrap failed', e);
});
