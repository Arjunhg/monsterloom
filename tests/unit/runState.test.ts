import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/data';
import { EventType } from '../../src/sim/EventBus';
import { createRunState, resetRunState } from '../../src/sim/RunState';

describe('RunState', () => {
  it('starts with only Blob Spit at level 1 and balance defaults', () => {
    const s = createRunState(42);
    expect([...s.build.parts.entries()]).toEqual([['blob_spit', { level: 1, merged: false }]]);
    expect(s.seed).toBe(42);
    expect(s.player.hp).toBe(BALANCE.player.hp);
    expect(s.clock.duration).toBe(BALANCE.run.durationSec);
    expect(s.build.rerolls).toBe(BALANCE.menu.rerolls);
    expect(s.paused).toBe(false);
    expect(s.outcome).toBeNull();
  });

  it('allocates stores with the expected capacities', () => {
    const s = createRunState(1);
    expect(s.enemies.capacity).toBe(BALANCE.spawn.maxActive + 1);
    expect(s.projectiles.capacity).toBe(600);
    expect(s.orbs.capacity).toBeGreaterThan(BALANCE.orbs.max);
    expect(s.tokens.capacity).toBeGreaterThan(0);
  });

  it('records a generated uint32 seed when none is given', () => {
    const s = createRunState();
    expect(Number.isInteger(s.seed)).toBe(true);
    expect(s.seed).toBeGreaterThanOrEqual(0);
    expect(s.seed).toBeLessThan(2 ** 32);
  });

  it('reset frees every slot, restores initial values and keeps the same typed arrays', () => {
    const s = createRunState(7);
    const enemyX = s.enemies.x;
    const orbVal = s.orbs.value;
    for (let i = 0; i < 50; i++) s.enemies.alloc();
    for (let i = 0; i < 20; i++) s.projectiles.alloc();
    for (let i = 0; i < 30; i++) s.orbs.alloc();
    s.tokens.alloc();
    s.player.hp = 3;
    s.clock.elapsed = 100;
    s.stats.kills = 77;
    s.energy.value = 12;
    s.build.parts.set('fangs', { level: 2, merged: false });
    s.build.banned.add('ribcage');
    s.events.push(EventType.levelUp, 1);
    s.paused = 'menu';

    resetRunState(s, 9);

    expect(s.enemies.count + s.projectiles.count + s.orbs.count + s.tokens.count).toBe(0);
    expect(s.enemies.x).toBe(enemyX);
    expect(s.orbs.value).toBe(orbVal);
    expect(s.seed).toBe(9);
    expect(s.player.hp).toBe(BALANCE.player.hp);
    expect(s.clock.elapsed).toBe(0);
    expect(s.stats.kills).toBe(0);
    expect(s.energy.value).toBe(0);
    expect([...s.build.parts.keys()]).toEqual(['blob_spit']);
    expect(s.build.banned.size).toBe(0);
    expect(s.events.count).toBe(0);
    expect(s.paused).toBe(false);
    expect(s.orbs.oldest()).toBe(-1);
  });

  it('orb store reports the oldest alive orb', () => {
    const s = createRunState(3);
    const a = s.orbs.alloc();
    const b = s.orbs.alloc();
    const c = s.orbs.alloc();
    expect(s.orbs.oldest()).toBe(a);
    s.orbs.free(a);
    expect(s.orbs.oldest()).toBe(b);
    s.orbs.free(b);
    const d = s.orbs.alloc(); // may reuse a freed slot, but is younger than c
    expect(s.orbs.oldest()).toBe(c);
    s.orbs.free(c);
    expect(s.orbs.oldest()).toBe(d);
  });

  it('orb age ring survives heavy churn (compaction path)', () => {
    const s = createRunState(4);
    const keep = s.orbs.alloc();
    for (let i = 0; i < 5000; i++) {
      const id = s.orbs.alloc();
      s.orbs.free(id);
    }
    expect(s.orbs.oldest()).toBe(keep);
  });
});
