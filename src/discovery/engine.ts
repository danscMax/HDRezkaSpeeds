/**
 * DiscoveryEngine -- 5-strategy resolve chain.
 *
 *   1. cache         -- look up the per-key entry stored on a previous run
 *   2. exact         -- walk the per-site selector table from selectors.ts
 *   3. substring     -- try `[class*="..."]` for known stable fragments
 *   4. ancestor      -- start from the <video>, walk up looking for a
 *                       container that the validator accepts
 *   5. heuristic     -- geometry-based scan (largest <video>, smallest
 *                       container around video, sibling of player with
 *                       text content for infoElem)
 *
 * Strategy gating:
 *   - opts.exactOnly   -- forces exact-only (skip cache + 3-5)
 *   - opts.skipCache   -- skip strategy 1 only (revalidation passes)
 *   - isFullChainEnabled() -- closure injected at construction; lets the
 *     KillSwitch (Wave 1.9) disable strategies 3-5 without engine knowing
 *     anything about KillSwitch directly.
 *
 * Ported from .user.js:1273-1452 with HDRezka selectors / metrics dropped.
 */

import type { Site } from '../app/ports';
import type { Logger } from '../app/ports';
import type { SelectorCacheImpl } from './cache';
import type {
  DiscoveryMetrics,
  ResolveResult,
  SelectorKey,
  Validator,
} from './types';
import { selectorsFor, substringFragmentsFor } from './selectors';

export interface DiscoveryEngineDeps {
  site: Site;
  cache: SelectorCacheImpl;
  validators: Record<SelectorKey, Validator>;
  /** Returns false when KillSwitch trips strategies 3-5 off. */
  isFullChainEnabled?: () => boolean;
  logger?: Logger;
  /** Override for tests; defaults to `document`. */
  doc?: Document;
}

export interface ResolveOptions {
  exactOnly?: boolean;
  skipCache?: boolean;
}

export interface DiscoveryEngineImpl {
  resolve(key: SelectorKey, opts?: ResolveOptions): ResolveResult | null;
  metrics(): Readonly<DiscoveryMetrics>;
}

