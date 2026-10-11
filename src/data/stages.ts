/** Spawn stages: enemy types join the pool when elapsed time crosses atSec (Req 5.5). */

export interface Stage {
  atSec: number;
  addTypes: string[];
  banner?: string;
}

export const STAGES: Stage[] = [
  { atSec: 0, addTypes: ['shambler', 'imp'] },
  { atSec: 120, addTypes: ['skull_knight'], banner: 'Skull Knights rise!' },
];
