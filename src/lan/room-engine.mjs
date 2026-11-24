export const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const MAX_PLAYERS = 2;
const MIN_PLAYERS = 2;
const TARGET = 1000;
const COUNTDOWN_MS = 3000;
const RACE_MS = 180_000;
const PAINTS = ['blue', 'orange', 'pink', 'lime'];

export function driverName(name) {
  return typeof name === 'string' ? Array.from(name.trim().replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 24).join('') : '';
}

function readPose(pose) {
  if (!pose || ![pose.x, pose.y, pose.angle].every(Number.isFinite)) return null;
  if (Math.abs(pose.x) > TARGET + 50 || Math.abs(pose.y) > 300 || Math.abs(pose.angle) > 10_000) return null;
  return { x: pose.x, y: pose.y, angle: pose.angle };
}

function readDrive(message) {
  if (!Number.isFinite(message.distance) || message.distance < 0 || !Array.isArray(message.wheels) ||
      message.wheels.length !== 2 || typeof message.crashed !== 'boolean') return null;
  const car = readPose(message.car);
  const wheels = message.wheels.map(readPose);
  if (!car || wheels.some(wheel => !wheel)) return null;
  return { distance: Math.min(TARGET, message.distance), car, wheels, crashed: message.crashed };
}

export class RaceRoom {
  #players = new Map();
  #phase = 'lobby';
  #round = 0;
  #startsAt = 0;
  #endsAt = 0;
  #winner = null;
  #dirty = false;

  constructor(code, host, onUpdate) {
    this.code = code;
    this.host = host;
    this.onUpdate = onUpdate;
  }

  get empty() { return ![...this.#players.values()].some(player => player.connected); }

  snapshot(now) {
    return {
      type: 'room', code: this.code, host: this.host, phase: this.#phase, round: this.#round,
      serverTime: now, startsAt: this.#startsAt, endsAt: this.#endsAt, target: TARGET, winner: this.#winner,
      players: [...this.#players.values()].map(({ id, name, paint, drive, connected }) => ({
        id, name, paint, drive, connected,
      })),
    };
  }

  #publish(now) {
    this.#dirty = false;
    this.onUpdate(this.snapshot(now));
  }

  join(id, name, now) {
    if (this.#phase !== 'lobby') return 'closed';
    if (this.#players.size >= MAX_PLAYERS) return 'full';
    const used = new Set([...this.#players.values()].map(member => member.paint));
    const paint = PAINTS.find(color => !used.has(color));
    this.#players.set(id, { id, name, paint, drive: null, connected: true, lastDriveAt: -Infinity });
    this.#publish(now);
    return null;
  }

  #finish(now, winner) {
    const standing = [...this.#players.values()].filter(player => player.connected)
      .sort((a, b) => (b.drive?.distance ?? 0) - (a.drive?.distance ?? 0));
    const [first, second] = standing;
    const tied = second && (first.drive?.distance ?? 0) === (second.drive?.distance ?? 0);
    this.#winner = winner ?? (tied ? null : first?.id ?? null);
    this.#phase = 'results';
    this.#publish(now);
  }

  leave(id, now) {
    const player = this.#players.get(id);
    if (!player?.connected) return;
    player.connected = false;
    if (this.#phase === 'lobby' || this.#phase === 'countdown') this.#players.delete(id);
    const remaining = [...this.#players.values()].filter(member => member.connected);
    if (!remaining.length) return;
    if (this.host === id) this.host = remaining[0].id;
    if (this.#phase === 'countdown') this.#phase = 'lobby';
    if (this.#phase === 'racing' && (remaining.length < MIN_PLAYERS ||
        remaining.every(member => member.drive?.crashed))) {
      this.#finish(now, remaining.length === 1 ? remaining[0].id : undefined);
    } else {
      this.#publish(now);
    }
  }

  receive(id, message, now) {
    const player = this.#players.get(id);
    if (!player?.connected || !message || typeof message !== 'object') return;
    if (message.type === 'start' && id === this.host && this.#phase === 'lobby' &&
        this.#players.size >= MIN_PLAYERS) {
      this.#round++;
      this.#phase = 'countdown';
      this.#startsAt = now + COUNTDOWN_MS;
      this.#endsAt = this.#startsAt + RACE_MS;
      for (const member of this.#players.values()) member.lastDriveAt = -Infinity;
      this.#publish(now);
    } else if (message.type === 'rematch' && id === this.host && this.#phase === 'results') {
      this.#phase = 'lobby';
      this.#winner = null;
      for (const [memberId, member] of this.#players) {
        if (member.connected) member.drive = null;
        else this.#players.delete(memberId);
      }
      this.#publish(now);
    } else if (message.type === 'drive' && message.round === this.#round && this.#phase === 'racing' &&
        !player.drive?.crashed && (message.crashed === true || now - player.lastDriveAt >= 25)) {
      const drive = readDrive(message);
      if (!drive) return;
      player.lastDriveAt = now;
      drive.distance = Math.max(drive.distance, player.drive?.distance ?? 0);
      player.drive = drive;
      this.#dirty = true;
      if (drive.distance >= TARGET) this.#finish(now, id);
      else if ([...this.#players.values()].every(member => !member.connected || member.drive?.crashed)) this.#finish(now);
    }
  }

  tick(now) {
    if (this.#phase === 'countdown' && now >= this.#startsAt) {
      this.#phase = 'racing';
      this.#publish(now);
    } else if (this.#phase === 'racing' && now >= this.#endsAt) {
      this.#finish(now);
    } else if (this.#dirty) this.#publish(now);
  }
}
