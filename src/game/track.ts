import type { RandomBoxSpec } from './randomBox';

export const CHUNK_LENGTH = 30;
export const START_APRON_X = -64;
export const BOX_UNLOCK_DISTANCE = 300;
export const BOX_SPAWN_KEEP_CHANCE = .8;
const BOX_UNLOCK_X = 7 + BOX_UNLOCK_DISTANCE;

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
  boxes: RandomBoxSpec[];
  seed: number;
}

export interface LoopSpec { id: number; entryX: number; radius: number }
const loops: LoopSpec[] = [];

export const RAMP_UNLOCK_DISTANCE = 800;
const RAMP_UNLOCK_X = 7 + RAMP_UNLOCK_DISTANCE;
export const RAMP_MIN_SPACING = 400;
export const RAMP_MAX_SPACING = 800;
const RAMP_RUN_UP = 24;
const RAMP_CREST = 4;
const RAMP_DESCENT = 20;
const RAMP_LENGTH = RAMP_RUN_UP + RAMP_CREST + RAMP_DESCENT;
export const RAMP_APPROACH = 12;
export const RAMP_LANDING = 110;
export const RAMP_BOOSTER_LENGTH = 5;
export interface RampSpec { id: number; start: number; end: number; takeoffX: number; boosterX: number; rise: number }
interface RampProfile extends RampSpec { baseStart: number; baseEnd: number; slopeStart: number; slopeEnd: number }
const ramps: RampProfile[] = [];

/** Stable procedural spacing, including when chunks are visited out of order. */
function ensureLoops(end: number): void {
  while (!loops.length || loops[loops.length - 1].entryX < end + 30) {
    const id = loops.length;
    const previous = id ? loops[id - 1].entryX : 7;
    let entryX = previous + 200 + Math.floor(hash(id + 770) * 201);
    const ramp = rampsBetween(entryX - RAMP_LANDING - 20, entryX + RAMP_APPROACH + 20)[0];
    if (ramp) {
      // Keep every scheduled ramp. Move the optional loop to a clear join
      // rather than skipping a ramp and exceeding its 800m spacing limit.
      const before = ramp.start - RAMP_APPROACH - 21;
      entryX = before >= previous + 200 ? before : ramp.end + RAMP_LANDING + 21;
    }
    loops.push({ id, entryX, radius: 5.6 + hash(id + 811) * 0.4 });
  }
}

