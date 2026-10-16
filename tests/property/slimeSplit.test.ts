// Feature: monster-mash-survivor, Property 24: Slime split
// Validates: Requirements 22.5
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRunState } from '../../src/sim/RunState';
import { createSimContext } from '../../src/sim/SimContext';
import { spawnEnemy } from '../../src/sim/entities';
import { damageSystem } from '../../src/sim/systems/DamageSystem';
import { applySlimeSize, installV2Behaviours } from '../../src/sim/behaviours';

beforeAll(() => installV2Behaviours());

describe('Property 24: Slime split', () => {
  it('a slime killed above min size yields exactly 2 slimes of size − 1, otherwise none', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 2, max: 40 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (size, freeAfter, seed) => {
          const state = createRunState(seed);
          const ctx = createSimContext(state);
          const e = state.enemies;
          const slimeType = state.config.enemies.findIndex((t) => t.id === 'slime');
          const filler = state.config.enemies.findIndex((t) => t.id === 'shambler');

          const slime = spawnEnemy(state, slimeType, 100, 50);
          applySlimeSize(ctx, slime, size);
          // Fill the store so exactly `freeAfter` slots remain free (≥ 2).
          while (e.capacity - e.count > freeAfter) spawnEnemy(state, filler, 2000, 2000);
          const before = e.count;
          const fillerIds = new Set<number>();
          for (let k = 0; k < e.count; k++) {
            const id = e.pool.activeIds[k];
            if (id !== slime) fillerIds.add(id);
          }

          ctx.damage.push(slime, 1e9);
          damageSystem(ctx, 1 / 60);

          const minSize = 1;
          const children: number[] = [];
          for (let k = 0; k < e.count; k++) {
            const id = e.pool.activeIds[k];
            if (!fillerIds.has(id)) children.push(id);
          }
          if (size > minSize) {
            expect(children.length).toBe(2);
            for (const c of children) {
              expect(e.typeId[c]).toBe(slimeType);
              expect(e.aiState[c]).toBe(size - 1);
            }
            expect(e.count - before).toBe(1);
          } else {
            expect(children.length).toBe(0);
            expect(e.count - before).toBe(-1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
