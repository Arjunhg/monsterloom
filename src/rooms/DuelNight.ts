/**
 * Duel Night room (server): a 2-player relay + referee for the ghost-race
 * mode. The simulation itself runs on each client against the shared seed;
 * this room only seats players, deals the seed, relays live progress, and
 * declares the winner once both nights end (or on forfeit).
 */
import { GameRoom, type GameMessage, type LeaveReason, type Player } from '@series-inc/rundot-game-sdk/mp-server';
import type { DuelFinal, DuelProtocol } from '../duel/protocol';

export default class DuelNight extends GameRoom<DuelProtocol> {
  private phase: 'lobby' | 'playing' | 'done' = 'lobby';
  private readonly ready = new Set<string>();
  private readonly finals = new Map<string, DuelFinal>();

  onPlayerJoin(player: Player): void {
    this.log.info('Duel player joined', { id: player.id, count: this.playerCount });
    if (this.playerCount >= 2) this.lock();
    this.broadcastLobby();
  }

  onPlayerLeave(player: Player, reason: LeaveReason): void {
    this.log.info('Duel player left', { id: player.id, reason });
    this.ready.delete(player.id);
    if (this.phase === 'playing') {
      this.broadcast({ type: 'rivalLeft' });
      const remaining = [...this.players.keys()][0];
      this.phase = 'done';
      this.broadcast({ type: 'result', winnerId: remaining ?? null, forfeit: true });
    } else {
      this.broadcastLobby();
    }
  }

  onGameMessage(message: GameMessage<DuelProtocol>): void {
    const { sender, payload } = message;
    switch (payload.type) {
      case 'ready': {
        if (this.phase !== 'lobby') return;
        this.ready.add(sender.id);
        this.broadcastLobby();
        if (this.playerCount >= 2 && this.ready.size >= 2) {
          this.phase = 'playing';
          const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
          this.broadcast({ type: 'start', seed });
        }
        break;
      }
      case 'progress': {
        if (this.phase !== 'playing') return;
        for (const id of this.players.keys()) {
          if (id !== sender.id) this.sendTo(id, { type: 'rival', progress: payload.progress });
        }
        break;
      }
      case 'finished': {
        if (this.phase !== 'playing') return;
        this.finals.set(sender.id, payload.final);
        for (const id of this.players.keys()) {
          if (id !== sender.id) this.sendTo(id, { type: 'rivalFinished', final: payload.final });
        }
        if (this.finals.size >= 2) {
          this.phase = 'done';
          let winnerId: string | null = null;
          let best = -Infinity;
          let tie = false;
          for (const [id, f] of this.finals) {
            if (f.score > best) {
              best = f.score;
              winnerId = id;
              tie = false;
            } else if (f.score === best) {
              tie = true;
            }
          }
          this.broadcast({ type: 'result', winnerId: tie ? null : winnerId, forfeit: false });
        }
        break;
      }
      default:
        break;
    }
  }

  private broadcastLobby(): void {
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      username: p.username,
      ready: this.ready.has(p.id),
    }));
    for (const p of players) this.sendTo(p.id, { type: 'lobby', youId: p.id, players });
  }
}
