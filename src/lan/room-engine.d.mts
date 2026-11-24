import type { LanError, LanRoom } from './protocol';

export const ROOM_ALPHABET: string;
export const MAX_PLAYERS: number;
export function driverName(name: unknown): string;

export class RaceRoom {
  readonly code: string;
  readonly empty: boolean;
  constructor(code: string, host: number, onUpdate: (room: LanRoom) => void);
  snapshot(now: number): LanRoom;
  join(id: number, name: string, now: number): LanError | null;
  leave(id: number, now: number): void;
  receive(id: number, message: unknown, now: number): void;
  tick(now: number): void;
}
