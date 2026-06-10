/**
 * FEAT-017: Web Audio volume boost (>100%).
 *
 * `video.volume` is capped at 1.0, so amplification routes the element
 * through AudioContext → MediaElementSource → GainNode. Two hard
 * constraints shape this module:
 *
 *   1. createMediaElementSource() may be called ONCE per element for the
 *      lifetime of the page — we cache the graph in a WeakMap and only
 *      retune the gain afterwards.
 *   2. Cross-origin media without CORS headers yields SILENCE through
 *      Web Audio (spec-mandated). We can't detect that programmatically,
 *      so the settings UI warns the user and the feature defaults to
 *      100% (= disabled, no graph created).
 */

import type { Logger } from '../app/ports';

interface BoostGraph {
  audioCtx: AudioContext;
  gain: GainNode;
}

const graphs = new WeakMap<HTMLVideoElement, BoostGraph>();

/** Clamp to the UI range: 1.0 (off) .. 3.0 (300%). */
export function clampBoost(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1;
  return Math.min(3, Math.max(1, n));
}

/**
 * Apply `gainValue` to the element, lazily building the audio graph on
 * the first boost. Returns false when the graph could not be created
 * (already-consumed element from another script, exotic browser).
 *
 * gain ≤ 1.001 with no existing graph is a no-op by design: never build
 * the (risky, irreversible) graph just to set unity gain.
 */
export function applyVolumeBoost(
  video: HTMLVideoElement,
  gainValue: number,
  logger?: Logger,
): boolean {
  const target = clampBoost(gainValue);
  let graph = graphs.get(video);
  if (!graph) {
    if (target <= 1.001) return true; // off + no graph — nothing to do
    try {
      type AudioContextCtor = typeof AudioContext;
      const Ctor: AudioContextCtor | undefined =
        (globalThis as { AudioContext?: AudioContextCtor }).AudioContext ??
        (globalThis as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (!Ctor) return false;
      const audioCtx = new Ctor();
      const source = audioCtx.createMediaElementSource(video);
      const gain = audioCtx.createGain();
      source.connect(gain);
      gain.connect(audioCtx.destination);
      graph = { audioCtx, gain };
      graphs.set(video, graph);
    } catch (e) {
      logger?.warn('volume-boost: audio graph creation failed', e);
      return false;
    }
  }
  try {
    // Autoplay policy can leave a fresh context suspended until a user
    // gesture; the settings interaction that triggers us IS that gesture.
    if (graph.audioCtx.state === 'suspended') {
      void graph.audioCtx.resume();
    }
    graph.gain.gain.value = target;
    return true;
  } catch (e) {
    logger?.warn('volume-boost: gain update failed', e);
    return false;
  }
}
