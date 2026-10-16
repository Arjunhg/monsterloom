/** Mutation recipes (Req 20). */

export interface MutationRecipe {
  id: string;
  name: string;
  description: string;
  requires: { partId: string; minLevel: number }[];
  /** Parts whose sprites are hidden (abilities stay active) when the mutation is applied. */
  consumes: string[];
  abilityId: string;
  spriteKey: string;
}

export const MUTATIONS: MutationRecipe[] = [
  {
    id: 'beholder_gaze',
    name: 'Beholder Gaze',
    description: 'Your eyes and tentacle fuse into a sweeping, rotating eye beam.',
    requires: [
      { partId: 'extra_eye', minLevel: 3 },
      { partId: 'tentacle', minLevel: 1 },
    ],
    consumes: ['extra_eye', 'tentacle'],
    abilityId: 'beholder_gaze',
    spriteKey: 'mutation_beholder',
  },
  // ---- v2 ----------------------------------------------------------------
  {
    id: 'werewolf_frenzy',
    name: 'Werewolf Frenzy',
    description: 'Fangs and wings fuse: every dash ends in a howling bite shockwave.',
    requires: [
      { partId: 'fangs', minLevel: 3 },
      { partId: 'bat_wings', minLevel: 2 },
    ],
    consumes: ['fangs', 'bat_wings'],
    abilityId: 'werewolf_frenzy',
    spriteKey: 'mutation_werewolf',
  },
  {
    id: 'bone_storm',
    name: 'Bone Storm',
    description: 'Your orbiting bones periodically burst outward as a ring of shards.',
    requires: [
      { partId: 'ribcage', minLevel: 3 },
      { partId: 'blob_spit', minLevel: 3 },
    ],
    consumes: ['ribcage'],
    abilityId: 'bone_storm',
    spriteKey: 'mutation_bonestorm',
  },
  {
    id: 'bog_kraken',
    name: 'Bog Kraken',
    description: 'Toxic puddles sprout tentacles that drag enemies under.',
    requires: [
      { partId: 'swamp_gut', minLevel: 3 },
      { partId: 'tentacle', minLevel: 2 },
    ],
    consumes: ['swamp_gut'],
    abilityId: 'bog_kraken',
    spriteKey: 'mutation_bogkraken',
  },
];
