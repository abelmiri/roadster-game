import type { RandomBoxSpec } from './randomBox';

export const CHUNK_LENGTH = 30;
export const START_APRON_X = -64;
export const BOX_UNLOCK_DISTANCE = 300;
export const BOX_SPAWN_KEEP_CHANCE = .64;
export const HAZARD_SPAWN_KEEP_CHANCE = .688;
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
export interface RagdollSpec {
  id: number; siteId: number; memberIndex: number; groupSize: number;
  x: number; y: number; outfit: number; pose: 'standing' | 'sitting' | 'hanging' | 'looking';
  lookDirection?: -1 | 1;
}
export const RAGDOLL_MIN_SPACING = 300;
export const RAGDOLL_MAX_SPACING = 500;
export const RAGDOLL_OUTFIT_COUNT = 4;
const RAGDOLL_GROUP_GAP = 2.2;
const ragdollSites: number[] = [];
const ragdollSpawns: RagdollSpec[] = [];
let ragdollPlacementTrack: TrackGenerator | undefined;
let gapSpectatorTrack: TrackGenerator | undefined;
const gapSpectators: RagdollSpec[] = [];
let gapSpectatorsGeneratedThrough = -1;

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

const EXTRA_WAVE_START = 450;
const EXTRA_WAVE_FADE = 150;
const extraWaveWeight = (x: number): number => {
  const t = Math.max(0, Math.min(1, (x - EXTRA_WAVE_START) / EXTRA_WAVE_FADE));
  return t * t * (3 - 2 * t);
};
const extraWaveWeightSlope = (x: number): number => {
  const t = Math.max(0, Math.min(1, (x - EXTRA_WAVE_START) / EXTRA_WAVE_FADE));
  return 6 * t * (1 - t) / EXTRA_WAVE_FADE;
};
const extraWave = (x: number): number => 0.3 * Math.sin(x * 0.18) + 0.18 * Math.sin(x * 0.48);
const extraWaveSlope = (x: number): number => 0.3 * 0.18 * Math.cos(x * 0.18) + 0.18 * 0.48 * Math.cos(x * 0.48);
const rollingHeight = (x: number): number => 1.15 + 0.72 * Math.sin(x * 0.105) + 0.92 * Math.sin(x * 0.30) +
  extraWaveWeight(x) * extraWave(x);
const rollingSlope = (x: number): number => 0.72 * 0.105 * Math.cos(x * 0.105) + 0.92 * 0.30 * Math.cos(x * 0.30) +
  extraWaveWeightSlope(x) * extraWave(x) + extraWaveWeight(x) * extraWaveSlope(x);

const FLAT_FIRST_CENTER = 760;
const FLAT_PERIOD = 300;
const FLAT_HALF_WIDTH = 45;
const FLAT_BLEND_WIDTH = 16;

function flatBlend(x: number): { center: number; weight: number; slope: number } | null {
  const index = Math.round((x - FLAT_FIRST_CENTER) / FLAT_PERIOD);
  if (index < 0) return null;
  const center = FLAT_FIRST_CENTER + index * FLAT_PERIOD;
  const offset = x - center;
  const distance = Math.abs(offset);
  if (distance >= FLAT_HALF_WIDTH) return null;
  if (distance <= FLAT_HALF_WIDTH - FLAT_BLEND_WIDTH) return { center, weight: 1, slope: 0 };
  const t = (FLAT_HALF_WIDTH - distance) / FLAT_BLEND_WIDTH;
  return { center, weight: t * t * (3 - 2 * t), slope: -6 * t * (1 - t) * Math.sign(offset) / FLAT_BLEND_WIDTH };
}

const flatGrade = (center: number): number => 0.012 * Math.sin(center * 0.017);
const baseHeight = (x: number): number => {
  const blend = flatBlend(x);
  if (!blend) return rollingHeight(x);
  const height = rollingHeight(x);
  const plateau = rollingHeight(blend.center) + flatGrade(blend.center) * (x - blend.center);
  return height + blend.weight * (plateau - height);
};
const baseSlope = (x: number): number => {
  const blend = flatBlend(x);
  if (!blend) return rollingSlope(x);
  const height = rollingHeight(x);
  const plateau = rollingHeight(blend.center) + flatGrade(blend.center) * (x - blend.center);
  return rollingSlope(x) * (1 - blend.weight) + blend.weight * flatGrade(blend.center) +
    blend.slope * (plateau - height);
};

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

