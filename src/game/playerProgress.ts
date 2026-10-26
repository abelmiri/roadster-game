import { canEquip, WEAPONS, MAX_WEAPON_UPGRADE, weaponUpgradeCost, type WeaponId, type WeaponUpgrades } from './weapons';
import { CAR_UPGRADE_IDS, MAX_CAR_UPGRADE, carUpgradeCost, carUpgradeRequiredLevel, type CarUpgradeId, type CarUpgrades } from './carUpgrades';
import { DISTANCE_COIN_REWARDS } from './coinRewards';
import { CAR_PAINT_PRICE, isCarPaint, type CarPaintId } from './carPaint';
import { MissionProgress, type MissionSpec } from './missions';
import type { MissionStats } from './missionStats';
import { CAR_MODELS, CAR_MODEL_PRICE, isCarModel, type CarModelId } from './carModels';

type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;
type RecordEntry = { distance: number; name: string; needsName: boolean };
export type PurchaseResult = 'purchased' | 'owned' | 'xp-locked' | 'insufficient-coins' | 'unknown';
export type UpgradeResult = 'upgraded' | 'unowned' | 'max-level' | 'insufficient-coins' | 'xp-locked' | 'unknown';
const STORAGE_KEY = 'roadster-progress';
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const cleanName = (value: string): string => value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);

