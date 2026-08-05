0.6.3 — onboarding only. No new permissions, no new remote endpoints.

1. Default playback speed for a FRESH profile changed from 1.4 to 1.0
   (src/config.ts SPEED_BOUNDS). Stored speeds are untouched — the value is
   only used as a fallback and by the "full reset" action.

2. New one-time hint chip on first panel render (src/index.ts
   showFirstRunHint + src/storage/onboarding-store.ts). Local flag in
   storage.local, no network.

3. The welcome page's "Open HDRezka" button now asks the background worker
   for a reachable mirror (existing message `mirrors:open-reachable`,
   unchanged) instead of linking to one hardcoded domain. The plain link
   remains as a no-JS fallback.

4. welcome.html now also opens on runtime.onInstalled reason === 'update',
   and only when permissions.contains() reports no access — this is the
   Firefox case where an update-added host permission is not granted
   (bug 1893232) and the add-on is silently inert.

Build: WXT + Vite, output minified; source archive attached.
Build it with `npm ci && npm run zip:firefox` on Node 22.
