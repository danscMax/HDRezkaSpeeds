0.8.0 — behaviour + layout fix. No new permissions, no new hosts, no new
endpoints; the permission set is byte-identical to 0.7.4. Nothing is sent
anywhere, the only storage used is browser.storage.local.

1. src/speed/controller.ts, src/ui/panel.ts — a click on a speed preset used to
   ALSO write that speed into the opt-in per-content memory, so a user could not
   change the speed of one video without changing what the whole channel/title
   plays at. Presets are per-video now; storing a speed for the current content
   moved to its own button in the panel (toggles, and enables the feature when
   pressed).

2. src/storage/speed-store.ts, src/app/ports.ts — `forgetActive()` so that
   button can clear an entry.

3. src/ui/styles.ts — the panel is a flex row that wrapped instead of shrinking,
   which pushed the slider and the gear onto a second line. It is nowrap now and
   the presets row is the elastic part.

4. src/config.ts — `supportsContentMemory(site)` gates the new button to sites
   that can identify their content.

Nothing about the network surface, the host list or the data touched changes.
