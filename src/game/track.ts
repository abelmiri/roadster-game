export const CHUNK_LENGTH = 30;

export type HazardKind = 'barrier' | 'drone' | 'pulse';

export interface HazardSpec {
  id: string;
  kind: HazardKind;
  x: number;
  y: number;
  phase: number;
}

export interface TrackChunk {
  index: number;
  start: number;
  end: number;
  gap: { start: number; end: number } | null;
  hazards: HazardSpec[];
  seed: number;
}

export interface LoopSpec { id: number; entryX: number; radius: number }
const loops: LoopSpec[] = [];

/** Stable procedural spacing, including when chunks are visited out of order. */
export function loopsBetween(start: number, end: number): LoopSpec[] {
  while (!loops.length || loops[loops.length - 1].entryX < end + 30) {
    const id = loops.length;
    const previous = id ? loops[id - 1].entryX : 7;
    loops.push({ id, entryX: previous + 200 + Math.floor(hash(id + 770) * 201), radius: 5.6 + hash(id + 811) * 0.4 });
  }
  let low = 0;
  let high = loops.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (loops[mid].entryX < start) low = mid + 1;
    else high = mid;
  }
  const result: LoopSpec[] = [];
  for (let i = low; i < loops.length && loops[i].entryX <= end; i++) result.push(loops[i]);
  return result;
}

const baseHeight = (x: number): number => 1.15 + 0.72 * Math.sin(x * 0.105) + 0.92 * Math.sin(x * 0.30);
const baseSlope = (x: number): number => 0.72 * 0.105 * Math.cos(x * 0.105) + 0.92 * 0.30 * Math.cos(x * 0.30);

/** A tangent run-in keeps the circular branch and the ordinary road continuous. */
function loopRoad(x: number): { height: number; slope: number } | null {
  const loop = loopsBetween(x - 17, x + 17)[0];
  if (!loop) return null;
  const dx = x - loop.entryX;
  const a = Math.abs(dx);
  const t = Math.max(0, Math.min(1, (a - 8) / 9));
  const weight = 1 - t * t * (3 - 2 * t);
  const derivative = a <= 8 ? 0 : -6 * t * (1 - t) * Math.sign(dx) / 9;
  const line = baseHeight(loop.entryX) + baseSlope(loop.entryX) * dx;
  return { height: baseHeight(x) + weight * (line - baseHeight(x)),
    slope: baseSlope(x) + weight * (baseSlope(loop.entryX) - baseSlope(x)) + derivative * (line - baseHeight(x)) };
}

export function loopGeometry(loop: LoopSpec): { x: number; y: number; angle: number } {
  const angle = Math.atan(roadSlope(loop.entryX));
  return { x: loop.entryX - Math.sin(angle) * loop.radius,
    y: roadHeight(loop.entryX) + Math.cos(angle) * loop.radius, angle };
}

const fractional = (value: number): number => value - Math.floor(value);

export function hash(seed: number): number {
  return fractional(Math.sin(seed * 127.1 + 78.233) * 43758.5453);
}

/** The same continuous curve drives the visible road and its physics collider. */
export function roadHeight(x: number): number {
  return loopRoad(x)?.height ?? baseHeight(x);
}

export function roadSlope(x: number): number {
  return loopRoad(x)?.slope ?? baseSlope(x);
}

export function getDistrict(distance: number): number {
  return Math.max(0, distance) / 360;
}

export class TrackGenerator {
  private cache = new Map<number, TrackChunk>();

  chunk(index: number): TrackChunk {
    const existing = this.cache.get(index);
    if (existing) return existing;

    const start = index * CHUNK_LENGTH;
    const seed = hash(index + 13);
    const reserved = loopsBetween(start - 20, start + CHUNK_LENGTH + 20).length > 0;
    const gap = !reserved && index >= 3 && index % 5 === 4
      ? { start: start + 13.1, end: start + 17.3 + hash(index + 81) * 0.65 }
      : null;
    const hazards: HazardSpec[] = [];

    // One challenge per chunk leaves a long, visible recovery section.
    if (index >= 2 && !gap && !reserved) {
      const kind: HazardKind = index % 4 === 3 ? 'drone' : index % 4 === 1 ? 'pulse' : 'barrier';
      const x = start + 19 + hash(index + 27) * 2.5;
      hazards.push({
        id: `${index}-${kind}`,
        kind,
        x,
        y: roadHeight(x),
        phase: hash(index + 93) * Math.PI * 2,
      });
    }

    const chunk = { index, start, end: start + CHUNK_LENGTH, gap, hazards, seed };
    this.cache.set(index, chunk);
    return chunk;
  }

  hasRoad(x: number): boolean {
    if (x < 0) return false;
    const chunk = this.chunk(Math.floor(x / CHUNK_LENGTH));
    return !chunk.gap || x < chunk.gap.start || x > chunk.gap.end;
  }

  trim(beforeIndex: number): void {
    for (const index of this.cache.keys()) {
      if (index < beforeIndex) this.cache.delete(index);
    }
  }
}
