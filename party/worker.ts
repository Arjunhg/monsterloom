/**
 * Duel Night relay on PartyServer (own Cloudflare account, anonymous).
 * Same wire protocol as src/duel/protocol.ts; room id IS the join code.
 * Binding is named "Main" so clients keep using /parties/main/<code>.
 */
import { Server, routePartykitRequest, type Connection, type ConnectionContext } from 'partyserver';

interface Env {
  Main: DurableObjectNamespace;
}

interface Final {
  victory: boolean;
  elapsed: number;
  kills: number;
  score: number;
}

export class DuelServer extends Server<Env> {
  private phase: 'lobby' | 'playing' | 'done' = 'lobby';
  private readonly ready = new Set<string>();
  private readonly finals = new Map<string, Final>();
  private readonly names = new Map<string, string>();

  onConnect(conn: Connection, ctx: ConnectionContext): void {
    const url = new URL(ctx.request.url);
    const name = (url.searchParams.get('name') || `Monster-${conn.id.slice(0, 4).toUpperCase()}`).slice(0, 20);
    this.names.set(conn.id, name);
    if ([...this.getConnections()].length > 2) {
      conn.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
      conn.close();
      return;
    }
    this.broadcastLobby();
  }

  onClose(conn: Connection): void {
    this.names.delete(conn.id);
    this.ready.delete(conn.id);
    if (this.phase === 'playing') {
      this.broadcast(JSON.stringify({ type: 'rivalLeft' }));
      const remaining = [...this.getConnections()][0];
      this.phase = 'done';
      this.broadcast(JSON.stringify({ type: 'result', winnerId: remaining?.id ?? null, forfeit: true }));
    } else {
      this.broadcastLobby();
    }
  }

  onMessage(sender: Connection, message: string): void {
    let payload: { type?: string; progress?: unknown; final?: Final };
    try {
      payload = JSON.parse(message) as typeof payload;
    } catch {
      return;
    }
    const others = [...this.getConnections()].filter((c) => c.id !== sender.id);
    switch (payload.type) {
      case 'ready': {
        if (this.phase !== 'lobby') return;
        this.ready.add(sender.id);
        this.broadcastLobby();
        const count = [...this.getConnections()].length;
        if (count >= 2 && this.ready.size >= 2) {
          this.phase = 'playing';
          const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
          this.broadcast(JSON.stringify({ type: 'start', seed }));
        }
        break;
      }
      case 'progress': {
        if (this.phase !== 'playing') return;
        for (const c of others) c.send(JSON.stringify({ type: 'rival', progress: payload.progress }));
        break;
      }
      case 'finished': {
        if (this.phase !== 'playing' || !payload.final) return;
        this.finals.set(sender.id, payload.final);
        for (const c of others) c.send(JSON.stringify({ type: 'rivalFinished', final: payload.final }));
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
            } else if (f.score === best) tie = true;
          }
          this.broadcast(JSON.stringify({ type: 'result', winnerId: tie ? null : winnerId, forfeit: false }));
        }
        break;
      }
      default:
        break;
    }
  }

  private broadcastLobby(): void {
    const players = [...this.getConnections()].map((c) => ({
      id: c.id,
      username: this.names.get(c.id) ?? 'Monster',
      ready: this.ready.has(c.id),
    }));
    for (const c of this.getConnections()) {
      c.send(JSON.stringify({ type: 'lobby', youId: c.id, players }));
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await routePartykitRequest(request, env)) || new Response('Not found', { status: 404 });
  },
};
