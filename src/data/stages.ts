/**
 * Spawn stages: enemy types join the pool when elapsed time crosses atSec (Req 5.5).
 * v2: a new behaviour at least every 120 s (Req 22.2). The boss is never in a
 * stage; it spawns at duration − bossLeadSec (Req 24.1).
 */

export interface Stage {
  atSec: number;
  addTypes: string[];
  banner?: string;
}

export const STAGES: Stage[] = [
  { atSec: 0, addTypes: ['shambler', 'imp'] },
  { atSec: 60, addTypes: ['bat'], banner: 'Bats incoming! Dodge the charge' },
  { atSec: 120, addTypes: ['skull_knight'], banner: 'Skull Knights rise!' },
  { atSec: 210, addTypes: ['slime'], banner: 'Slimes split when popped' },
  { atSec: 300, addTypes: ['ghost'], banner: 'Ghosts drift through the horde' },
  { atSec: 390, addTypes: ['witch'], banner: 'Witches cast from afar' },
];
