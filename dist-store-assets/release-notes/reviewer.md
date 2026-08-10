0.7.0 — two presentation fixes. No new permissions, no new endpoints, no new
hosts. The permission set is byte-identical to 0.6.6.

1. src/ui/styles.ts — the fullscreen rule no longer hides
   `.vs-slider-in-chrome`. That class is the speed slider when the user has
   chosen to mount it inside the player's own control bar; it is a player
   control, fades with the rest of the bar, and hiding it left that display
   mode blank in fullscreen. The floating panel (`.vs-panel`) stays hidden
   there, unchanged.

2. src/ui/styles.ts — `#speed-popup` now uses one anchor in both modes (top
   centre of the player). Previously the base rule pinned it to the right edge
   and the fullscreen rule re-anchored it to the top centre, so the readout
   moved when the user went fullscreen. The fullscreen block now only changes
   scale and keeps the dark plate; it declares no position properties.

3. src/ui/settings/modal.ts — whether the "in player" slider position is
   offered is now derived from the selector table rather than rendered
   unconditionally. No behaviour change in this extension (one site, and it has
   a control bar); it keeps both twins asking the question the same way.

Build: WXT + Vite, output minified; source archive attached.
Build it with `npm ci && npm run zip:firefox` on Node 22.
