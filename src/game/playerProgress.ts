import { canEquip, WEAPONS, MAX_WEAPON_UPGRADE, weaponUpgradeCost, type WeaponId, type WeaponUpgrades } from './weapons';
import { CAR_UPGRADE_IDS, MAX_CAR_UPGRADE, carUpgradeCost, carUpgradeRequiredLevel, type CarUpgradeId, type CarUpgrades } from './carUpgrades';
import { DISTANCE_COIN_REWARDS } from './coinRewards';

type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;
type RecordEntry = { distance: number; name: string; needsName: boolean };
export type PurchaseResult = 'purchased' | 'owned' | 'xp-locked' | 'insufficient-coins' | 'unknown';
export type UpgradeResult = 'upgraded' | 'unowned' | 'max-level' | 'insufficient-coins' | 'xp-locked' | 'unknown';
const STORAGE_KEY = 'roadster-progress';
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const cleanName = (value: string): string => value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);

/** A stable, versioned save keeps purchases and their coin debit in one storage write. */
export class PlayerProgress {
  coins = 0;
  runCoins = 0;
  score = 0;
  playerName = '';
  record: RecordEntry = { distance: 0, name: '', needsName: false };
  private readonly owned = new Set<WeaponId>(['machine-gun']);
  private readonly upgrades: WeaponUpgrades = {};
  private readonly vehicleUpgrades: CarUpgrades = {};
  private collected = [0, 0, 0, 0];
  private finished = false;
  private distanceRewardsCollected = 0;
  private runScore = 0;
  private savedScore = 0;
  private scoreSavedAt = -Infinity;

