/**
 * UiPort implementation -- thin adapter the controller calls through
 * (`ctx.ui.refreshButtons`, `ctx.ui.showNotification`, etc.).
 *
 * Created by the orchestrator (Wave 1.10) AFTER the panel is built.
 * The construction order is:
 *   1. Build a stub UiPort to satisfy the AppContext interface for the
 *      panel's own internal references.
 *   2. createPanel(ctx) returns a PanelHandle that knows about the DOM.
 *   3. createUiPort({ panel }) wraps that handle into the real UiPort.
 *   4. Replace ctx.ui with the real impl (the AppContext field is
 *      `readonly`; orchestrator uses Object.assign or rebuilds).
 *
 * This keeps the dependency arrow pointing one way: ui -> ports, never
 * ports -> ui.
 */

import { showNotification } from './notifications';
import { showSpeedPopup } from './popup';
import type { PanelHandle } from './panel';
import type { NotificationKind, RefreshOptions, UiPort } from '../app/ports';

export interface CreateUiPortOptions {
  panel: PanelHandle;
  /** Player container; passed to showNotification so toasts live inside it. */
  playerContainer?: () => Element | null;
}

export function createUiPort(opts: CreateUiPortOptions): UiPort {
  const { panel } = opts;
  return {
    refreshButtons(speed: number, refreshOpts?: RefreshOptions): void {
      panel.refreshButtons(speed);
      // Skip the centred speed-popup for non-user-initiated paths (HLS
      // cascade, ratechange-revert, retry storms, YT external accept).
      // Without this gate the popup flashed up to 4× per video on start
      // (one per cascade-retry tick) — audit B2.6.
      if (!refreshOpts?.silent) {
        showSpeedPopup(speed, opts.playerContainer?.() ?? null);
      }
    },
    refreshSlider(speed: number): void {
      panel.refreshSlider(speed);
    },
    showNotification(text: string, kind?: NotificationKind): void {
      showNotification(text, {
        kind,
        playerContainer: opts.playerContainer?.() ?? null,
      });
    },
    applyLayout(): void {
      panel.applyLayout();
    },
  };
}
