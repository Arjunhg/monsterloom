/**
 * Process-wide game session shared by every scene (task 10).
 *
 * Holds the single Sim, the PlatformService, the InputManager and session
 * settings. Scenes get it with `getSession()`; main.ts creates it with
 * `initSession(platform)` before the Phaser game starts.
 */
import type { PlatformService } from '../platform/PlatformService';
import { InputManager } from '../sim/input/InputManager';
import { Sim } from '../sim/Sim';

export interface Settings {
  musicMuted: boolean;
  sfxMuted: boolean;
  shakeEnabled: boolean;
}

export interface Session {
  readonly platform: PlatformService;
  readonly sim: Sim;
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

export function initSession(platform: PlatformService): Session {
  const flags = readFlags();
  const hasTouch =
    typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);
  session = {
    platform,
    sim: new Sim({ seed: flags.seed, assertFinite: import.meta.env.DEV }),
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
