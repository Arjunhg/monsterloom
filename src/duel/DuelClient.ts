/**
 * DuelClient: browser side of Duel Night (ghost-race multiplayer).
 * Wraps RundotGameAPI.realtime rooms into a plain mutable state object that
 * scenes poll each frame — no Phaser types leak in here.
 */
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import {
  DUEL_ROOM_TYPE,
  type DuelFinal,
  type DuelProgress,
  type DuelProtocol,
} from './protocol';

export type DuelPhase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'done' | 'error';

export interface DuelLobbyPlayer {
  id: string;
  username: string;
  ready: boolean;
}

export class DuelClient {
  phase: DuelPhase = 'idle';
  roomCode = '';
  youId = '';
  players: DuelLobbyPlayer[] = [];
  seed: number | null = null;
  rival: DuelProgress | null = null;
  rivalFinal: DuelFinal | null = null;
  /** 'win' | 'lose' | 'draw' once the server declares a result. */
  verdict: 'win' | 'lose' | 'draw' | null = null;
  forfeit = false;
  rivalLeft = false;
  error = '';

  private room: Awaited<ReturnType<typeof RundotGameAPI.realtime.createRoom<DuelProtocol>>> | null = null;
  private startWaiters: Array<(seed: number) => void> = [];

  async create(): Promise<boolean> {
    return this.connect(() => RundotGameAPI.realtime.createRoom<DuelProtocol>(DUEL_ROOM_TYPE));
  }

  async join(code: string): Promise<boolean> {
    return this.connect(() => RundotGameAPI.realtime.joinRoomByCode<DuelProtocol>(code.trim().toUpperCase()));
  }

  private async connect(open: () => Promise<NonNullable<DuelClient['room']>>): Promise<boolean> {
    this.leave();
    this.phase = 'connecting';
    this.error = '';
    try {
      const room = await open();
      this.room = room;
      this.roomCode = room.roomCode;
      this.youId = room.playerId;
      const onMsg = (msg: DuelProtocol): void => this.handle(msg);
      room.on({
        onMessage: onMsg,
        onPrivateMessage: onMsg,
        onError: (e) => {
          this.error = String(e);
          if (this.phase === 'connecting' || this.phase === 'lobby') this.phase = 'error';
        },
        onDisconnect: () => {
          if (this.phase === 'lobby') {
            this.phase = 'error';
            this.error = 'Disconnected from the room';
          }
        },
      });
      this.phase = 'lobby';
      return true;
    } catch (err) {
      this.phase = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      return false;
    }
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

  /** Resolves with the duel seed once the server starts the match. */
  whenStarted(): Promise<number> {
    if (this.seed !== null) return Promise.resolve(this.seed);
    return new Promise((resolve) => this.startWaiters.push(resolve));
  }

  ready(): void {
    this.room?.send({ type: 'ready' });
  }

  sendProgress(progress: DuelProgress): void {
    if (this.phase === 'playing') this.room?.send({ type: 'progress', progress });
  }

  sendFinished(final: DuelFinal): void {
    this.room?.send({ type: 'finished', final });
  }

  get rivalName(): string {
    return this.players.find((p) => p.id !== this.youId)?.username ?? 'Rival';
  }

  leave(): void {
    try {
      this.room?.leave();
    } catch {
      // already gone
    }
    this.room = null;
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
