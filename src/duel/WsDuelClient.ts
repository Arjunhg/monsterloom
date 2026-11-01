/**
 * WsDuelClient: Duel Night over a plain PartyKit WebSocket (anonymous —
 * for non-RUN hosting such as Vercel, where no RUN account/session exists).
 * Same DuelProtocol messages as the RUN realtime transport; the room code
 * is the PartyKit room id.
 */
import type { DuelFinal, DuelLike, DuelLobbyPlayer, DuelPhase, DuelProgress, DuelProtocol } from './protocol';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}

export class WsDuelClient implements DuelLike {
  phase: DuelPhase = 'idle';
  roomCode = '';
  youId = '';
  players: DuelLobbyPlayer[] = [];
  rival: DuelProgress | null = null;
  rivalFinal: DuelFinal | null = null;
  verdict: 'win' | 'lose' | 'draw' | null = null;
  forfeit = false;
  rivalLeft = false;
  error = '';

  private ws: WebSocket | null = null;
  private seed: number | null = null;
  private startWaiters: Array<(seed: number) => void> = [];

  constructor(private readonly baseUrl: string) {}

  async create(): Promise<boolean> {
    return this.connect(randomCode());
  }

  async join(code: string): Promise<boolean> {
    return this.connect(code.trim().toUpperCase());
  }

  private connect(code: string): Promise<boolean> {
    this.leave();
    this.phase = 'connecting';
    this.error = '';
    this.roomCode = code;
    const url = `${this.baseUrl.replace(/\/$/, '')}/parties/main/${encodeURIComponent(code)}`;
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      try {
        const ws = new WebSocket(url);
        this.ws = ws;
        const timer = window.setTimeout(() => {
          if (this.phase === 'connecting') {
            this.phase = 'error';
            this.error = 'Connection timed out';
            done(false);
          }
        }, 10_000);
        ws.onopen = () => {
          window.clearTimeout(timer);
          this.phase = 'lobby';
          done(true);
        };
        ws.onmessage = (ev) => {
          try {
            this.handle(JSON.parse(String(ev.data)) as DuelProtocol);
          } catch {
            // ignore malformed frames
          }
        };
        ws.onerror = () => {
          window.clearTimeout(timer);
          if (this.phase === 'connecting' || this.phase === 'lobby') {
            this.phase = 'error';
            this.error = 'Could not reach the duel server';
          }
          done(false);
        };
        ws.onclose = () => {
          window.clearTimeout(timer);
          if (this.phase === 'lobby') {
            this.phase = 'error';
            this.error = 'Disconnected from the room';
          }
          done(false);
        };
      } catch (err) {
        this.phase = 'error';
        this.error = err instanceof Error ? err.message : String(err);
        done(false);
      }
    });
  }

  private handle(msg: DuelProtocol): void {
    switch (msg.type) {
      case 'lobby':
        this.youId = msg.youId;
        this.players = msg.players;
        break;
      case 'start':
        this.seed = msg.seed;
        this.phase = 'playing';
        for (const w of this.startWaiters.splice(0)) w(msg.seed);
        break;
      case 'rival':
        this.rival = msg.progress;
        break;
      case 'rivalFinished':
        this.rivalFinal = msg.final;
        break;
      case 'rivalLeft':
        this.rivalLeft = true;
        break;
      case 'result':
        this.forfeit = msg.forfeit;
        this.verdict = msg.winnerId === null ? 'draw' : msg.winnerId === this.youId ? 'win' : 'lose';
        this.phase = 'done';
        break;
      default:
        break;
    }
  }

  whenStarted(): Promise<number> {
    if (this.seed !== null) return Promise.resolve(this.seed);
    return new Promise((resolve) => this.startWaiters.push(resolve));
  }

  ready(): void {
    this.send({ type: 'ready' });
  }

  sendProgress(progress: DuelProgress): void {
    if (this.phase === 'playing') this.send({ type: 'progress', progress });
  }

  sendFinished(final: DuelFinal): void {
    this.send({ type: 'finished', final });
  }

  private send(msg: DuelProtocol): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  get rivalName(): string {
    return this.players.find((p) => p.id !== this.youId)?.username ?? 'Rival';
  }

  leave(): void {
    try {
      this.ws?.close();
    } catch {
      // already gone
    }
    this.ws = null;
    this.phase = 'idle';
    this.roomCode = '';
    this.players = [];
    this.seed = null;
    this.rival = null;
    this.rivalFinal = null;
    this.verdict = null;
    this.forfeit = false;
    this.rivalLeft = false;
    this.startWaiters = [];
  }
}
