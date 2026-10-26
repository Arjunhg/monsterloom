/**
 * Sim: owns one RunState + SimContext and runs every system in the fixed
 * design order (design "Systems", task 8.1). Phaser-free.
 *
 * Usage (GameScene):
 *   const sim = new Sim({ assertFinite: import.meta.env.DEV });
 *   sim.setInput(v.x, v.y);           // each frame, from InputManager
 *   const alpha = sim.advance(deltaSec); // runs 0..5 fixed steps
 *   if (sim.state.paused === 'menu') open UpgradeScene
 */
import { GAME_CONFIG, viewDensityScale, type GameConfig } from '../data';
import { resetAbilityState } from './abilities/types';
import { FixedStepLoop } from './FixedStepLoop';
import { createRunState, resetRunState, type PauseKind, type RunState } from './RunState';
import { createSimContext, type SimContext, type System } from './SimContext';
import { abilitySystem } from './systems/AbilitySystem';
import { clockSystem } from './systems/ClockSystem';
import { contactSystem } from './systems/ContactSystem';
import { damageSystem } from './systems/DamageSystem';
import { enemyAISystem } from './systems/EnemyAISystem';
import { energySystem } from './systems/EnergySystem';
import { mergeSystem } from './systems/MergeSystem';
import { mutationAbilitySystem, resetAllMutationAbilities } from './systems/MutationAbilitySystem';
import { orbSystem } from './systems/OrbSystem';
import { createPlayerSystem } from './systems/PlayerSystem';
import { projectileSystem, resetProjectileHits } from './systems/ProjectileSystem';
import { separationSystem } from './systems/SeparationSystem';
import { spatialIndexSystem } from './systems/SpatialIndexSystem';
import { spawnDirector } from './systems/SpawnDirector';
import { installEliteTokenDrops, tokenSystem } from './systems/TokenSystem';
import { installV2Behaviours } from './behaviours';
import { bossSpawnSystem, installBoss } from './behaviours/boss';
import { installSwarmBehaviours } from './behaviours/swarm';
// Side-effect import: installs the mutation candidate/applier hooks into UpgradeSystem.
import './upgrades/MutationSystem';

// v2 content hooks (idempotent): bat/ghost/slime/witch steering, slime split, elite token drops.
installV2Behaviours();
installEliteTokenDrops();
installSwarmBehaviours();
installBoss();

export const SIM_STEP = 1 / 60;

export interface SimOptions {
  seed?: number;
  config?: GameConfig;
  /** Throw on non-finite player/enemy positions after each step (dev builds and tests). */
  assertFinite?: boolean;
}

/** Compact, comparable view of the run (determinism tests, debugging). */
export interface SimSnapshot {
  seed: number;
  elapsed: number;
  outcome: RunState['outcome'];
  player: { x: number; y: number; hp: number };
  kills: number;
  energy: { value: number; levelUps: number; pending: number };
  build: Array<[string, number]>;
  mutations: string[];
  enemies: Array<[number, number, number, number, number]>; // id, type, x, y, hp
  projectiles: number;
  orbs: number;
}

export class Sim {
  readonly state: RunState;
  readonly ctx: SimContext;
  readonly loop: FixedStepLoop;
  readonly assertFinite: boolean;
  /** Steps run since the current run started. */
  ticks = 0;

  private readonly input = { x: 0, y: 0 };
  private readonly systems: readonly System[];
  private readonly runStep = (dt: number) => this.step(dt);
  private readonly isPaused = () => this.state.paused !== false || this.state.outcome !== null;

  constructor(opts: SimOptions = {}) {
    this.state = createRunState(opts.seed, opts.config ?? GAME_CONFIG);
    this.ctx = createSimContext(this.state);
    this.loop = new FixedStepLoop(SIM_STEP, 5);
    this.assertFinite = opts.assertFinite ?? false;
    const input = this.input;
    this.systems = [
      clockSystem, // 1
      createPlayerSystem(() => input), // 2
      spawnDirector, // 3 (credit lanes + swarm events)
      bossSpawnSystem, // 3b (dawn boss, once per run; marks it fleeing at dawn)
      enemyAISystem, // 4
      spatialIndexSystem, // 5
      separationSystem, // 6
      mergeSystem, // 7
      abilitySystem, // 8
      mutationAbilitySystem, // 8b
      projectileSystem, // 9
      damageSystem, // 10
      contactSystem, // 11
      orbSystem, // 12
      tokenSystem, // 12b (Upgrade_Tokens from Elites)
      energySystem, // 13
    ];
  }

