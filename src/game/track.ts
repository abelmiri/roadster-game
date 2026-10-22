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

const fractional = (value: number): number => value - Math.floor(value);

export function hash(seed: number): number {
  return fractional(Math.sin(seed * 127.1 + 78.233) * 43758.5453);
}

/** The same continuous curve drives the visible road and its physics collider. */
export function roadHeight(x: number): number {
  return 1.15 + 0.72 * Math.sin(x * 0.105) + 0.92 * Math.sin(x * 0.30);
}

export function roadSlope(x: number): number {
  return 0.72 * 0.105 * Math.cos(x * 0.105) + 0.92 * 0.30 * Math.cos(x * 0.30);
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
    const gap = index >= 3 && index % 5 === 4
      ? { start: start + 13.1, end: start + 17.3 + hash(index + 81) * 0.65 }
      : null;
    const hazards: HazardSpec[] = [];

    // One challenge per chunk leaves a long, visible recovery section.
    if (index >= 2 && !gap) {
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
