export const emptyMissionStats = () => ({
  distance: 0, maxSpeed: 0, speed80Seconds: 0, nightReached: 0, nightSeconds: 0,
  forwardFlips: 0, backflips: 0, jumps: 0, doubleJumps: 0, obstaclesShot: 0,
  dronesShot: 0, pulsesShot: 0, hazardsRammed: 0, dronesRammed: 0, policeDestroyed: 0,
  emptyWeapons: 0, boxesOpened: 0, loops: 0, longestFlight: 0, airSeconds: 0,
  boostSeconds: 0, cleanDistance: 0, noFireDistance: 0, noBoostDistance: 0,
  rampBoosts: 0, roofHits: 0, shots: 0, elapsed: 0,
});
export type MissionStats = ReturnType<typeof emptyMissionStats>;

/** Counts at the physics rate so brief peaks, held speeds and fatal contacts
 * survive skipped display frames. Wreck animation never advances this tracker. */
export class RunMissionTracker {
  readonly stats = emptyMissionStats();
  private fastSeconds = 0;
  private flightSeconds = 0;
  private boosted = false;
  private readonly emptied = new Set<string>();

  recordWeapon(id: string, ammo: number, shots: number): void {
    if (shots > this.stats.shots && ammo === 0) this.emptied.add(id);
    this.stats.shots = shots;
    this.stats.emptyWeapons = this.emptied.size;
  }

  step(sample: { distance: number; speed: number; grounded: boolean; loop: boolean;
    crashed: boolean; boost: boolean; impacts: number; loops: number; police: number;
    boxes: number; ramps: number }, dt: number): void {
    const stats = this.stats;
    stats.elapsed += dt;
    stats.distance = Math.max(stats.distance, sample.distance);
    stats.maxSpeed = Math.max(stats.maxSpeed, Math.abs(sample.speed) * 3.6);
    this.fastSeconds = Math.abs(sample.speed) * 3.6 > 80 ? this.fastSeconds + dt : 0;
    stats.speed80Seconds = Math.max(stats.speed80Seconds, this.fastSeconds);
    if (sample.distance >= 720) { stats.nightReached = 1; stats.nightSeconds += dt; }
    if (!sample.grounded && !sample.loop && !sample.crashed) {
      this.flightSeconds += dt; stats.airSeconds += dt;
      stats.longestFlight = Math.max(stats.longestFlight, this.flightSeconds);
    } else this.flightSeconds = 0;
    if (sample.boost) { this.boosted = true; stats.boostSeconds += dt; }
    if (!sample.impacts && !sample.crashed) stats.cleanDistance = Math.max(stats.cleanDistance, sample.distance);
    if (!stats.shots) stats.noFireDistance = Math.max(stats.noFireDistance, sample.distance);
    if (!this.boosted) stats.noBoostDistance = Math.max(stats.noBoostDistance, sample.distance);
    stats.loops = sample.loops; stats.policeDestroyed = sample.police;
    stats.boxesOpened = sample.boxes; stats.rampBoosts = sample.ramps;
  }
}