export function createDiscoveryEngine(deps: DiscoveryEngineDeps): DiscoveryEngineImpl {
  const { site, cache, validators } = deps;
  const isFullChain = deps.isFullChainEnabled ?? (() => true);
  const log = deps.logger;
  const doc: Document = deps.doc ?? document;

  const selectors = selectorsFor(site);
  const metrics: DiscoveryMetrics = {
    cacheHits: 0,
    cacheMisses: 0,
    cachePurges: 0,
    lastBySource: {},
  };

  function trySelector(sel: string): Element | null {
    try { return doc.querySelector(sel); } catch { return null; }
  }

  function ok(key: SelectorKey, el: Element | null): boolean {
    if (!el) return false;
    return validators[key]?.(el).ok ?? false;
  }

  function walkAncestors(video: Element, key: SelectorKey): Element | null {
    let node: Element | null = video;
    for (let depth = 0; depth < 8 && node && node !== doc.body; depth++) {
      node = node.parentElement;
      if (!node) break;
      if (ok(key, node)) {
        if (key === 'playerContainer' && !node.contains(video)) continue;
        return node;
      }
    }
    return null;
  }

  function pickStableClassFragment(cls: string): string | null {
    if (!cls) return null;
    const parts = cls.split(/\s+/)
      .map((c) => c.replace(/_{2,}[\w-]+$/, '')) // strip CSS-Modules hash tail
      .filter((c) => c.length >= 5 && !/^\d/.test(c))
      .sort((a, b) => b.length - a.length);
    return parts[0] ?? null;
  }

  function buildStableSelector(el: Element): string | null {
    try {
      if (el.id && !/^(react-|ember|generated-|:r)/.test(el.id)) {
        const escape = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape;
        return '#' + (escape ? escape(el.id) : el.id);
      }
      const cls = typeof (el as HTMLElement).className === 'string'
        ? (el as HTMLElement).className
        : '';
      const frag = pickStableClassFragment(cls);
      if (frag) return `[class*="${frag}"]`;
      return el.tagName.toLowerCase();
    } catch {
      return null;
    }
  }

  function heuristicScan(key: SelectorKey): Element | null {
    try {
      if (key === 'video') {
        const all = Array.from(doc.querySelectorAll('video')) as HTMLVideoElement[];
        if (!all.length) return null;
        const ranked = all
          .map((v) => {
            const r = v.getBoundingClientRect();
            return {
              el: v,
              area: r.width * r.height,
              ready: v.readyState >= 1 || !!v.currentSrc,
            };
          })
          .filter((x) => x.ready)
          .sort((a, b) => b.area - a.area);
        return ranked[0]?.el ?? null;
      }

      if (key === 'playerContainer') {
        const candidates = (Array.from(doc.querySelectorAll('div, section, article')) as HTMLElement[])
          .filter((el) => el.querySelector('video'))
          .map((el) => ({ el, area: el.clientWidth * el.clientHeight }))
          .filter((x) => x.area > 0 && x.el.clientWidth > 200 && x.el.clientHeight > 100)
          // Smallest containing video = the tightest wrapper, usually the player.
          .sort((a, b) => a.area - b.area);
        return candidates[0]?.el ?? null;
      }

      if (key === 'infoElem') {
        const player = doc.querySelector('video')?.closest('div, section');
        if (!player) {
          const h1 = doc.querySelector('h1');
          return h1?.parentElement ?? null;
        }
        let probe: Element | null = player;
        for (let i = 0; i < 4; i++) {
          probe = probe?.nextElementSibling
            ?? (probe?.parentElement?.nextElementSibling ?? null);
          if (!probe) break;
          if (
            (probe as HTMLElement).clientHeight > 60 &&
            (probe.querySelector('h1, h2') || probe.querySelector('p'))
          ) {
            return probe;
          }
        }
        const h1 = doc.querySelector('h1');
        return h1?.parentElement ?? null;
      }
    } catch (e) {
      log?.debug('heuristicScan error', e);
    }
    return null;
  }

  function record(key: SelectorKey, source: ResolveResult['source'] | null): void {
    metrics.lastBySource[key] = source;
  }

  function build(
    key: SelectorKey,
    element: Element,
    source: ResolveResult['source'],
    selector: string,
    confidence: number,
  ): ResolveResult {
    const signature = cache.buildSignature(element);
    record(key, source);
    return { element, source, selector, signature, confidence };
  }

  function resolve(key: SelectorKey, opts?: ResolveOptions): ResolveResult | null {
    const useFullChain = isFullChain() && !opts?.exactOnly;

    // Strategy 1: cache
    if (!opts?.skipCache && useFullChain) {
      const hit = cache.get(key);
      if (hit?.selector) {
        const el = trySelector(hit.selector);
        if (el && ok(key, el)) {
          const sigNow = cache.buildSignature(el);
          if (!hit.signature || sigNow === hit.signature) {
            cache.bumpSuccess(key);
            metrics.cacheHits += 1;
            record(key, 'cache');
            return { element: el, source: 'cache', selector: hit.selector, signature: sigNow, confidence: 1 };
          }
        }
        if (cache.bumpFailure(key)) metrics.cachePurges += 1;
        metrics.cacheMisses += 1;
      }
    }

    // Strategy 1.5: backup (audit M12). Try the previous good entry that
    // was archived just before the most recent signature drift. This saves
    // a full re-scan when the rename was superficial -- the host page
    // shipped a new build and the old selector still matches the same
    // element via `[class*="..."]` substring lookups, etc. We only consult
    // this when the primary cache missed AND we're allowed full-chain;
    // exactOnly callers (revalidation passes) skip it. When the backup
    // resolves AND validates, promote it back to primary cache so the
    // next resolve hits strategy 1.
    if (!opts?.skipCache && !opts?.exactOnly && useFullChain) {
      const backup = cache.tryRestoreBackup(key);
      if (backup?.selector) {
        const el = trySelector(backup.selector);
        if (el && ok(key, el)) {
          cache.set(key, {
            selector: backup.selector,
            source: backup.source,
            confidence: Math.max(0.5, backup.confidence * 0.8),
            signature: cache.buildSignature(el),
          });
          return build(key, el, backup.source, backup.selector, Math.max(0.5, backup.confidence * 0.8));
        }
      }
    }

    // Strategy 2: exact
    const exactList = selectors[key] ?? [];
    for (const sel of exactList) {
      const el = trySelector(sel);
      if (el && ok(key, el)) {
        if (useFullChain) {
          cache.set(key, {
            selector: sel,
            source: 'exact',
            confidence: 0.9,
            signature: cache.buildSignature(el),
          });
        }
        return build(key, el, 'exact', sel, 0.9);
      }
    }

    if (!useFullChain) {
      record(key, null);
      return null;
    }

    // Strategy 3: substring
    for (const fragment of substringFragmentsFor(site, key)) {
      const sel = `[class*="${fragment}"]`;
      const el = trySelector(sel);
      if (el && ok(key, el)) {
        cache.set(key, {
          selector: sel,
          source: 'substring',
          confidence: 0.7,
          signature: cache.buildSignature(el),
        });
        return build(key, el, 'substring', sel, 0.7);
      }
    }

    // Strategy 4: ancestor-from-video (only meaningful for player/info)
    if (key === 'playerContainer' || key === 'infoElem') {
      const video = doc.querySelector('video');
      if (video) {
        const el = walkAncestors(video, key);
        if (el) {
          const sel = buildStableSelector(el) ?? el.tagName.toLowerCase();
          cache.set(key, {
            selector: sel,
            source: 'ancestor',
            confidence: 0.55,
            signature: cache.buildSignature(el),
          });
          return build(key, el, 'ancestor', sel, 0.55);
        }
      }
    }

    // Strategy 5: heuristic
    const el = heuristicScan(key);
    if (el && ok(key, el)) {
      const sel = buildStableSelector(el);
      if (sel) {
        cache.set(key, {
          selector: sel,
          source: 'heuristic',
          confidence: 0.4,
          signature: cache.buildSignature(el),
        });
      }
      return build(key, el, 'heuristic', sel ?? el.tagName.toLowerCase(), 0.4);
    }

    record(key, null);
    return null;
  }

  return {
    resolve,
    metrics: () => metrics,
  };
}
