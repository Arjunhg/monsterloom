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
