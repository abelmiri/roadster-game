import type { BodyPose } from '../game/physics';
import type { CarPaintId } from '../game/carPaint';

export interface DriveState {
  car: BodyPose;
  wheels: [BodyPose, BodyPose];
  distance: number;
  crashed: boolean;
}

export interface RoomPlayer {
  id: number;
  name: string;
  paint: CarPaintId;
  drive: DriveState | null;
  connected: boolean;
}

export interface LanRoom {
  type: 'room';
  code: string;
  host: number;
  phase: 'lobby' | 'countdown' | 'racing' | 'results';
  round: number;
  serverTime: number;
  startsAt: number;
  endsAt: number;
  target: number;
  winner: number | null;
  players: RoomPlayer[];
}

export type LanError = 'name' | 'missing' | 'closed' | 'full';
export type ServerMessage = LanRoom | { type: 'hello'; id: number; address: string | null } | { type: 'error'; code: LanError };
export type ClientMessage = { type: 'create'; name: string } | { type: 'join'; name: string; code: string } |
  { type: 'start' | 'rematch' } | ({ type: 'drive'; round: number } & DriveState);
