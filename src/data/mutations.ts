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
];
