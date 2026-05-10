/**
 * Shared speed-value formatter for buttons + slider tooltip + popup.
 *
 * Audit 2026-05-09 Q6: the previous slider and buttons had two distinct
 * formatters with subtly different regex shapes (slider used `\.?0+$`,
 * buttons used `0+$` after a `\.$` strip). They produced identical
 * output for our preset values today but the divergence was a
 * maintenance hazard. Single source of truth here.
 *
 * Rules:
 *   - integers render without a decimal: `2` → `"2x"`
 *   - fractions render in minimal decimal form: `1.5` → `"1.5x"`,
 *     `1.25` → `"1.25x"`
 *   - never `"1.00x"` or `"1.50x"` (visual noise)
 */
export function formatSpeed(value: number): string {
  if (!Number.isFinite(value)) return `${value}x`;
  if (Number.isInteger(value)) return `${value}x`;
  return `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}
