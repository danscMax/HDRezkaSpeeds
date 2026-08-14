0.7.3 — one line of the background worker changed on top of 0.7.2. No new
permissions, no new endpoints, no new hosts. The permission set is
byte-identical to 0.7.2; in the Firefox build it is `storage`, `scripting`,
`activeTab` (the Chrome-only `system.display` is added per-target and is not in
this archive).

1. src/entrypoints/background.ts — `systemDisplay()` used to reach the display
   API through `globalThis.chrome`, because the webextension-polyfill typings
   this file uses don't cover the `system.*` namespaces. It now references
   `chrome.system.display` literally, inside a try/catch: Firefox has no such
   namespace, and the throw is what puts the dim feature on its Firefox path
   (window-geometry probing) exactly as the `null` return did before.

Nothing else changed. Same build as 0.7.2 otherwise.

Build: WXT + Vite, output minified; source archive attached.
Build it with `npm ci && npm run zip:firefox` on Node 22.
