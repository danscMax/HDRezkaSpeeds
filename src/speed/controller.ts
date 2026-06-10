/**
 * Speed controller -- the only module that touches `video.playbackRate`.
 *
 * Entry points (audit 2026-05-11 W3.1: setSpeed was deleted as dead
 * code; all callers migrated to one of the three explicit semantics):
 *   - applyTransient(ctx, speed)        -- writes to video + UI, no
 *                                          storage. Used by slider
 *                                          drag (rAF-coalesced).
 *   - setTemporary(ctx, speed)          -- writes to smart-store
 *                                          (one-shot for this video).
 *                                          Pill click, hotkey, slider
 *                                          change-event release.
 *   - setGlobal(ctx, speed)             -- writes current + forces
 *                                          rememberSpeed=true + toast.
 *                                          Pin button, pill dbl-click.
 *   - handleSpeedButtonClick(ctx, speed) -- click router: single ->
 *                                          temp, double -> global.
 *
 * Everything goes through ctx (audit C2). The controller never reaches into
 * UI directly: ui.refreshButtons / refreshSlider / showNotification keep
 * the dependency arrow pointing one way (controller -> ports, never
 * controller -> ui module).
 *
 * Ported from .user.js:2263-2412 with the inline retry loop deferred to
 * the site-bootstrap layer (Wave 1.10 attachToVideo).
 */

import type { AppContext } from '../app/context';
import { speedBoundsFor } from '../config';

const CLICK_DEBOUNCE_MS = 400;

/** Per-context click-debounce state. Keyed by AppContext so multiple
 *  initialised tabs (popup vs in-player) don't share counters. */
interface ClickState {
  count: number;
  timer: number | null;
  /** A setGlobal/setTemporary promotion is in flight; ignore re-entry until settle. */
  pending: boolean;
}
const clickState = new WeakMap<AppContext, ClickState>();

/**
 * Window in ms during which a `ratechange` event is treated as our own
 * write. The ratechange listener in src/index.ts consults the
 * `__vsSelfWriteAt` timestamp we stamp on the video element here and
 * skips its revert path when we just wrote. Without this guard a
 * click-driven setTemporary fires ratechange in the same tick → listener
 * reads stale state → reverts our brand-new write (audit C2.4).
 */
export const SELF_WRITE_GRACE_MS = 60;

/** Internal: apply + currentSpeed sync, pure of side-effects beyond the video. */
function applyToVideo(ctx: AppContext, speed: number): boolean {
  const el = ctx.discovery.resolve('video');
  if (!(el instanceof HTMLVideoElement)) {
    ctx.logger.debug('controller.applyToVideo: video not ready, deferring');
    return false;
  }
  try {
    // FEAT-013: honour the pitch preference on every write — the site
    // player can recreate/reset the element between our writes, so
    // setting it once at attach time is not enough. Browsers default
    // preservesPitch to true; only an explicit false flips it.
    try {
      el.preservesPitch = ctx.settingsStore.getKey('preservePitch') !== false;
    } catch {
      /* property is settable in all modern engines; ignore exotic ones */
    }
    // Mark the upcoming ratechange as ours. The watchdog in src/index.ts
    // checks `__vsSelfWriteAt` and skips revert when within grace window.
    (el as HTMLVideoElement & { __vsSelfWriteAt?: number }).__vsSelfWriteAt =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    el.playbackRate = speed;
    return true;
  } catch (e) {
    ctx.logger.error('controller.applyToVideo: failed to set playbackRate', e);
    return false;
  }
}

function clamp(ctx: AppContext, speed: number): number {
  const bounds = speedBoundsFor(ctx.site);
  if (!Number.isFinite(speed)) return bounds.defaultSpeed;
  // Round to 0.01 so successive `±speedStep` hotkey presses don't
  // accumulate float drift (1 + 0.1 + 0.1 + ... -> 1.7000000000000002).
  // Step granularity is configurable down to 0.01 in Settings, so we
  // can't round to 1 decimal — that would collapse two adjacent presses
  // at step=0.05 onto the same value.
  const rounded = Math.round(speed * 100) / 100;
  return Math.min(bounds.max, Math.max(bounds.min, rounded));
}

export interface ApplyOptions {
  /** Skip the centred speed popup. Used by internal correction paths
   *  (HLS cascade retry, ratechange-revert) — audit B2.6. */
  silent?: boolean;
}

/**
 * Lightweight apply: push the value to video.playbackRate and refresh UI
 * WITHOUT touching storage. Used by slider drag during continuous input
 * so we don't burn IPC / disk-IO writes on every pixel of motion. The
 * drag's final value is committed via the `change` event handler that
 * calls setTemporary() once on release.
 *
 * Self-write timestamp is still stamped (via applyToVideo) so the
 * ratechange watchdog in src/index.ts treats this as ours.
 */
export function applyTransient(ctx: AppContext, speed: number, opts: ApplyOptions = {}): void {
  const validSpeed = clamp(ctx, speed);
  applyToVideo(ctx, validSpeed);
  ctx.ui.refreshButtons(validSpeed, opts);
  ctx.ui.refreshSlider(validSpeed);
}

/**
 * One-shot speed for this video only -- single click on a speed button.
 * Doesn't touch `current`; instead stores as `smart`. Cleared automatically
 * when the next video loads or on SPA navigation.
 *
 * Persist-then-apply order (.user.js:2271-2280 parity): write smart BEFORE
 * playbackRate to suppress the ratechange-revert watchdog. Without this
 * the listener would read pickInitialSpeed = (old smart || current),
 * detect a delta, and revert to the prior value (audit A2.1).
 */
