0.7.5 — a bug-fix release. No new permissions, no new hosts, no new endpoints.
The permission set is byte-identical to 0.7.4. Nothing is sent anywhere; the
only storage used is browser.storage.local.

What changed, all of it in the extension's own content-script logic:

1. src/storage/speed-store.ts, src/speed/controller.ts, src/app/ports.ts — the
   opt-in "remember a speed per title" feature discarded a speed chosen before
   the page revealed which title is open. The value is now held in memory and
   written once the key is known; a navigation drops it so a choice from the
   previous page cannot be attributed to the next title.

This add-on shares its core with a sister add-on for YouTube, where the same
bug made the equivalent per-channel feature unusable; the fix is applied in
both so the shared code stays identical.

No change to the network surface, the host list or the data the extension
touches.
