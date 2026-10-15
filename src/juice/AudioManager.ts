/**
 * AudioManager (Req 18.3–18.7, 1.7). Every sound effect and the music loop are
 * synthesised at runtime with the WebAudio API, so the game ships no audio
 * files. Safe everywhere: if there is no AudioContext (Node tests, very old
 * browsers) or audio is not unlocked yet, every call is a silent no-op.
 *
 * Usage: `getAudio().play(SFX.hurt)`. Unlock happens on the window
 * 'mms-audio-unlock' event (dispatched on first interaction) or `unlock()`.
 */
import { getSession, type Settings } from '../game/Session';
import { SFX, type SfxKey } from '../game/keys';
import { RateLimiter } from './RateLimiter';

export interface PlayOptions {
  /** Frequency multiplier (1 = default pitch). */
  pitch?: number;
  /** Volume multiplier (1 = default). */
  volume?: number;
}

type AudioCtor = new () => AudioContext;

const MASTER_GAIN = 0.9;
const SFX_GAIN = 1.0;
const MUSIC_GAIN = 0.6;

const PICKUP_RESET_MS = 400;
const PICKUP_MAX_STEP = 12;

// Music: A-minor progression Am – F – Dm – E, 8 eighth notes per bar.
const MUSIC_EIGHTH_S = 0.375; // 80 bpm
// One octave above the original so small laptop/phone speakers can reproduce it.
const MUSIC_BASS = [110, 87.31, 146.83, 82.41];
const MUSIC_CHORDS = [
  [220, 261.63, 329.63, 440],
  [174.61, 220, 261.63, 349.23],
  [146.83, 174.61, 220, 293.66],
  [164.81, 207.65, 246.94, 329.63],
];
const MUSIC_ARP = [0, 1, 2, 3, 2, 1, 0, 1];

const DEFAULT_SETTINGS: Settings = { musicMuted: false, sfxMuted: false, shakeEnabled: true };

