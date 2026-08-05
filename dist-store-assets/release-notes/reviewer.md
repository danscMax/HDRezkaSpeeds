0.6.5 — two cosmetic fixes on top of 0.6.4. No new permissions, no new
endpoints, no behaviour change beyond the two below.

1. src/ui/styles.ts — the fullscreen rule for #speed-popup now outranks the
   per-theme rule (doubled id). Previously the light-theme background won on
   specificity, so the speed confirmation showed a white plate over video.

2. src/ui/notifications.ts — the 8-second deadline for otherwise-sticky chips
   now also applies in Plyr's CSS-only pseudo-fullscreen (class
   .plyr--fullscreen-fallback, where document.fullscreenElement is null).

Build: WXT + Vite, output minified; source archive attached.
Build it with `npm ci && npm run zip:firefox` on Node 22.