  constructor(private readonly storage?: ProgressStorage) {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
      if (saved?.version === 1) {
        if (validCount(saved.coins)) this.coins = saved.coins;
        if (validCount(saved.score)) this.score = saved.score;
        if (typeof saved.playerName === 'string') this.playerName = cleanName(saved.playerName);
        if (validCount(saved.record?.distance)) {
          this.record = { distance: saved.record.distance,
            name: typeof saved.record.name === 'string' ? cleanName(saved.record.name) : '',
            needsName: saved.record.distance > 0 && saved.record.needsName === true };
        }
        if (Array.isArray(saved.ownedWeapons)) {
          for (const spec of WEAPONS) if (saved.ownedWeapons.includes(spec.id)) this.owned.add(spec.id);
        }
        for (const spec of WEAPONS) {
          const level = saved.weaponUpgrades?.[spec.id];
          if (this.ownsWeapon(spec.id) && validCount(level) && level <= MAX_WEAPON_UPGRADE) this.upgrades[spec.id] = level;
        }
        for (const id of CAR_UPGRADE_IDS) {
          const level = saved.carUpgrades?.[id];
          if (validCount(level) && level <= MAX_CAR_UPGRADE) this.vehicleUpgrades[id] = level;
        }
      }
    } catch { /* Recover any older best score independently of a damaged save. */ }
    try {
      const legacyBest = Number(storage?.getItem('roadster-best') ?? 0);
      if (validCount(legacyBest) && legacyBest > this.record.distance) {
        this.record = { distance: legacyBest, name: '', needsName: false };
      }
    } catch { /* The session remains playable without browser storage. */ }
    this.savedScore = this.score;
  }

  /** Save the last run's distance without synchronously writing every frame. */
  trackScore(distance: number, now: number): void {
    if (this.finished) return;
    const score = Math.floor(distance);
    if (!validCount(score)) return;
    this.runScore = Math.max(this.runScore, score);
    this.score = this.runScore;
    if (this.score !== this.savedScore && now - this.scoreSavedAt >= 1000) {
      this.persist();
      this.scoreSavedAt = now;
    }
  }

  flushScore(): void {
    if (this.score !== this.savedScore) this.persist();
  }

  ownsWeapon(id: string): boolean { return this.owned.has(id as WeaponId); }
  weaponLevel(id: string): number { return this.ownsWeapon(id) ? this.upgrades[id as WeaponId] ?? 0 : 0; }
  get weaponUpgrades(): WeaponUpgrades { return { ...this.upgrades }; }
  get carUpgrades(): CarUpgrades { return { ...this.vehicleUpgrades }; }
  carLevel(id: CarUpgradeId): number { return this.vehicleUpgrades[id] ?? 0; }

  upgradeCar(id: string, playerLevel = 1): UpgradeResult {
    if (!CAR_UPGRADE_IDS.includes(id as CarUpgradeId)) return 'unknown';
    const key = id as CarUpgradeId;
    const level = this.carLevel(key);
    const cost = carUpgradeCost(key, level);
    if (cost === null) return 'max-level';
    const requiredLevel = carUpgradeRequiredLevel(key, level)!;
    if (!Number.isSafeInteger(playerLevel) || playerLevel < requiredLevel) return 'xp-locked';
    if (this.coins < cost) return 'insufficient-coins';
    this.coins -= cost;
    this.vehicleUpgrades[key] = level + 1;
    this.persist();
    return 'upgraded';
  }

  upgradeWeapon(id: string): UpgradeResult {
    const spec = WEAPONS.find(weapon => weapon.id === id);
    if (!spec) return 'unknown';
    if (!this.ownsWeapon(id)) return 'unowned';
    const level = this.weaponLevel(id);
    const cost = weaponUpgradeCost(id, level);
    if (cost === null) return 'max-level';
    if (this.coins < cost) return 'insufficient-coins';
    this.coins -= cost;
    this.upgrades[spec.id] = level + 1;
    this.persist();
    return 'upgraded';
  }

  purchaseWeapon(id: string, xp: number): PurchaseResult {
    const spec = WEAPONS.find(weapon => weapon.id === id);
    if (!spec) return 'unknown';
    if (this.ownsWeapon(id)) return 'owned';
    if (!canEquip(id, xp)) return 'xp-locked';
    if (this.coins < spec.price) return 'insufficient-coins';
    this.coins -= spec.price;
    this.owned.add(spec.id);
    this.persist();
    return 'purchased';
  }

  collect(distance: number, completedLoops: number, destroyedPolice: number, flipCoins = 0): number {
    if (this.finished) return 0;
    const milestones = Number.isFinite(distance) && distance >= 0 ? Math.floor(distance / 200) : NaN;
    const counters = [milestones, completedLoops, destroyedPolice, flipCoins];
    const rewards = [10, 5, 10, 1];
    let gained = 0;
    counters.forEach((count, index) => {
      if (!validCount(count) || count <= this.collected[index]) return;
      gained += (count - this.collected[index]) * rewards[index];
      this.collected[index] = count;
    });
    if (Number.isFinite(distance)) {
      while (this.distanceRewardsCollected < DISTANCE_COIN_REWARDS.length &&
          distance >= DISTANCE_COIN_REWARDS[this.distanceRewardsCollected].distance) {
        gained += DISTANCE_COIN_REWARDS[this.distanceRewardsCollected].coins;
        this.distanceRewardsCollected++;
      }
    }
    if (!gained) return 0;
    return this.credit(gained);
  }

  finishRun(distance: number): { newRecord: boolean; bonus: number } {
    if (this.finished) return { newRecord: false, bonus: 0 };
    this.finished = true;
    const score = Math.floor(distance);
    if (validCount(score)) this.score = this.runScore = Math.max(this.runScore, score);
    if (!validCount(score) || score <= this.record.distance) {
      this.flushScore();
      return { newRecord: false, bonus: 0 };
    }
    this.record = { distance: score, name: '', needsName: true };
    const bonus = score > 2000 ? 25 : score > 1000 ? 10 : 0;
    this.coins += bonus;
    this.runCoins += bonus;
    this.persist();
    // Keep the original best-score key readable by older builds as well.
    try { this.storage?.setItem('roadster-best', String(score)); } catch { /* Optional legacy mirror. */ }
    return { newRecord: true, bonus };
  }

  nameRecord(name: string): boolean {
    const cleaned = cleanName(name);
    if (!this.record.needsName || !cleaned) return false;
    this.playerName = cleaned;
    this.record = { ...this.record, name: cleaned, needsName: false };
    this.persist();
    return true;
  }

  resetRun(): void {
    this.collected = [0, 0, 0, 0];
    this.finished = false;
    this.distanceRewardsCollected = 0;
    this.runCoins = 0;
    this.runScore = this.score = 0;
    this.scoreSavedAt = -Infinity;
    this.flushScore();
  }

  private credit(amount: number): number {
    const gained = Math.min(amount, Number.MAX_SAFE_INTEGER - this.coins);
    this.coins += gained;
    this.runCoins = Math.min(Number.MAX_SAFE_INTEGER, this.runCoins + gained);
    this.persist();
    return gained;
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, coins: this.coins,
        score: this.score,
        ownedWeapons: [...this.owned], weaponUpgrades: this.upgrades, carUpgrades: this.vehicleUpgrades,
        record: this.record, playerName: this.playerName }));
      this.savedScore = this.score;
    } catch { /* Keep progress for this session when persistence is unavailable. */ }
  }
}
