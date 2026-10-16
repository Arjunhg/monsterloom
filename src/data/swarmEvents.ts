/** Scripted swarm events (Req 23). Swarm spawns don't spend threat credits. */

export interface SwarmEventDef {
  /** Elapsed run time (s) at which the event starts. A warning shows 2 s before. */
  atSec: number;
  kind: 'ring' | 'stampede';
  /** Enemy type id spawned by the event. */
  typeId: string;
  count: number;
}

export const SWARM_EVENTS: SwarmEventDef[] = [
  { atSec: 165, kind: 'ring', typeId: 'imp', count: 26 },
  { atSec: 255, kind: 'stampede', typeId: 'shambler', count: 30 },
  { atSec: 345, kind: 'ring', typeId: 'skull_knight', count: 18 },
  { atSec: 420, kind: 'stampede', typeId: 'bat', count: 24 },
];