function ensureRagdolls(end: number): void {
  if (!ragdollPlacementTrack) ragdollPlacementTrack = new TrackGenerator();
  while (!ragdollSites.length || ragdollSites[ragdollSites.length - 1] < end) {
    const siteId = ragdollSites.length;
    const previous = siteId ? ragdollSites[siteId - 1] : 7;
    const target = previous + 340 + hash(siteId + 2077) * 120;
    const groupRoll = hash(siteId + 3419);
    const count = groupRoll < .16 ? 3 : groupRoll < .43 ? 2 : 1;
    const memberXs = (center: number, size: number): number[] =>
      Array.from({ length: size }, (_, member) => center + (member - (size - 1) / 2) * RAGDOLL_GROUP_GAP);
    const clear = (x: number): boolean => {
      if (!ragdollPlacementTrack!.hasRoad(x - 1) || !ragdollPlacementTrack!.hasRoad(x + 1)) return false;
      if (loopsBetween(x - 17, x + 17).length) return false;
      const first = Math.floor((x - 8) / CHUNK_LENGTH);
      const last = Math.floor((x + 8) / CHUNK_LENGTH);
      for (let index = first; index <= last; index++) {
        if (ragdollPlacementTrack!.chunk(index).hazards.some(hazard => Math.abs(hazard.x - x) < 8)) return false;
      }
      return true;
    };
    let center = target;
    let size = count;
    let placed = false;
    for (const candidateSize of [count, 1]) {
      for (const offset of [0, -4, 4, -8, 8, -12, 12, -16, 16, -20, 20]) {
        const candidate = target + offset;
        if (!memberXs(candidate, candidateSize).every(clear)) continue;
        center = candidate;
        size = candidateSize;
        placed = true;
        break;
      }
      if (placed) break;
    }
    ragdollSites.push(center);
    for (const [memberIndex, x] of memberXs(center, size).entries()) {
      const id = ragdollSpawns.length;
      ragdollSpawns.push({ id, siteId, memberIndex, groupSize: size, x, y: roadHeight(x), pose: 'standing',
        outfit: Math.floor(hash(id + 6291) * RAGDOLL_OUTFIT_COUNT) });
    }
    ragdollPlacementTrack.trim(Math.floor(center / CHUNK_LENGTH) - 5);
  }
}

/** Two or three spectators straddle each procedural gap, sitting or peering in. */
export function gapSpectatorsBetween(start: number, end: number): RagdollSpec[] {
  if (end < 0 || end < start) return [];
  if (!gapSpectatorTrack) gapSpectatorTrack = new TrackGenerator();
  const through = Math.floor(end / CHUNK_LENGTH);
  for (let index = gapSpectatorsGeneratedThrough + 1; index <= through; index++) {
    const gap = gapSpectatorTrack.chunk(index).gap;
    gapSpectatorsGeneratedThrough = index;
    if (!gap) continue;
    const count = hash(index + 7021) < .52 ? 2 : 3;
    const sitAtStart = hash(index + 7297) < .5;
    const people: Array<{ x: number; pose: RagdollSpec['pose']; lookDirection: -1 | 1 }> = [
      { x: gap.start - .58, pose: sitAtStart ? 'sitting' : 'looking', lookDirection: 1 },
      { x: gap.end + .58, pose: sitAtStart ? 'looking' : 'sitting', lookDirection: -1 },
    ];
    if (count === 3) {
      const extraAtStart = hash(index + 7411) < .5;
      people.push(extraAtStart
        ? { x: gap.start - 2.78, pose: 'looking', lookDirection: 1 }
        : { x: gap.end + 2.78, pose: 'looking', lookDirection: -1 });
    }
    people.sort((a, b) => a.x - b.x);
    const siteId = 1_000_000 + index;
    for (const [memberIndex, person] of people.entries()) {
      const id = 10_000_000 + index * 3 + memberIndex;
      gapSpectators.push({ id, siteId, memberIndex, groupSize: count, x: person.x,
        y: roadHeight(person.x), outfit: Math.floor(hash(id + 6291) * RAGDOLL_OUTFIT_COUNT),
        pose: person.pose, lookDirection: person.lookDirection });
    }
  }
  let low = 0;
  let high = gapSpectators.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (gapSpectators[middle].x < start) low = middle + 1;
    else high = middle;
  }
  const result: RagdollSpec[] = [];
  for (let index = low; index < gapSpectators.length && gapSpectators[index].x <= end; index++) {
    result.push(gapSpectators[index]);
  }
  return result;
}

export function ragdollsBetween(start: number, end: number): RagdollSpec[] {
  if (end < 0 || end < start) return [];
  ensureRagdolls(end);
  let low = 0;
  let high = ragdollSpawns.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ragdollSpawns[mid].x < start) low = mid + 1;
    else high = mid;
  }
  const result: RagdollSpec[] = [];
  for (let index = low; index < ragdollSpawns.length && ragdollSpawns[index].x <= end; index++) {
    result.push(ragdollSpawns[index]);
  }
  return result;
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

    // Thin eligible challenges deterministically to leave about 18% more room between obstacles.
    if (index >= 2 && !gap && !reserved && hash(index + 1337) < HAZARD_SPAWN_KEEP_CHANCE) {
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
