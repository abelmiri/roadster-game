const BASE_DISTANCE_REWARDS = [
  { distance: 1500, coins: 100, xp: 150 },
  { distance: 3000, coins: 250, xp: 300 },
  { distance: 4500, coins: 500, xp: 600 },
  { distance: 6000, coins: 750, xp: 1000 },
  { distance: 7500, coins: 1000, xp: 1500 },
  { distance: 10000, coins: 1500, xp: 2000 },
] as const;
export const DISTANCE_REWARD_INTERVAL = 10000;
export const DISTANCE_REWARDS_PER_INTERVAL = BASE_DISTANCE_REWARDS.length;
export const DISTANCE_COIN_REWARDS = Array.from({ length: 5 }, (_, index) =>
  BASE_DISTANCE_REWARDS.map(reward => ({
    distance: index * DISTANCE_REWARD_INTERVAL + reward.distance,
    coins: (index + 1) * reward.coins,
    xp: (index + 1) * reward.xp,
  }))).flat();
export const FINAL_DISTANCE_REWARD = DISTANCE_COIN_REWARDS.at(-1)!.distance;

export function distanceXpReward(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return DISTANCE_COIN_REWARDS.reduce((xp, reward) => xp + (distance >= reward.distance ? reward.xp : 0), 0);
}

export function distanceCoinProgress(distance: number): { distance: number; fraction: number; next: typeof DISTANCE_COIN_REWARDS[number] | null; interval: number } {
  const current = Number.isFinite(distance) ? Math.max(0, Math.floor(distance)) : 0;
  const interval = Math.min(Math.floor(current / DISTANCE_REWARD_INTERVAL), FINAL_DISTANCE_REWARD / DISTANCE_REWARD_INTERVAL - 1);
  return { distance: current, interval,
    fraction: Math.min(1, (current - interval * DISTANCE_REWARD_INTERVAL) / DISTANCE_REWARD_INTERVAL),
    next: DISTANCE_COIN_REWARDS.find(reward => current < reward.distance) ?? null };
}