  /** Sets the movement vector for the next steps (|v| ≤ 1; larger is normalised by PlayerSystem). */
  setInput(x: number, y: number): void {
    this.input.x = Number.isFinite(x) ? x : 0;
    this.input.y = Number.isFinite(y) ? y : 0;
  }

  /** Advances by real elapsed seconds. Returns the render interpolation α ∈ [0, 1). */
  advance(realDeltaSec: number): number {
    return this.loop.advance(realDeltaSec, this.runStep, this.isPaused);
  }

  /** Runs exactly one fixed step regardless of the accumulator (tests). Ignored while paused/ended. */
  stepOnce(dt = SIM_STEP): void {
    if (!this.isPaused()) this.step(dt);
  }

  pause(kind: Exclude<PauseKind, false>): void {
    // Never downgrade an open upgrade menu to a plain pause.
    if (this.state.paused === 'menu' && kind !== 'menu') return;
    this.state.paused = kind;
  }

  /** Resumes a user/auto pause. A menu pause only ends via resolveLevelUp/resolveToken. */
  resume(): void {
    if (this.state.paused === 'user' || this.state.paused === 'auto') this.state.paused = false;
  }

  /** Starts a fresh run in place: every pool emptied, all per-ctx ability state cleared (Req 15.2–15.3). */
  restart(seed?: number): void {
    resetRunState(this.state, seed);
    resetAbilityState(this.ctx);
    resetProjectileHits(this.ctx);
    resetAllMutationAbilities(this.ctx);
    this.ctx.damage.clear();
    this.ctx.enemyHash.clear();
    this.loop.reset();
    this.setInput(0, 0);
    this.ticks = 0;
  }

  snapshot(): SimSnapshot {
    const s = this.state;
    const e = s.enemies;
    const enemies: SimSnapshot['enemies'] = [];
    for (let id = 0; id < e.capacity; id++) {
      if (e.isAlive(id)) enemies.push([id, e.typeId[id], e.x[id], e.y[id], e.hp[id]]);
    }
    return {
      seed: s.seed,
      elapsed: s.clock.elapsed,
      outcome: s.outcome,
      player: { x: s.player.x, y: s.player.y, hp: s.player.hp },
      kills: s.stats.kills,
      energy: { value: s.energy.value, levelUps: s.energy.levelUps, pending: s.energy.pendingLevelUps },
      build: [...s.build.parts.entries()].map(([id, p]) => [id, p.level]),
      mutations: [...s.build.mutations],
      enemies,
      projectiles: s.projectiles.count,
      orbs: s.orbs.count,
    };
  }

  private step(dt: number): void {
    const ctx = this.ctx;
    // Wide screens spawn more monsters; the player adapts by the same factor (1 on portrait).
    this.state.player.viewBoost = viewDensityScale(ctx.view, this.state.config.balance);
    // All systems run every step; each guards on `outcome` itself. A menu pause
    // set by EnergySystem (last) stops the loop before the next step.
    for (let i = 0; i < this.systems.length; i++) this.systems[i](ctx, dt);
    this.ticks++;
    if (this.assertFinite) this.checkFinite();
  }

  private checkFinite(): void {
    const s = this.state;
    const p = s.player;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.hp)) {
      throw new Error(`Sim: non-finite player state at tick ${this.ticks}`);
    }
    const e = s.enemies;
    const ids = e.pool.activeIds;
    for (let k = 0; k < e.count; k++) {
      const id = ids[k];
      if (!Number.isFinite(e.x[id]) || !Number.isFinite(e.y[id]) || !Number.isFinite(e.hp[id])) {
        throw new Error(`Sim: non-finite enemy ${id} at tick ${this.ticks}`);
      }
    }
  }
}
