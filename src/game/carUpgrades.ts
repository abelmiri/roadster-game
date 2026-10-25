export const CAR_UPGRADE_IDS = ['armor', 'boost-reserve', 'boost-power'] as const;
export type CarUpgradeId = typeof CAR_UPGRADE_IDS[number];
export type CarUpgrades = Partial<Record<CarUpgradeId, number>>;
export const MAX_CAR_UPGRADE = 4;
const STARTING_PRICES: Record<CarUpgradeId, number> = { armor: 4000, 'boost-reserve': 3000, 'boost-power': 3000 };

export function carUpgradeLevel(level: unknown): number {
  return typeof level === 'number' && Number.isSafeInteger(level) ? Math.max(0, Math.min(MAX_CAR_UPGRADE, level)) : 0;
}
export function carUpgradeCost(id: string, level: number): number | null {
  if (!CAR_UPGRADE_IDS.includes(id as CarUpgradeId) || !Number.isSafeInteger(level) || level < 0 || level >= MAX_CAR_UPGRADE) return null;
  return Math.ceil(STARTING_PRICES[id as CarUpgradeId] * 1.5 ** level);
}
export function carUpgradeStats(upgrades: CarUpgrades = {}): { armor: number; maxHealth: number; boostCapacity: number; boostPower: number } {
  const armor = carUpgradeLevel(upgrades.armor);
  return { armor, maxHealth: 100 + armor * 25,
    boostCapacity: 1 + .25 * carUpgradeLevel(upgrades['boost-reserve']),
    boostPower: 1 + .2 * carUpgradeLevel(upgrades['boost-power']) };
}
