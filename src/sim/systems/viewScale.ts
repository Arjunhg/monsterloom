/**
 * Pure helpers that scale simulation tuning with the live view size (ctx.view).
 *
 * The presentation layer mutates ctx.view every frame to the current camera size
 * (world px). The default 720×1560 portrait view yields scale factors of exactly 1,
 * so headless runs and tests behave as before.
 */
import { viewDensityScale, type Balance } from '../../data/balance';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../SimContext';

export { viewDensityScale };

export interface ViewSize {
  width: number;
  height: number;
}

const BASE_DIAGONAL = Math.hypot(VIEW_WIDTH, VIEW_HEIGHT);

/**
 * Active-enemy cap for the director/swarms at density `scale`:
 * min(maxActiveWide, round(maxActive × scale)); exactly maxActive at scale ≤ 1.
 */
export function effectiveMaxActiveFor(scale: number, cfg: Balance): number {
  const { maxActive, maxActiveWide } = cfg.spawn;
  if (!(scale > 1)) return maxActive;
  return Math.max(maxActive, Math.min(maxActiveWide, Math.round(maxActive * scale)));
}

/** Active-enemy cap for the given view (see effectiveMaxActiveFor). */
export function effectiveMaxActive(view: ViewSize, cfg: Balance): number {
  return effectiveMaxActiveFor(viewDensityScale(view, cfg), cfg);
}

/** Distance multiplier for view-relative ranges: max(1, view diagonal / portrait diagonal). */
export function viewDistanceScale(view: ViewSize): number {
  const k = Math.hypot(view.width, view.height) / BASE_DIAGONAL;
  return k > 1 ? k : 1;
}
