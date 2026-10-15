import { describe, expect, it } from 'vitest';
import { BODY_PARTS, type AbilityParams, type BodyPartDef } from '../../src/data';
import { DESCRIBE_FALLBACK, describeLevelUp } from '../../src/game/describe';

function part(id: string): BodyPartDef {
  const def = BODY_PARTS.find((p) => p.id === id);
  if (!def) throw new Error(`missing part ${id}`);
  return def;
}

function synthetic(levels: AbilityParams[]): BodyPartDef {
  return { ...part('blob_spit'), id: 'test_part', levels };
}

describe('describeLevelUp', () => {
  it('describes a count increase with the part noun', () => {
    expect(describeLevelUp(part('extra_eye'), 1, 2)).toBe('+1 eye');
  });

  it('describes a cooldown decrease with a minus sign and rounding', () => {
    const def = synthetic([
      { damage: 10, cooldown: 1.0 },
      { damage: 10, cooldown: 0.8 },
    ]);
    expect(describeLevelUp(def, 1, 2)).toBe('\u22120.2 s cooldown');
  });

  it('lists multiple changed fields', () => {
    const text = describeLevelUp(part('blob_spit'), 2, 3);
    expect(text).toContain('+1 shot');
    expect(text).toContain('+1 damage');
    expect(text).toContain('\u22120.05 s cooldown');
    expect(text.split(', ')).toHaveLength(3);
  });

  it('caps the line at three changes', () => {
    const text = describeLevelUp(part('swamp_gut'), 2, 3);
    expect(text.split(', ').length).toBeLessThanOrEqual(3);
  });

  it('returns the fallback text when nothing changes', () => {
    const def = synthetic([
      { damage: 10, cooldown: 1 },
      { damage: 10, cooldown: 1 },
    ]);
    expect(describeLevelUp(def, 1, 2)).toBe(DESCRIBE_FALLBACK);
    expect(DESCRIBE_FALLBACK).toBe('Stronger');
  });

  it('returns the fallback for missing levels and the part description for new parts', () => {
    expect(describeLevelUp(part('fangs'), 5, 6)).toBe(DESCRIBE_FALLBACK);
    expect(describeLevelUp(part('fangs'), 0, 1)).toBe(part('fangs').description);
  });

  it('produces a non-empty line for every real level step', () => {
    for (const def of BODY_PARTS) {
      for (let l = 1; l < def.levels.length; l++) {
        const text = describeLevelUp(def, l, l + 1);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toBe(DESCRIBE_FALLBACK);
      }
    }
  });
});
