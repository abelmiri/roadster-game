export const LOOP_XP = 25;
export const OBSTACLE_XP = 10;
export const POLICE_XP = 20;
export const LEVEL_XP = 100;
export type RewardKind = 'loop' | 'obstacle' | 'police' | 'mixed';
type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Cumulative run counters retain every reward across skipped display frames. */
export class ExperienceProgress {
  total = 0;
  lastRewardKind: RewardKind = 'loop';
  private collected = [0, 0, 0];

  constructor(private readonly storage?: ProgressStorage) {
    try {
      const saved = Number(storage?.getItem('roadster-xp') ?? 0);
      if (Number.isSafeInteger(saved) && saved >= 0) this.total = saved;
    } catch { /* Progress still works for this session without storage. */ }
  }

  collect(completedLoops: number, destroyedObstacles = 0, destroyedPolice = 0): number {
    const counters = [completedLoops, destroyedObstacles, destroyedPolice];
    const values = [LOOP_XP, OBSTACLE_XP, POLICE_XP];
    const kinds: RewardKind[] = ['loop', 'obstacle', 'police'];
    const awarded: RewardKind[] = [];
    let gained = 0;
    counters.forEach((count, index) => {
      if (!Number.isSafeInteger(count) || count <= this.collected[index]) return;
      gained += (count - this.collected[index]) * values[index];
      this.collected[index] = count;
      awarded.push(kinds[index]);
    });
    if (!gained) return 0;
    this.lastRewardKind = awarded.length === 1 ? awarded[0] : 'mixed';
    this.total += gained;
    try { this.storage?.setItem('roadster-xp', String(this.total)); } catch { /* Optional persistence. */ }
    return gained;
  }

  resetRun(): void { this.collected = [0, 0, 0]; this.lastRewardKind = 'loop'; }
  get level(): number { return Math.floor(this.total / LEVEL_XP) + 1; }
  get levelProgress(): number { return this.total % LEVEL_XP; }
}
