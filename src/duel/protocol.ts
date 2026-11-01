/**
 * Duel Night protocol: shared by the GameRoom server and the game client.
 * Type-only + constants — safe for the server bundle (no browser imports).
 */

export const DUEL_ROOM_TYPE = 'duel-night';

export interface DuelProgress {
  elapsed: number;
  kills: number;
  score: number;
  hp: number;
  maxHp: number;
  level: number;
}

export interface DuelFinal {
  victory: boolean;
  elapsed: number;
  kills: number;
  score: number;
}

// Client → server
export interface ReadyMessage {
  type: 'ready';
}
export interface ProgressMessage {
  type: 'progress';
  progress: DuelProgress;
}
export interface FinishedMessage {
  type: 'finished';
  final: DuelFinal;
}

// Server → client
export interface LobbyMessage {
  type: 'lobby';
  youId: string;
  players: Array<{ id: string; username: string; ready: boolean }>;
}
export interface StartMessage {
  type: 'start';
  seed: number;
}
export interface RivalMessage {
  type: 'rival';
  progress: DuelProgress;
}
export interface RivalFinishedMessage {
  type: 'rivalFinished';
  final: DuelFinal;
}
export interface ResultMessage {
  type: 'result';
  /** Winning player id, or null for a draw. */
  winnerId: string | null;
  forfeit: boolean;
}
export interface RivalLeftMessage {
  type: 'rivalLeft';
}

export interface DuelLobbyPlayer {
  id: string;
  username: string;
  ready: boolean;
}

export type DuelPhase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'done' | 'error';

/** Transport-agnostic duel client surface (RUN realtime or PartyKit WS). */
export interface DuelLike {
  phase: DuelPhase;
  roomCode: string;
  youId: string;
  players: DuelLobbyPlayer[];
  rival: DuelProgress | null;
  rivalFinal: DuelFinal | null;
  verdict: 'win' | 'lose' | 'draw' | null;
  forfeit: boolean;
  rivalLeft: boolean;
  error: string;
  readonly rivalName: string;
  create(): Promise<boolean>;
  join(code: string): Promise<boolean>;
  whenStarted(): Promise<number>;
  ready(): void;
  sendProgress(progress: DuelProgress): void;
  sendFinished(final: DuelFinal): void;
  leave(): void;
}

export type DuelProtocol =
  | ReadyMessage
  | ProgressMessage
  | FinishedMessage
  | LobbyMessage
  | StartMessage
  | RivalMessage
  | RivalFinishedMessage
  | ResultMessage
  | RivalLeftMessage;
