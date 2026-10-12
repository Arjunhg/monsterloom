/** Small allocation-free math helpers for the simulation. */

export interface MutVec2 {
  x: number;
  y: number;
}

export function isFiniteNum(n: number): boolean {
  return Number.isFinite(n);
}

/** Writes the unit vector of (x, y) into `out`. Zero-length or non-finite input yields (0, 0). */
export function safeNormalize(x: number, y: number, out: MutVec2): MutVec2 {
  const len = Math.hypot(x, y);
  if (!(len > 0) || !Number.isFinite(len)) {
    out.x = 0;
    out.y = 0;
  } else {
    out.x = x / len;
    out.y = y / len;
  }
  return out;
}

/** Squared distance between two points. */
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
