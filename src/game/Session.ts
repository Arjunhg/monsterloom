/**
 * Process-wide game session shared by every scene (task 10).
 *
 * Holds the single Sim, the PlatformService, the InputManager and session
 * settings. Scenes get it with `getSession()`; main.ts creates it with
 * `initSession(platform)` before the Phaser game starts.
 */
import { decodeChallenge, type ChallengePayload } from '../meta/ChallengeLink';
import { DailyChallenge } from '../meta/DailyChallenge';
import { MetaProgression } from '../meta/MetaProgression';
import type { PlatformService } from '../platform/PlatformService';
import { InputManager } from '../sim/input/InputManager';
import { Sim } from '../sim/Sim';

export interface Settings {
  musicMuted: boolean;
  sfxMuted: boolean;
  shakeEnabled: boolean;
}

/** Which kind of run is (or was last) in progress. Daily runs disable meta stat bonuses. */
export type RunMode = 'normal' | 'daily-ranked' | 'daily-practice' | 'challenge';

export interface Session {
  readonly platform: PlatformService;
  readonly sim: Sim;
  /** Permanent progression (task 20); state is usable immediately (defaults until load lands). */
  readonly meta: MetaProgression;
  /** Resolves once the boot meta load finished and bonuses were applied to the Sim. */
  readonly metaReady: Promise<void>;
  /** Daily challenge state (ranked-date flag + pending score). */
  readonly daily: DailyChallenge;
  /** Resolves once the boot daily-state load finished. */
  readonly dailyReady: Promise<void>;
  /** Current run kind; set by Title/Results run starts. */
  runMode: RunMode;
  /** UTC date key of the current daily run (claimed at run start), else null. */
  dailyDate: string | null;
  /** Valid challenge payload from launch params, waiting for Title to start it. */
  pendingChallenge: ChallengePayload | null;
  /** Target score of the current challenge run, else null. */
  challengeTarget: number | null;
  /** Resolves once launch params were read and any challenge payload decoded. */
  readonly challengeReady: Promise<void>;
  readonly input: InputManager;
  /** Kept for the whole session (Req 18.6). */
  readonly settings: Settings;
  /** Dev flags from the URL: ?debug=1, ?stress=300, ?seed=123 */
  readonly flags: { debug: boolean; stress: number; seed?: number };
  /** True once the first pointer/key interaction has unlocked audio (Req 18.7). */
  audioUnlocked: boolean;
}

let session: Session | null = null;

function readFlags(): Session['flags'] {
  const q = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const stress = Number(q.get('stress') ?? 0);
  const seedRaw = q.get('seed');
  const seed = seedRaw !== null && Number.isFinite(Number(seedRaw)) ? Number(seedRaw) : undefined;
  return { debug: q.get('debug') === '1', stress: Number.isFinite(stress) ? Math.max(0, stress) : 0, seed };
}

/** Pushes the current meta bonuses into the Sim for subsequent run starts. */
export function syncMetaBonuses(s: Session): void {
  s.sim.setBonuses(s.meta.runBonuses());
}

export function initSession(platform: PlatformService): Session {
  const flags = readFlags();
  const hasTouch =
    typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);
  const sim = new Sim({ seed: flags.seed, assertFinite: import.meta.env.DEV });
  const meta = new MetaProgression(platform);
  // Load at boot without blocking game creation (Req 26.3): defaults until it
  // lands, then bonuses apply to every run started afterwards.
  const metaReady = meta
    .load()
    .then(() => {
      // Dev-only test grant: ?bones=500 (ignored in production builds).
      if (import.meta.env.DEV && typeof window !== 'undefined') {
        const bones = Number(new URLSearchParams(window.location.search).get('bones') ?? 0);
        if (Number.isFinite(bones) && bones > 0) {
          meta.grantCurrency(bones);
          platform.log(`[Session] dev grant: +${Math.floor(bones)} Bones`);
        }
      }
      sim.setBonuses(meta.runBonuses());
    })
    .catch(() => {
      // MetaProgression.load never rejects; keep the session alive regardless.
    });
  const daily = new DailyChallenge(platform);
  const dailyReady = daily
    .load()
    .then(() => undefined)
    .catch(() => {
      // DailyChallenge.load never rejects; keep the session alive regardless.
    });
  // Friend challenge (task 22): decode the `challenge` launch param. A
  // malformed payload is ignored and the title screen opens normally (28.6).
  const challengeReady = platform
    .getLaunchParams()
    .then((params) => {
      const raw = params.challenge;
      if (!raw || !session) return;
      const payload = decodeChallenge(raw);
      if (payload) session.pendingChallenge = payload;
    })
    .catch(() => {
      // Launch params are best-effort; no challenge is a normal boot.
    });
  session = {
    platform,
    sim,
    meta,
    metaReady,
    daily,
    dailyReady,
    runMode: 'normal',
    dailyDate: null,
    pendingChallenge: null,
    challengeTarget: null,
    challengeReady,
    input: new InputManager(hasTouch),
    settings: { musicMuted: false, sfxMuted: false, shakeEnabled: true },
    flags,
    audioUnlocked: false,
  };
  return session;
}

export function getSession(): Session {
  if (!session) throw new Error('Session not initialised: call initSession() in main.ts first');
  return session;
}
