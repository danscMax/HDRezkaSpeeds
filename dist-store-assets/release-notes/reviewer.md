0.7.1 — one CSS fix on top of 0.7.0. No new permissions, no new endpoints, no
new hosts. The permission set is byte-identical to 0.7.0.

1. src/index.ts — the content page now tags `<html>` with `data-vs-site`. The
   per-site accent colour is declared on `.vs-panel[data-vs-site]`, and the
   "in player" slider position deliberately moves the slider OUT of the panel
   into the player's own control bar, where that rule cannot match; it fell
   back to the `:root` default, which is red. One attribute fixes it for every
   surface that leaves the panel rather than per-surface. The toolbar popup
   already did the same on its own document.

Nothing else changed. Same build as 0.7.0 otherwise.

Build: WXT + Vite, output minified; source archive attached.
Build it with `npm ci && npm run zip:firefox` on Node 22.