export async function setTemporary(
  ctx: AppContext,
  speed: number,
  opts: ApplyOptions = {},
): Promise<void> {
  const validSpeed = clamp(ctx, speed);
  await ctx.speedStore.setSmart(validSpeed);
  applyToVideo(ctx, validSpeed);
  ctx.ui.refreshButtons(validSpeed, opts);
  ctx.ui.refreshSlider(validSpeed);
  rememberPerContent(ctx, validSpeed);
  ctx.logger.debug('controller.setTemporary', validSpeed);
}

/** FEAT-015: record the user's explicit choice into the per-content
 *  memory map (keyed by HDRezka title / YT channel) when the feature is
 *  enabled. Fire-and-forget — losing one write is harmless. */
function rememberPerContent(ctx: AppContext, speed: number): void {
  if (ctx.settingsStore.getKey('rememberPerVideo') !== true) return;
  if (!ctx.speedStore.activeMemoryKey()) return;
  void ctx.speedStore.rememberForActive(speed);
}

/**
 * "Make this my default" -- double click on a speed button. Persists as
 * current, force-enables rememberSpeed (audit-aligned with userscript
 * semantics: a deliberate double-click is a strong signal), clears the
 * smart override, and surfaces a toast so the user knows the choice stuck.
 *
 * Order matters (matches .user.js:2296-2326): clear smart + persist BEFORE
 * touching video.playbackRate. If a ratechange-driven re-attach fires
 * between applyToVideo and setSmart(null), the old code path read stale
 * smart and re-applied the previous value.
 */
export async function setGlobal(
  ctx: AppContext,
  speed: number,
  opts: ApplyOptions = {},
): Promise<void> {
  const validSpeed = clamp(ctx, speed);

  // Force-enable rememberSpeed if it was off. Userscript parity (.user.js:2300).
  if (ctx.settingsStore.getKey('rememberSpeed') === false) {
    await ctx.settingsStore.update({ rememberSpeed: true });
    ctx.logger.info('controller.setGlobal: rememberSpeed auto-enabled');
  }

  // Persist first, then push to video. Storage writes are fire-and-forget
  // (in-memory mirror updates synchronously) so we don't actually block.
  await ctx.speedStore.setSmart(null);
  await ctx.speedStore.setCurrent(validSpeed);
  applyToVideo(ctx, validSpeed);
  ctx.ui.refreshButtons(validSpeed, opts);
  ctx.ui.refreshSlider(validSpeed);
  rememberPerContent(ctx, validSpeed);
  ctx.ui.showNotification(ctx.i18n.t('toast.speed_global', { speed: validSpeed }), 'success');
  ctx.logger.debug('controller.setGlobal', validSpeed);
}

/**
 * Click router: 1st click within debounce -> setTemporary; 2nd click ->
 * setGlobal. State is per-AppContext so each tab/popup keeps its own
 * counter.
 *
 * Audit 2026-05-09 sec C13/C14: setGlobal/setTemporary are async (storage
 * writes). The previous code reset `state.count = 0` before kicking off
 * the await, so a click arriving during the in-flight promise would
 * re-enter `handleSpeedButtonClick` with count=0 and be treated as a
 * fresh single-click — silently downgrading the just-applied global to
 * a temporary. We now mark the state as "promotion in flight" via a
 * `pending` flag and short-circuit re-entry while it's set, only
 * resetting count after the promotion settles. Promise rejections are
 * surfaced via .catch (was: `void` swallowed silent storage failures).
 */
export function handleSpeedButtonClick(ctx: AppContext, speed: number): void {
  const state = clickState.get(ctx) ?? {
    count: 0,
    timer: null as number | null,
    pending: false,
  };
  if (state.pending) {
    // A previous click is still being applied; ignore the burst until it
    // settles. The user's intent is clear from the in-flight promotion.
    return;
  }
  state.count += 1;
  if (state.timer !== null) {
    clearTimeout(state.timer);
  }
  state.timer = window.setTimeout(() => {
    const finalCount = state.count;
    state.timer = null;
    state.pending = true;
    const settle = (): void => {
      state.count = 0;
      state.pending = false;
    };
    const onError = (e: unknown): void => {
      ctx.logger.error('controller: click promotion failed', e);
      settle();
    };
    if (finalCount >= 2) {
      setGlobal(ctx, speed).then(settle, onError);
    } else {
      setTemporary(ctx, speed).then(settle, onError);
    }
  }, CLICK_DEBOUNCE_MS);
  clickState.set(ctx, state);
}

/**
 * Compute the speed to apply when a new <video> attaches.
 * Priority: smart (one-shot) -> per-content memory (FEAT-015, when
 * enabled) -> current (if rememberSpeed) -> default.
 */
export function pickInitialSpeed(ctx: AppContext): number {
  const smart = ctx.speedStore.smart();
  if (smart !== null) return smart;
  if (ctx.settingsStore.getKey('rememberPerVideo') === true) {
    const remembered = ctx.speedStore.activeMemory();
    if (remembered !== null) return remembered;
  }
  if (ctx.settingsStore.getKey('rememberSpeed') === true) {
    return ctx.speedStore.current();
  }
  return speedBoundsFor(ctx.site).defaultSpeed;
}