/** A stable, versioned save keeps purchases and their coin debit in one storage write. */
export class PlayerProgress {
  readonly missions = new MissionProgress();
  coins = 0;
  runCoins = 0;
  score = 0;
  playerName = '';
  record: RecordEntry = { distance: 0, name: '', needsName: false };
  private readonly owned = new Set<WeaponId>(['machine-gun']);
  private readonly upgrades: WeaponUpgrades = {};
  private readonly vehicleUpgrades: CarUpgrades = {};
  private readonly paints = new Set<CarPaintId>(['white']);
  private readonly vehicles = new Set<CarModelId>(['roadster']);
  private readonly vehiclePaints: Partial<Record<CarModelId, CarPaintId>> = {};
  private vehicle: CarModelId = 'roadster';
  private collected = [0, 0, 0, 0, 0];
  private finished = false;
  private distanceRewardsCollected = 0;
  private runScore = 0;
  private savedScore = 0;
  private scoreSavedAt = -Infinity;
  private missionSavedAt = -Infinity;
  private missionSavedRevision = 0;

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
        if (Array.isArray(saved.ownedPaints)) for (const id of saved.ownedPaints) {
          if (isCarPaint(id)) this.paints.add(id);
        }
        const legacyVehicle: CarModelId = isCarModel(saved.selectedVehicle) ? saved.selectedVehicle : 'roadster';
        if (Array.isArray(saved.ownedVehicles)) {
          for (const id of saved.ownedVehicles) if (isCarModel(id)) this.vehicles.add(id);
        } else if (saved.ownedVehicles === undefined) {
          // Keep a car already in use before ownership was introduced.
          this.vehicles.add(legacyVehicle);
        }
        if (this.ownsVehicle(legacyVehicle)) this.vehicle = legacyVehicle;
        if (saved.vehiclePaints && typeof saved.vehiclePaints === 'object' && !Array.isArray(saved.vehiclePaints)) {
          for (const { id } of CAR_MODELS) {
            const paint = saved.vehiclePaints[id];
            if (this.ownsVehicle(id) && isCarPaint(paint) && this.paints.has(paint)) this.vehiclePaints[id] = paint;
          }
        } else if (saved.vehiclePaints === undefined && this.ownsVehicle(legacyVehicle) &&
            isCarPaint(saved.selectedPaint) && this.paints.has(saved.selectedPaint)) {
          // Old saves had one global color: keep it on the car it belonged to.
          this.vehiclePaints[legacyVehicle] = saved.selectedPaint;
        }
        this.missions.restore(saved.missions);
      }
    } catch { /* Recover any older best score independently of a damaged save. */ }
    try {
      const legacyBest = Number(storage?.getItem('roadster-best') ?? 0);
      if (validCount(legacyBest) && legacyBest > this.record.distance) {
        this.record = { distance: legacyBest, name: '', needsName: false };
      }
    } catch { /* The session remains playable without browser storage. */ }
    this.savedScore = this.score;
    this.missions.fillSlots(this.owned.size);
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
    if (this.score !== this.savedScore || this.missions.revision !== this.missionSavedRevision) this.persist();
  }

  beginMissionRun(): void { this.missions.beginRun(this.owned.size); this.persist(); }

  updateMissions(stats: MissionStats, now: number, finished = false): MissionSpec[] {
    const ready = this.missions.update(stats, finished);
    if (ready.length || finished || this.missions.revision !== this.missionSavedRevision && now - this.missionSavedAt >= 1000) this.persist();
    if (this.missions.revision === this.missionSavedRevision) this.missionSavedAt = now;
    return ready;
  }

  collectMission(id: string): MissionSpec | null {
    const reward = this.missions.collect(id);
    // The collected ID, points and wallet credit are committed in the same save.
    if (reward) this.credit(reward.reward);
    return reward;
  }

  ownsWeapon(id: string): boolean { return this.owned.has(id as WeaponId); }
  weaponLevel(id: string): number { return this.ownsWeapon(id) ? this.upgrades[id as WeaponId] ?? 0 : 0; }
  get weaponUpgrades(): WeaponUpgrades { return { ...this.upgrades }; }
  get carUpgrades(): CarUpgrades { return { ...this.vehicleUpgrades }; }
  carLevel(id: CarUpgradeId): number { return this.vehicleUpgrades[id] ?? 0; }
  get selectedPaint(): CarPaintId { return this.paintForVehicle(this.vehicle); }
  get selectedVehicle(): CarModelId { return this.vehicle; }
  ownsVehicle(id: string): boolean { return this.vehicles.has(id as CarModelId); }
  paintForVehicle(id: string): CarPaintId { return isCarModel(id) ? this.vehiclePaints[id] ?? 'white' : 'white'; }

  purchaseVehicle(id: string): PurchaseResult {
    if (!isCarModel(id)) return 'unknown';
    if (this.ownsVehicle(id)) return 'owned';
    if (this.coins < CAR_MODEL_PRICE) return 'insufficient-coins';
    this.coins -= CAR_MODEL_PRICE;
    this.vehicles.add(id);
    this.vehicle = id;
    this.persist();
    return 'purchased';
  }

  selectVehicle(id: string): boolean {
    if (!isCarModel(id) || !this.ownsVehicle(id)) return false;
    this.vehicle = id;
    this.persist();
    return true;
  }
  ownsPaint(id: string): boolean { return this.paints.has(id as CarPaintId); }

  purchasePaint(id: string): PurchaseResult {
    if (!isCarPaint(id)) return 'unknown';
    if (this.paints.has(id)) return 'owned';
    if (this.coins < CAR_PAINT_PRICE) return 'insufficient-coins';
    this.coins -= CAR_PAINT_PRICE;
    this.paints.add(id);
    this.vehiclePaints[this.vehicle] = id;
    this.persist();
    return 'purchased';
  }

  selectPaint(id: string): boolean {
    if (!isCarPaint(id) || !this.paints.has(id)) return false;
    this.vehiclePaints[this.vehicle] = id;
    this.persist();
    return true;
  }

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

  collect(distance: number, completedLoops: number, destroyedPolice: number, flipCoins = 0, boxCoins = 0): number {
    if (this.finished) return 0;
    const milestones = Number.isFinite(distance) && distance >= 0 ? Math.floor(distance / 200) : NaN;
    const counters = [milestones, completedLoops, destroyedPolice, flipCoins, boxCoins];
    const rewards = [10, 5, 10, 1, 1];
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
    this.collected = [0, 0, 0, 0, 0];
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
        ownedPaints: [...this.paints], selectedPaint: this.selectedPaint,
        selectedVehicle: this.vehicle, ownedVehicles: [...this.vehicles], vehiclePaints: this.vehiclePaints,
        missions: this.missions.save(),
        record: this.record, playerName: this.playerName }));
      this.savedScore = this.score;
      this.missionSavedRevision = this.missions.revision;
    } catch { /* Keep progress for this session when persistence is unavailable. */ }
  }
}
