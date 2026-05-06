/**
 * Userscript-build shim for `wxt/browser`.
 *
 * Vite aliases `wxt/browser` to this file in the userscript build so the
 * content-script code that imports `browser` keeps compiling. Anything
 * that actually CALLS `browser.storage.local` in the userscript build is
 * a bug -- the userscript entry overrides the storage adapter with a
 * GM-storage backend BEFORE bootstrap touches the default browser one.
 *
 * The shim returns a Proxy so accidental access throws an actionable
 * error instead of silently returning undefined deep in promise chains.
 */

const ERROR_MSG =
  'wxt/browser is not available in the userscript build. Use createGmStorageAdapter instead.';

const trap = {
  get(): unknown {
    throw new Error(ERROR_MSG);
  },
};

export const browser = new Proxy({}, trap) as never;