function readSettings(): Settings {
  try {
    return getSession().settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;

  private unlocked = false;
  private suspended = false;

  private readonly pickupLimiter = new RateLimiter(50);
  private pickupStep = 0;
  private lastPickupMs = -Infinity;

  private musicWanted = false;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicNextTime = 0;
  private musicStep = 0;

  constructor() {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const onUnlock = (): void => this.unlock();
      window.addEventListener('mms-audio-unlock', onUnlock);
      // Every real gesture (re)unlocks: browsers only allow starting/resuming an
      // AudioContext inside a user gesture, and the context can drop back to
      // 'suspended' (tab switches, OS audio changes). unlock() is cheap and idempotent.
      for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const) {
        window.addEventListener(type, onUnlock, { capture: true, passive: true });
      }
    }
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** Diagnostics snapshot (dev tooling). */
  debugState(): Record<string, unknown> {
    return {
      ctx: this.ctx?.state ?? 'none',
      unlocked: this.unlocked,
      suspended: this.suspended,
      masterGain: this.master?.gain.value ?? null,
      musicWanted: this.musicWanted,
      musicRunning: this.musicTimer !== null,
    };
  }

  /** Taps the master bus with an analyser (dev tooling). Returns a function giving peak dBFS since last call. */
  debugMeter(): () => number {
    const ctx = this.ctx;
    if (!ctx || !this.master) return () => -Infinity;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    this.master.connect(an);
    const buf = new Float32Array(an.fftSize);
    let peak = 0;
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    }, 20);
    void timer;
    return () => {
      const p = peak;
      peak = 0;
      return p > 0 ? 20 * Math.log10(p) : -Infinity;
    };
  }

  /** Creates / resumes the AudioContext. Must be called from a user gesture. Idempotent. */
  unlock(): void {
    try {
      if (!this.ctx) {
        if (typeof window === 'undefined') return;
        const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.buildGraph(this.ctx);
      }
      if (this.ctx.state !== 'running' && !this.suspended) void this.ctx.resume().catch(() => undefined);
      if (this.unlocked) return;
      this.unlocked = true;
      try {
        getSession().audioUnlocked = true;
      } catch {
        // No session (tests); ignore.
      }
      this.applySettings();
    } catch {
      // Audio is optional; never break the game.
    }
  }

  /** Plays a synthesised sound effect. No-op when muted, locked, suspended or unsupported. */
  play(key: SfxKey, opts?: PlayOptions): void {
    try {
      const ctx = this.ctx;
      const bus = this.sfxBus;
      if (!ctx || !bus || !this.unlocked || this.suspended) return;
      if (readSettings().sfxMuted) return;
      let pitch = opts?.pitch ?? 1;
      const vol = opts?.volume ?? 1;
      if (!Number.isFinite(pitch) || pitch <= 0) pitch = 1;
      if (!Number.isFinite(vol) || vol <= 0) return;
      const t = ctx.currentTime + 0.005;

      switch (key) {
        case SFX.hurt:
          this.tone(ctx, bus, 'square', 330 * pitch, 110 * pitch, t, 0.18, 0.35 * vol);
          this.noiseBurst(ctx, bus, t, 0.14, 0.5 * vol, 2200);
          break;
        case SFX.levelUp: {
          const notes = [523.25, 659.25, 783.99, 1046.5];
          for (let i = 0; i < notes.length; i++) {
            const f = notes[i] * pitch;
            this.tone(ctx, bus, 'triangle', f, f, t + i * 0.08, 0.2, 0.45 * vol);
            this.tone(ctx, bus, 'square', f * 2, f * 2, t + i * 0.08, 0.08, 0.1 * vol);
          }
          break;
        }
        case SFX.pickup: {
          const now = nowMs();
          if (!this.pickupLimiter.tryAcquire(now)) return;
          this.pickupStep = now - this.lastPickupMs > PICKUP_RESET_MS ? 0 : Math.min(this.pickupStep + 1, PICKUP_MAX_STEP);
          this.lastPickupMs = now;
          const f = 880 * pitch * Math.pow(2, this.pickupStep / 12);
          this.tone(ctx, bus, 'triangle', f, f * 1.5, t, 0.08, 0.35 * vol);
          break;
        }
        case SFX.merge:
          this.wobble(ctx, bus, t, pitch, vol);
          break;
        case SFX.mutation:
          this.swell(ctx, bus, t, pitch, vol);
          break;
        case SFX.kill:
          this.tone(ctx, bus, 'triangle', 620 * pitch, 220 * pitch, t, 0.07, 0.28 * vol);
          this.noiseBurst(ctx, bus, t, 0.04, 0.15 * vol, 4000);
          break;
        case SFX.click:
          this.tone(ctx, bus, 'square', 1100 * pitch, 900 * pitch, t, 0.04, 0.18 * vol);
          break;
      }
    } catch {
      // Never throw from audio.
    }
  }

  /** Starts the procedural music loop (honours settings.musicMuted). */
  startMusic(): void {
    this.musicWanted = true;
    this.applySettings();
  }

  stopMusic(): void {
    this.musicWanted = false;
    this.stopScheduler();
  }

  /** Re-reads session settings (call after toggling mute options). */
  applySettings(): void {
    try {
      const s = readSettings();
      if (this.musicWanted && !s.musicMuted) this.startScheduler();
      else this.stopScheduler();
    } catch {
      // ignore
    }
  }

  /** Mutes everything while the game is auto-paused / backgrounded (Req 1.7). */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    try {
      const ctx = this.ctx;
      if (!ctx || !this.master) return;
      const t = ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(suspended ? 0 : MASTER_GAIN, t, 0.03);
      if (suspended) {
        void ctx.suspend().catch(() => undefined);
      } else if (this.unlocked) {
        void ctx.resume().catch(() => undefined);
        this.musicNextTime = 0; // re-anchor music scheduling
      }
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------- internals

  private buildGraph(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = this.suspended ? 0 : MASTER_GAIN;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = SFX_GAIN;
    this.sfxBus.connect(this.master);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 2400;
    this.musicFilter.Q.value = 2;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = MUSIC_GAIN;
    this.musicFilter.connect(this.musicBus);
    this.musicBus.connect(this.master);

    // One second of white noise, reused by every noise burst.
    const len = Math.floor(ctx.sampleRate);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Oscillator with an exponential pitch glide and a quick attack/decay envelope. */
  private tone(
    ctx: AudioContext,
    dest: AudioNode,
    type: OscillatorType,
    f0: number,
    f1: number,
    t: number,
    dur: number,
    gain: number,
  ): void {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.01, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(ctx: AudioContext, dest: AudioNode, t: number, dur: number, gain: number, cutoff: number): void {
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Merge: a wobbly, squelchy downward saw through a lowpass. */
  private wobble(ctx: AudioContext, dest: AudioNode, t: number, pitch: number, vol: number): void {
    const dur = 0.32;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(90 * pitch, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 16;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 40 * pitch;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 8;
    filter.frequency.setValueAtTime(1600, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(g);
    g.connect(dest);
    osc.onended = () => {
      osc.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      filter.disconnect();
      g.disconnect();
    };
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
  }

  /** Mutation: a big detuned rising swell with an opening filter and a noise wash. */
  private swell(ctx: AudioContext, dest: AudioNode, t: number, pitch: number, vol: number): void {
    const dur = 1.0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(250, t);
    filter.frequency.exponentialRampToValueAtTime(3500, t + dur * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    filter.connect(g);
    g.connect(dest);
    const detunes = [-12, 0, 7];
    let remaining = detunes.length;
    for (const d of detunes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = d * 100 + (Math.random() * 10 - 5);
      osc.frequency.setValueAtTime(110 * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(440 * pitch, t + dur * 0.8);
      osc.connect(filter);
      osc.onended = () => {
        osc.disconnect();
        if (--remaining === 0) {
          filter.disconnect();
          g.disconnect();
        }
      };
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    this.noiseBurst(ctx, dest, t + dur * 0.55, 0.4, 0.12 * vol, 5000);
  }

  private startScheduler(): void {
    if (this.musicTimer !== null || !this.ctx || !this.musicFilter || !this.unlocked) return;
    this.musicNextTime = 0;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 100);
    this.scheduleMusic();
  }

  private stopScheduler(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private scheduleMusic(): void {
    try {
      const ctx = this.ctx;
      const dest = this.musicFilter;
      if (!ctx || !dest || this.suspended || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (this.musicNextTime < now) this.musicNextTime = now + 0.05;
      while (this.musicNextTime < now + 0.4) {
        const t = this.musicNextTime;
        const bar = Math.floor(this.musicStep / 8) % MUSIC_BASS.length;
        const eighth = this.musicStep % 8;
        if (eighth === 0 || eighth === 4) {
          const b = MUSIC_BASS[bar];
          this.tone(ctx, dest, 'sawtooth', b, b, t, MUSIC_EIGHTH_S * 3.5, 0.3);
          this.tone(ctx, dest, 'triangle', b * 2, b * 2, t, MUSIC_EIGHTH_S * 2, 0.25);
        }
        const f = MUSIC_CHORDS[bar][MUSIC_ARP[eighth]];
        this.tone(ctx, dest, 'triangle', f * 2, f * 2, t, MUSIC_EIGHTH_S * 0.9, 0.3);
        // Occasional eerie high echo for atmosphere.
        if (eighth === 6 && bar % 2 === 1) this.tone(ctx, dest, 'sine', f * 4, f * 3.96, t, MUSIC_EIGHTH_S * 2, 0.12);
        this.musicNextTime += MUSIC_EIGHTH_S;
        this.musicStep = (this.musicStep + 1) % (8 * MUSIC_BASS.length);
      }
    } catch {
      // ignore
    }
  }
}

let instance: AudioManager | null = null;

/** Process-wide AudioManager singleton. */
export function getAudio(): AudioManager {
  if (!instance) {
    instance = new AudioManager();
    // Dev-only handle for diagnosing audio from the console / smoke tests.
    if (import.meta.env?.DEV && typeof window !== 'undefined') {
      (window as unknown as { __mmsAudio?: AudioManager }).__mmsAudio = instance;
    }
  }
  return instance;
}
