export const DISTANCE_COIN_REWARDS = [
  { distance: 1500, coins: 50 },
  { distance: 3000, coins: 120 },
  { distance: 4500, coins: 200 },
  { distance: 6000, coins: 275 },
  { distance: 7500, coins: 350 },
  { distance: 10000, coins: 500 },
] as const;
export const FINAL_DISTANCE_REWARD = DISTANCE_COIN_REWARDS.at(-1)!.distance;

export function distanceCoinProgress(distance: number): { distance: number; fraction: number; next: typeof DISTANCE_COIN_REWARDS[number] | null } {
  const current = Number.isFinite(distance) ? Math.max(0, Math.floor(distance)) : 0;
  return { distance: current, fraction: Math.min(1, current / FINAL_DISTANCE_REWARD),
    next: DISTANCE_COIN_REWARDS.find(reward => current < reward.distance) ?? null };
}
