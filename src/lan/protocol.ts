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

export interface OnlinePlayer { id: number; name: string; room: string; phase: string }
export type ServerMessage = LanRoom | { type: 'hello'; id: number } |
  { type: 'presence'; players: OnlinePlayer[] } |
  { type: 'invitation'; room: string; host: number; name: string } |
  { type: 'notice'; code: string } |
  { type: 'drive'; id: number; round: number; drive: DriveState };
export type ClientMessage = { type: 'identify'; name: string } |
  { type: 'invite'; target: number } | { type: 'join'; room: string } | { type: 'configure'; distanceGoal: number } | { type: 'accept' | 'decline'; room: string } |
  { type: 'start' | 'rematch' | 'leave' } | ({ type: 'drive'; round: number } & DriveState);
