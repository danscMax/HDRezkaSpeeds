/**
 * Safe wrapper over page `localStorage`. Used ONLY during migration to
 * read keys the legacy userscript wrote (`<site>-speed-settings` etc.).
 * Production storage is `browser.storage.local` via storage/adapter.ts.
 *
 * Why a wrapper: localStorage access throws on private windows, sandboxed
 * iframes, and a few enterprise-locked profiles. We swallow and return
 * null so migration can continue without taking down bootstrap.
 */
export const safeStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  removeItem(key: string): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
};
