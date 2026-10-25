export const DISTANCE_COIN_REWARDS = [
  { distance: 1500, coins: 100, xp: 150 },
  { distance: 3000, coins: 250, xp: 300 },
  { distance: 4500, coins: 500, xp: 600 },
  { distance: 6000, coins: 750, xp: 1000 },
  { distance: 7500, coins: 1000, xp: 1500 },
  { distance: 10000, coins: 1500, xp: 2000 },
] as const;
export const FINAL_DISTANCE_REWARD = DISTANCE_COIN_REWARDS.at(-1)!.distance;

export function distanceXpReward(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return DISTANCE_COIN_REWARDS.reduce((xp, reward) => xp + (distance >= reward.distance ? reward.xp : 0), 0);
}

export function distanceCoinProgress(distance: number): { distance: number; fraction: number; next: typeof DISTANCE_COIN_REWARDS[number] | null } {
  const current = Number.isFinite(distance) ? Math.max(0, Math.floor(distance)) : 0;
  return { distance: current, fraction: Math.min(1, current / FINAL_DISTANCE_REWARD),
    next: DISTANCE_COIN_REWARDS.find(reward => current < reward.distance) ?? null };
}
