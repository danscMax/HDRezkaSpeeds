0.6.4 — one behaviour change, no new permissions, no new endpoints.

The fullscreen rule changed: persistent chrome (speed panel, in-player slider)
stays hidden, but the transient speed confirmation ("1.50x") and the toast/chip
stack are shown again. Reason: in fullscreen the panel is hidden, so the
keyboard shortcut is the only control, and it gave no feedback at all.

Implementation notes:
- src/ui/styles.ts — `.speed-popup` removed from the `:fullscreen` hide list,
  plus a fullscreen-only size/position block (top centre, larger type).
- src/ui/popup.ts, src/ui/notifications.ts — both surfaces are re-parented
  under `document.fullscreenElement` while it is set, because native fullscreen
  paints only that subtree. Restored to the player container on exit.
- Sticky chips get an 8s deadline while fullscreen is active.

Build: WXT + Vite, output minified; source archive attached.
Build it with `npm ci && npm run zip:firefox` on Node 22.
