import { PlayerProgress } from './playerProgress';
import { WEAPONS, weaponSpec, weaponUpgradeCost, type WeaponId } from './weapons';
import { CAR_UPGRADE_IDS, carUpgradeCost, carUpgradeRequiredLevel, carUpgradeStats, type CarUpgradeId } from './carUpgrades';
import { CAR_PAINT_PRICE, isCarPaint, type CarPaintId } from './carPaint';
import { LEVEL_XP } from './experience';
import { CAR_MODEL_PRICE, isCarModel, type CarModelId } from './carModels';

export type PurchaseIntent = { kind: 'weapon' | 'weapon-upgrade'; id: WeaponId }
  | { kind: 'car-upgrade'; id: CarUpgradeId } | { kind: 'paint'; id: CarPaintId }
  | { kind: 'vehicle'; id: CarModelId };
export type PurchaseQuote = PurchaseIntent & { cost: number; level: number; vehicle?: CarModelId };

/** Quotes are read-only. Every debit is revalidated when the modal is confirmed. */
export function purchaseQuote(player: PlayerProgress, intent: PurchaseIntent, xp: number): PurchaseQuote | null {
  if (!Number.isSafeInteger(xp) || xp < 0) return null;
  let cost: number | null = null;
  let level = 0;
  if (intent.kind === 'weapon' || intent.kind === 'weapon-upgrade') {
    const spec = WEAPONS.find(spec => spec.id === intent.id);
    if (!spec || xp < spec.xp) return null;
    if (intent.kind === 'weapon') {
      if (player.ownsWeapon(intent.id)) return null;
      cost = spec.price;
    } else {
      if (!player.ownsWeapon(intent.id)) return null;
      level = player.weaponLevel(intent.id) + 1;
      cost = weaponUpgradeCost(intent.id, level - 1);
    }
  } else if (intent.kind === 'car-upgrade') {
    if (!CAR_UPGRADE_IDS.includes(intent.id)) return null;
    level = player.carLevel(intent.id) + 1;
    const required = carUpgradeRequiredLevel(intent.id, level - 1);
    if (required === null || Math.floor(xp / LEVEL_XP) + 1 < required) return null;
    cost = carUpgradeCost(intent.id, level - 1);
  } else if (intent.kind === 'vehicle') {
    if (!isCarModel(intent.id) || player.ownsVehicle(intent.id)) return null;
    cost = CAR_MODEL_PRICE;
  } else {
    if (!isCarPaint(intent.id) || player.ownsPaint(intent.id)) return null;
    cost = CAR_PAINT_PRICE;
  }
  return cost === null || player.coins < cost ? null : {
    ...intent, cost, level, ...(intent.kind === 'paint' ? { vehicle: player.selectedVehicle } : {}),
  };
}

export function confirmPurchase(player: PlayerProgress, expected: PurchaseQuote, xp: number): boolean {
  if (expected.kind === 'paint' && expected.vehicle !== player.selectedVehicle) return false;
  const current = purchaseQuote(player, expected, xp);
  if (!current || current.cost !== expected.cost || current.level !== expected.level) return false;
  if (expected.kind === 'weapon') return player.purchaseWeapon(expected.id, xp) === 'purchased';
  if (expected.kind === 'weapon-upgrade') return player.upgradeWeapon(expected.id) === 'upgraded';
  if (expected.kind === 'car-upgrade') return player.upgradeCar(expected.id, Math.floor(xp / LEVEL_XP) + 1) === 'upgraded';
  if (expected.kind === 'vehicle') return player.purchaseVehicle(expected.id) === 'purchased';
  return player.purchasePaint(expected.id) === 'purchased';
}

export function purchaseWeaponStats(quote: PurchaseQuote) {
  if (quote.kind !== 'weapon' && quote.kind !== 'weapon-upgrade') return null;
  return { before: quote.kind === 'weapon-upgrade' ? weaponSpec(quote.id, quote.level - 1) : null,
    after: weaponSpec(quote.id, quote.level) };
}

export function purchaseCarStats(player: PlayerProgress, quote: PurchaseQuote) {
  if (quote.kind !== 'car-upgrade') return null;
  return { before: carUpgradeStats(player.carUpgrades), after: carUpgradeStats({ ...player.carUpgrades, [quote.id]: quote.level }) };
}
