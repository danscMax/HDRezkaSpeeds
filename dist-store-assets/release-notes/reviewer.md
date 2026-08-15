0.7.4 — a manifest-only release. No source file changed, no new permissions, no
new endpoints, no new hosts. The permission set is byte-identical to 0.7.3; in
the Firefox build it is `storage`, `scripting`, `activeTab` (the Chrome-only
`system.display` is added per-target and is not in this archive).

1. wxt.config.ts — adds `browser_specific_settings.gecko_android` with
   `strict_min_version: "142.0"`, the same floor already declared for desktop
   under `gecko`. Everything the extension does on Android it already did on
   desktop; 142.0 is where Android Firefox learned
   `data_collection_permissions`, which this add-on declares as
   `required: ["none"]`.

   Why now: versions 0.5.1–0.6.1 were listed as Android-compatible, then 0.6.2
   onwards silently lost it when uploads moved to the AMO API. Declaring the key
   in the manifest makes the flag part of the build instead of an upload-time
   checkbox.

2. public/_locales/ru/messages.json — one word in the Russian store summary,
   «трекинга» → «слежки». Listing copy only, not used anywhere in code.

Nothing else changed. Same build as 0.7.3 otherwise.

Build: WXT + Vite, output minified; source archive attached.
Build it with `npm ci && npm run zip:firefox` on Node 22.
