/**
 * Dev-only test loadouts from URL params (ignored in production builds).
 *
 *   ?mutation=werewolf_frenzy          start with that mutation (its required parts are granted at the needed levels)
 *   ?mutation=bone_storm,bog_kraken    several at once (comma-separated)
 *   ?mutation=all                      every mutation in the config
 *   ?parts=fangs:5,ribcage:3           extra parts at given levels (level defaults to 1)
 *   ?god=1                             player health stays full
 *   ?t=300                             start the night at 300 s (later stages / more enemies)
 *
 * Parts granted here may exceed balance.maxParts. That's intended for testing only.
 */
import type { RunState } from '../sim/RunState';
import { applyMutation } from '../sim/upgrades/MutationSystem';

export interface DevLoadout {
  mutations: string[];
  parts: Array<[string, number]>;
  god: boolean;
  startAt: number;
}

export function readDevLoadout(): DevLoadout | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  const mutations = (q.get('mutation') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const parts: Array<[string, number]> = [];
  for (const entry of (q.get('parts') ?? '').split(',')) {
    const [id, lv] = entry.split(':').map((s) => s.trim());
    if (id) parts.push([id, Math.max(1, Math.min(5, Number(lv) || 1))]);
  }
  const god = q.get('god') === '1';
  const startAt = Math.max(0, Number(q.get('t')) || 0);
  if (mutations.length === 0 && parts.length === 0 && !god && startAt === 0) return null;
  return { mutations, parts, god, startAt };
}

function grantPart(state: RunState, partId: string, level: number): void {
  const def = state.config.bodyParts.find((p) => p.id === partId);
  if (!def) {
    console.warn(`[devLoadout] unknown part '${partId}'. Known: ${state.config.bodyParts.map((p) => p.id).join(', ')}`);
    return;
  }
  const owned = state.build.parts.get(partId);
  const lv = Math.min(def.maxLevel, level);
  if (owned) owned.level = Math.max(owned.level, lv);
  else state.build.parts.set(partId, { level: lv, merged: false, rareBonuses: 0 });
}

/** Applies the loadout to a freshly restarted run. Call before renderers are built. */
export function applyDevLoadout(state: RunState, l: DevLoadout): void {
  for (const [id, lv] of l.parts) grantPart(state, id, lv);
  const ids = l.mutations.includes('all') ? state.config.mutations.map((m) => m.id) : l.mutations;
  for (const id of ids) {
    const recipe = state.config.mutations.find((m) => m.id === id);
    if (!recipe) {
      console.warn(`[devLoadout] unknown mutation '${id}'. Known: ${state.config.mutations.map((m) => m.id).join(', ')}`);
      continue;
    }
    for (const r of recipe.requires) grantPart(state, r.partId, r.minLevel);
    applyMutation(state, id);
  }
  if (l.startAt > 0) state.clock.elapsed = Math.min(l.startAt, state.clock.duration - 1);
  // The mutation/part events are left in the queue on purpose: the first frame's
  // drain plays the mutation effect and refreshes the HUD.
}
