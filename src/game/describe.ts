/**
 * One-line upgrade descriptions (Req 9.5). Pure, no Phaser import, so it can
 * be unit tested.
 */
import type { AbilityKind, AbilityParams, BodyPartDef } from '../data/bodyParts';

/** Text used when two levels have no visible parameter difference. */
export const DESCRIBE_FALLBACK = 'Stronger';

/** Max number of changes listed so the line stays short. */
const MAX_CHANGES = 3;

const MINUS = '\u2212';

/** Noun for `count` changes, per part id first, then per ability kind. */
const COUNT_NOUN_BY_PART: Record<string, [string, string]> = {
  extra_eye: ['eye', 'eyes'],
  ribcage: ['bone', 'bones'],
  fangs: ['fang', 'fangs'],
};
const COUNT_NOUN_BY_KIND: Record<AbilityKind, [string, string]> = {
  projectile: ['shot', 'shots'],
  piercing: ['dart', 'darts'],
  grab: ['grab', 'grabs'],
  dash: ['dash', 'dashes'],
  orbital: ['orbiter', 'orbiters'],
  aoe: ['pulse', 'pulses'],
};

/** Order in which changes are listed (most noticeable first). */
const FIELD_ORDER: readonly (keyof AbilityParams)[] = [
  'count',
  'lingering',
  'damage',
  'cooldown',
  'pierce',
  'radius',
  'range',
  'distance',
  'slow',
  'duration',
  'spread',
  'speed',
];

/** Rounds to 2 decimals and drops trailing zeros (0.0999… → "0.1"). */
function fmt(n: number): string {
  return String(Math.round(Math.abs(n) * 100) / 100);
}

function signed(d: number, text: string): string {
  return `${d > 0 ? '+' : MINUS}${text}`;
}

function describeField(def: BodyPartDef, key: keyof AbilityParams, d: number, toValue: number): string {
  switch (key) {
    case 'count': {
      const [one, many] = COUNT_NOUN_BY_PART[def.id] ?? COUNT_NOUN_BY_KIND[def.ability] ?? ['shot', 'shots'];
      return signed(d, `${fmt(d)} ${Math.abs(d) === 1 ? one : many}`);
    }
    case 'lingering':
      return toValue > 0 ? (def.ability === 'dash' ? 'leaves a trail' : 'leaves a puddle') : 'no lingering';
    case 'damage':
      return signed(d, `${fmt(d)} damage`);
    case 'cooldown':
      return signed(d, `${fmt(d)} s cooldown`);
    case 'pierce':
      return signed(d, `${fmt(d)} pierce`);
    case 'radius':
      return signed(d, `${fmt(d)} radius`);
    case 'range':
      return signed(d, `${fmt(d)} range`);
    case 'distance':
      return signed(d, `${fmt(d)} dash distance`);
    case 'slow':
      return signed(d, `${fmt(d * 100)}% slow`);
    case 'duration':
      return signed(d, `${fmt(d)} s duration`);
    case 'spread':
      return signed(d, `${fmt(d)}\u00b0 spread`);
    case 'speed':
      return signed(d, `${fmt(d)} speed`);
  }
}

/**
 * Describes the parameter diff between Part_Level `from` and `to`
 * (1-based; levels[from-1] → levels[to-1]), e.g. "+1 eye, −0.2 s cooldown".
 * `from` ≤ 0 (a new part) returns the part's description. Missing levels or
 * no visible difference return {@link DESCRIBE_FALLBACK}.
 */
export function describeLevelUp(def: BodyPartDef, from: number, to: number): string {
  if (from <= 0) return def.description;
  const a = def.levels[from - 1];
  const b = def.levels[to - 1];
  if (!a || !b) return DESCRIBE_FALLBACK;
  const parts: string[] = [];
  for (const key of FIELD_ORDER) {
    const va = a[key] ?? 0;
    const vb = b[key] ?? 0;
    const d = vb - va;
    if (!Number.isFinite(d) || Math.abs(d) < 1e-6) continue;
    parts.push(describeField(def, key, d, vb));
    if (parts.length >= MAX_CHANGES) break;
  }
  return parts.length > 0 ? parts.join(', ') : DESCRIBE_FALLBACK;
}