function firstLoopAt(start: number): number {
  let low = 0;
  let high = loops.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (loops[mid].entryX < start) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function loopsBetween(start: number, end: number): LoopSpec[] {
  ensureLoops(end);
  const low = firstLoopAt(start);
  const result: LoopSpec[] = [];
  for (let i = low; i < loops.length && loops[i].entryX <= end; i++) result.push(loops[i]);
  return result;
}

function ensureRamps(end: number): void {
  if (end < RAMP_UNLOCK_X + RAMP_MIN_SPACING) return;
  while (!ramps.length || ramps[ramps.length - 1].start <= end) {
    const id = ramps.length;
    const previous = id ? ramps[id - 1].start : RAMP_UNLOCK_X;
    const start = previous + RAMP_MIN_SPACING + Math.floor(hash(id + 1201) * (RAMP_MAX_SPACING - RAMP_MIN_SPACING + 1));
    const rampEnd = start + RAMP_LENGTH;
    ramps.push({ id, start, end: rampEnd, takeoffX: start + RAMP_RUN_UP, boosterX: start + RAMP_RUN_UP - 3,
      rise: 8 + hash(id + 1259) * 1.5, baseStart: baseHeight(start), baseEnd: baseHeight(rampEnd),
      slopeStart: baseSlope(start), slopeEnd: baseSlope(rampEnd) });
  }
}

function firstRampAt(start: number): number {
  let low = 0;
  let high = ramps.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ramps[mid].start < start) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function rampsBetween(start: number, end: number): RampSpec[] {
  ensureRamps(end);
  const first = firstRampAt(start - RAMP_LENGTH);
  const result: RampSpec[] = [];
  for (let i = first; i < ramps.length && ramps[i].start <= end; i++) result.push(ramps[i]);
  return result;
}

export function rampAt(x: number): RampProfile | undefined {
  if (x < RAMP_UNLOCK_X + RAMP_MIN_SPACING) return undefined;
  ensureRamps(x);
  const ramp = ramps[firstRampAt(x - RAMP_LENGTH)];
  return ramp && x >= ramp.start && x <= ramp.end ? ramp : undefined;
}

/** C1-continuous climb, short convex crest, and a gentle return to the road.
 * The tires launch naturally as the road falls away beneath their momentum. */
function sampleRamp(x: number, result: RoadSample): void {
  const ramp = rampAt(x);
  if (!ramp) return;
  const dx = x - ramp.start;
  // Smooth out the ordinary short waves beneath the ramp so they cannot kick
  // a tire into an early, uncontrolled takeoff. Match both road joins exactly.
  const u = dx / RAMP_LENGTH;
  result.height = (2 * u ** 3 - 3 * u * u + 1) * ramp.baseStart + (u ** 3 - 2 * u * u + u) * RAMP_LENGTH * ramp.slopeStart +
    (-2 * u ** 3 + 3 * u * u) * ramp.baseEnd + (u ** 3 - u * u) * RAMP_LENGTH * ramp.slopeEnd;
  result.slope = (6 * u * u - 6 * u) * (ramp.baseStart - ramp.baseEnd) / RAMP_LENGTH +
    (3 * u * u - 4 * u + 1) * ramp.slopeStart + (3 * u * u - 2 * u) * ramp.slopeEnd;
  if (dx <= RAMP_RUN_UP) {
    const t = dx / RAMP_RUN_UP;
    result.height += ramp.rise * t * t;
    result.slope += 2 * ramp.rise * t / RAMP_RUN_UP;
  } else if (dx < RAMP_RUN_UP + RAMP_CREST) {
    const t = (dx - RAMP_RUN_UP) / RAMP_CREST;
    const up = 2 * ramp.rise / RAMP_RUN_UP;
    const down = -2 * ramp.rise / RAMP_DESCENT;
    result.height += ramp.rise + RAMP_CREST * (up * (t ** 3 - 2 * t * t + t) + down * (t ** 3 - t * t));
    result.slope += up * (3 * t * t - 4 * t + 1) + down * (3 * t * t - 2 * t);
  } else {
    const t = (ramp.end - x) / RAMP_DESCENT;
    result.height += ramp.rise * t * t;
    result.slope -= 2 * ramp.rise * t / RAMP_DESCENT;
  }
}

const baseHeight = (x: number): number => 1.15 + 0.72 * Math.sin(x * 0.105) + 0.92 * Math.sin(x * 0.30);
const baseSlope = (x: number): number => 0.72 * 0.105 * Math.cos(x * 0.105) + 0.92 * 0.30 * Math.cos(x * 0.30);

export interface RoadSample { height: number; slope: number }

/** Shared allocation-free sample for suspension contacts. */
export function sampleRoad(x: number, result: RoadSample): void {
  if (x < 0) { result.height = baseHeight(0); result.slope = 0; return; }
  ensureLoops(x + 17);
  const loop = loops[firstLoopAt(x - 17)];
  const height = baseHeight(x);
  const slope = baseSlope(x);
  if (!loop || loop.entryX > x + 17) {
    result.height = height; result.slope = slope;
    sampleRamp(x, result);
    return;
  }
  const dx = x - loop.entryX;
  const a = Math.abs(dx);
  const t = Math.max(0, Math.min(1, (a - 8) / 9));
  const weight = 1 - t * t * (3 - 2 * t);
  const derivative = a <= 8 ? 0 : -6 * t * (1 - t) * Math.sign(dx) / 9;
  const entrySlope = baseSlope(loop.entryX);
  const line = baseHeight(loop.entryX) + entrySlope * dx;
  result.height = height + weight * (line - height);
  result.slope = slope + weight * (entrySlope - slope) + derivative * (line - height);
}
const roadSample: RoadSample = { height: 0, slope: 0 };

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
  sampleRoad(x, roadSample);
  return roadSample.height;
}

export function roadSlope(x: number): number {
  sampleRoad(x, roadSample);
  return roadSample.slope;
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
    const reserved = loopsBetween(start - 20, start + CHUNK_LENGTH + 20).length > 0 ||
      rampsBetween(start - RAMP_LANDING, start + CHUNK_LENGTH + RAMP_APPROACH).length > 0;
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

    const boxes: RandomBoxSpec[] = [];
    if (!reserved && !gap && index >= 1 && index % 3 === 1) {
      const x = start + 9 + hash(index + 1459) * 3;
      // Keep the opening stretch clear, then thin the existing candidates
      // deterministically so revisiting or streaming chunks cannot reroll loot.
      if (x >= BOX_UNLOCK_X && hash(index + 1531) < BOX_SPAWN_KEEP_CHANCE) {
        const airborne = hash(index + 1481) > .45;
        boxes.push({ id: `box-${index}`, x, y: roadHeight(x) + (airborne ? 3.2 + hash(index + 1493) * .7 : .58),
          airborne, phase: hash(index + 1511) * Math.PI * 2 });
      }
    }
    const chunk = { index, start, end: start + CHUNK_LENGTH, gap, hazards, boxes, seed };
    this.cache.set(index, chunk);
    return chunk;
  }

  hasRoad(x: number): boolean {
    if (x < 0) return x >= START_APRON_X;
    const chunk = this.chunk(Math.floor(x / CHUNK_LENGTH));
    return !chunk.gap || x < chunk.gap.start || x > chunk.gap.end;
  }

  trim(beforeIndex: number): void {
    for (const index of this.cache.keys()) {
      if (index < beforeIndex) this.cache.delete(index);
    }
  }
}
