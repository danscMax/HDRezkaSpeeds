# AMO source-code submission notes

Mozilla Add-ons review requires reproducible build instructions whenever a
submitted package contains generated code. This extension is built with
[WXT](https://wxt.dev) + Vite; the `.xpi` content is the output of a plain
production build with no manual post-processing.

## Environment

- Node.js ≥ 20 (CI uses the active LTS)
- npm ≥ 10
- OS: any (Windows / Linux / macOS produce identical bundles modulo zip
  metadata)

## Reproduce the Firefox build

```bash
npm ci
npm run build:firefox        # → .output/firefox-mv3/
npm run zip:firefox          # → .output/*.zip (the submitted artifact)
```

## Reproduce the Chrome build

```bash
npm ci
npm run build                # → .output/chrome-mv3/
npm run zip                  # → .output/*.zip
```

## Source layout

- `src/` — TypeScript sources (all first-party; no bundled third-party UI
  libraries)
- `wxt.config.ts` — manifest definition (permissions, content scripts)
- `public/icon/` — static icons
- The userscript build (`npm run build:userscript`) shares the same `src/`
  via `vite.userscript.config.ts` and is NOT part of the store package.

## Verification

`npm run typecheck && npm test` must pass on the same tree that produced
the artifact; CI (.github/workflows/ci.yml) runs both plus a bundle-size
gate on every push.
