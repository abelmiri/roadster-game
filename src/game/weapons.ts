export type WeaponId = 'machine-gun' | 'twin-gun' | 'gatling-gun' | 'cannon' |
  'rocket-launcher' | 'missile-launcher' | 'laser-gun' | 'plasma-cannon';
export type AimDirection = 1 | -1;
export interface WeaponSpec {
  id: WeaponId; name: string; power: number; xp: number; price: number; ammo: number;
  interval: number; turnSeconds: number; damage: number; speed: number;
  range: number; radius: number; splash: number; barrels: number;
  muzzle: number; color: string;
}

/** Ammo is per weapon per run; changing equipment never refills it. */
export const WEAPONS: readonly WeaponSpec[] = [
  { id: 'machine-gun', name: 'MACHINE GUN', power: 1, xp: 0, price: 0, ammo: 80, interval: .18, turnSeconds: .55, damage: 1, speed: 62, range: 38, radius: .07, splash: 0, barrels: 1, muzzle: 1.5, color: '#ffe2a1' },
  { id: 'twin-gun', name: 'TWIN GUN', power: 2, xp: 100, price: 1000, ammo: 100, interval: .23, turnSeconds: .60, damage: 1, speed: 66, range: 40, radius: .07, splash: 0, barrels: 2, muzzle: 1.5, color: '#ffe2a1' },
  { id: 'gatling-gun', name: 'GATLING GUN', power: 3, xp: 250, price: 2000, ammo: 150, interval: .065, turnSeconds: .75, damage: 1, speed: 72, range: 40, radius: .07, splash: 0, barrels: 1, muzzle: 1.6, color: '#ffd16b' },
  { id: 'cannon', name: 'CANNON', power: 4, xp: 450, price: 3000, ammo: 16, interval: .75, turnSeconds: .85, damage: 5, speed: 52, range: 42, radius: .14, splash: 1.3, barrels: 1, muzzle: 1.5, color: '#ffbd6b' },
  { id: 'rocket-launcher', name: 'ROCKET LAUNCHER', power: 5, xp: 700, price: 4000, ammo: 12, interval: .70, turnSeconds: .95, damage: 6, speed: 36, range: 44, radius: .16, splash: 2.3, barrels: 1, muzzle: 1.05, color: '#ff8d68' },
  { id: 'missile-launcher', name: 'MISSILE LAUNCHER', power: 5, xp: 1000, price: 5000, ammo: 10, interval: .85, turnSeconds: .80, damage: 7, speed: 34, range: 48, radius: .16, splash: 1.5, barrels: 1, muzzle: 1.25, color: '#ffb395' },
  { id: 'laser-gun', name: 'LASER GUN', power: 6, xp: 1400, price: 6000, ammo: 50, interval: .15, turnSeconds: .65, damage: 2, speed: 0, range: 44, radius: .10, splash: 0, barrels: 1, muzzle: 1.3, color: '#66f8ee' },
  { id: 'plasma-cannon', name: 'PLASMA CANNON', power: 6, xp: 1900, price: 7000, ammo: 18, interval: .42, turnSeconds: .90, damage: 10, speed: 44, range: 46, radius: .28, splash: 2.8, barrels: 1, muzzle: 1.6, color: '#e98bff' },
];

export const MAX_WEAPON_UPGRADE = 5;
export type WeaponUpgrades = Partial<Record<WeaponId, number>>;
export function weaponUpgradeLevel(level: number): number {
  return Number.isSafeInteger(level) ? Math.max(0, Math.min(MAX_WEAPON_UPGRADE, level)) : 0;
}
const upgradedSpecs = new Map(WEAPONS.map(base => [base.id, Array.from({ length: MAX_WEAPON_UPGRADE + 1 }, (_, level) => {
  if (!level) return base;
  const multiplier = 1 + level * .2;
  return { ...base, power: base.power * multiplier, damage: base.damage * multiplier,
    interval: base.interval / multiplier, ammo: Math.ceil(base.ammo * multiplier / base.barrels) * base.barrels };
})]));
export function weaponSpec(id: string, level = 0): WeaponSpec {
  return (upgradedSpecs.get(id as WeaponId) ?? upgradedSpecs.get('machine-gun')!)[weaponUpgradeLevel(level)];
}
/** The free starter uses the same 1,000-coin upgrade basis as the first paid gun. */
export function weaponUpgradeCost(id: string, level: number): number | null {
  const spec = WEAPONS.find(weapon => weapon.id === id);
  if (!spec || !Number.isSafeInteger(level) || level < 0 || level >= MAX_WEAPON_UPGRADE) return null;
  return Math.ceil(Math.max(1000, spec.price) * 1.5 ** (level + 1));
}
export function canEquip(id: string, xp: number): boolean {
  const spec = WEAPONS.find(weapon => weapon.id === id);
  return Boolean(spec && Number.isSafeInteger(xp) && xp >= spec.xp);
}
type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;
export class WeaponLoadout {
  selected: WeaponId = 'machine-gun';
  constructor(xp: number, private readonly storage?: ProgressStorage,
    private readonly ownsWeapon: (id: string) => boolean = id => id === 'machine-gun') {
    try {
      const saved = storage?.getItem('roadster-weapon');
      if (saved && this.canSelect(saved, xp)) this.selected = saved as WeaponId;
    } catch { /* Session-only equipment when storage is unavailable. */ }
  }
  select(id: string, xp: number): boolean {
    if (!this.canSelect(id, xp)) return false;
    this.selected = id as WeaponId;
    try { this.storage?.setItem('roadster-weapon', id); } catch { /* Optional preference. */ }
    return true;
  }
  private canSelect(id: string, xp: number): boolean { return canEquip(id, xp) && this.ownsWeapon(id); }
}

export interface CombatTarget { id: string; kind: 'hazard' | 'police'; x: number; y: number; radius: number; health: number }
export interface WeaponPose { x: number; y: number; angle: number; vx: number; vy: number }
export interface Projectile {
  id: number; weapon: WeaponId; upgradeLevel: number; x: number; y: number; previousX: number; previousY: number;
  vx: number; vy: number; age: number; lifetime: number; distance: number;
  targetId?: string; beamEndX?: number; beamEndY?: number;
}
export interface CombatEffect { id: number; x: number; y: number; age: number; size: number; destroyed: boolean; color: string }
export interface WeaponImpact {
  x: number; y: number; directionX: number; directionY: number;
  surface: 'hazard' | 'police' | 'terrain'; destroyed: boolean;
}
export interface WeaponSnapshot {
  id: WeaponId; level: number; ammo: number; capacity: number; yaw: number; pitch: number;
  direction: AimDirection; turnRemaining: number; cooldown: number; recoil: number;
  shotSerial: number; hitSerial: number; destroySerial: number;
  projectiles: Projectile[]; effects: CombatEffect[];
}

export const WEAPON_MOUNT = { x: -.16, y: .55, pivotY: .30 };
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/** First intersection along a swept shot, rather than overlap at its endpoint. */
function intersection(x: number, y: number, dx: number, dy: number, target: CombatTarget, radius: number): number | null {
  const ox = x - target.x; const oy = y - target.y; const r = radius + target.radius;
  const a = dx * dx + dy * dy;
  const c = ox * ox + oy * oy - r * r;
  if (c <= 0) return 0;
  if (a < 1e-12) return null;
  const b = ox * dx + oy * dy;
  const d = b * b - a * c;
  if (d < 0) return null;
  const t = (-b - Math.sqrt(d)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

/** Fixed-step combat has no rigid bodies, so recoil cannot destabilize driving. */
export class VehicleWeapon {
  id: WeaponId;
  private readonly ammunition = new Map(WEAPONS.map(spec => [spec.id, spec.ammo]));
  private readonly upgrades = new Map<WeaponId, number>();
  private yaw = 0;
  private previousYaw = 0;
  private pitch = 0;
  private direction: AimDirection = 1;
  private cooldown = 0;
  private recoil = 0;
  private serial = 0;
  private shotSerial = 0;
  private hitSerial = 0;
  private destroySerial = 0;
  private projectiles: Projectile[] = [];
  private effects: CombatEffect[] = [];

  constructor(id: WeaponId = 'machine-gun', upgrades: WeaponUpgrades = {}) {
    this.id = weaponSpec(id).id;
    for (const spec of WEAPONS) this.setUpgradeLevel(spec.id, upgrades[spec.id] ?? 0);
  }
  setUpgradeLevel(id: WeaponId, level: number): void {
    if (!WEAPONS.some(spec => spec.id === id)) return;
    const previous = this.upgrades.get(id) ?? 0;
    const next = weaponUpgradeLevel(level);
    if (next <= previous) return;
    const addedCapacity = weaponSpec(id, next).ammo - weaponSpec(id, previous).ammo;
    this.upgrades.set(id, next);
    this.ammunition.set(id, this.ammoFor(id) + addedCapacity);
  }
  equip(id: string, xp: number): boolean {
    if (!canEquip(id, xp)) return false;
    this.id = id as WeaponId;
    return true;
  }
  ammoFor(id: WeaponId): number { return this.ammunition.get(id) ?? 0; }
  get destructionSerial(): number { return this.destroySerial; }

  step(dt: number, controls: { fire?: boolean; aim?: AimDirection }, pose: WeaponPose,
    targets: CombatTarget[], onDamage: (target: CombatTarget, damage: number) => void,
    floorHeight: (x: number) => number = () => -Infinity,
    onImpact: (impact: WeaponImpact) => void = () => {}): void {
    this.previousYaw = this.yaw;
    if (controls.aim === 1 || controls.aim === -1) this.direction = controls.aim;
    const level = this.upgrades.get(this.id) ?? 0;
    const spec = weaponSpec(this.id, level);
    const destination = this.direction === 1 ? 0 : Math.PI;
    this.yaw += clamp(destination - this.yaw, -Math.PI * dt / spec.turnSeconds, Math.PI * dt / spec.turnSeconds);
    if (Math.abs(destination - this.yaw) < 1e-9) this.yaw = destination;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    for (const effect of this.effects) effect.age += dt;
    this.effects = this.effects.filter(effect => effect.age < (effect.destroyed ? .55 : .24));

    // A small automatic elevation correction makes roof-mounted shots useful
    // against road barriers and drones, while the player controls front/back.
    const c = Math.cos(pose.angle); const s = Math.sin(pose.angle);
    const mountX = pose.x + WEAPON_MOUNT.x * c - (WEAPON_MOUNT.y + WEAPON_MOUNT.pivotY) * s;
    const mountY = pose.y + WEAPON_MOUNT.x * s + (WEAPON_MOUNT.y + WEAPON_MOUNT.pivotY) * c;
    const aimed = targets.filter(target => {
      const dx = target.x - mountX; const dy = target.y - mountY;
      const forward = (dx * c + dy * s) * this.direction;
      return target.health > 0 && forward > 2 && forward < spec.range && Math.abs(-dx * s + dy * c) < forward * .5 + .5;
    }).sort((a, b) => Math.hypot(a.x - mountX, a.y - mountY) - Math.hypot(b.x - mountX, b.y - mountY))[0];
    const desiredPitch = aimed ? clamp(Math.atan2(-(aimed.x - mountX) * s + (aimed.y - mountY) * c,
      Math.abs((aimed.x - mountX) * c + (aimed.y - mountY) * s)), -.45, .45) : 0;
    this.pitch += (desiredPitch - this.pitch) * (1 - Math.exp(-dt * 18));

    if (controls.fire && this.yaw === destination && this.cooldown <= 1e-9 && this.ammoFor(this.id) > 0 && this.projectiles.length < 64) {
      const count = Math.min(spec.barrels, this.ammoFor(this.id));
      this.ammunition.set(this.id, this.ammoFor(this.id) - count);
      this.cooldown = spec.interval;
      this.recoil = 1;
      this.shotSerial++;
      for (let i = 0; i < count; i++) {
        const angle = pose.angle + (this.direction === 1 ? this.pitch : Math.PI - this.pitch) + (i - (count - 1) / 2) * .016;
        const ux = Math.cos(angle); const uy = Math.sin(angle);
        const x = mountX + ux * spec.muzzle; const y = mountY + uy * spec.muzzle;
        const shot: Projectile = { id: ++this.serial, weapon: this.id, upgradeLevel: level, x, y, previousX: x, previousY: y,
          vx: ux * spec.speed + pose.vx, vy: uy * spec.speed + pose.vy,
          age: 0, lifetime: this.id === 'laser-gun' ? .075 : 2.4, distance: 0,
          targetId: this.id === 'missile-launcher' ? aimed?.id : undefined };
        if (this.id === 'laser-gun') {
          const hit = this.sweep(shot, ux * spec.range, uy * spec.range, targets, floorHeight);
          shot.beamEndX = x + ux * spec.range * hit.t;
          shot.beamEndY = y + uy * spec.range * hit.t;
          if (hit.target) this.damage(hit.target, spec.damage, spec, shot.beamEndX, shot.beamEndY,
            ux, uy, targets, onDamage, onImpact);
          else if (hit.t < 1) {
            this.effect(shot.beamEndX, shot.beamEndY, .2, false, spec.color);
            this.reportImpact(shot.beamEndX, shot.beamEndY, ux, uy, 'terrain', false, onImpact);
          }
        }
        this.projectiles.push(shot);
      }
    }

    this.projectiles = this.projectiles.filter(shot => {
      const shotSpec = weaponSpec(shot.weapon, shot.upgradeLevel);
      shot.age += dt;
      if (shot.age > shot.lifetime) return false;
      if (shot.weapon === 'laser-gun') return true;
      shot.previousX = shot.x; shot.previousY = shot.y;
      if (shot.targetId) {
        const target = targets.find(target => target.id === shot.targetId && target.health > 0);
        if (target) {
          const angle = Math.atan2(shot.vy, shot.vx);
          const desired = Math.atan2(target.y - shot.y, target.x - shot.x);
          const difference = Math.atan2(Math.sin(desired - angle), Math.cos(desired - angle));
          const next = angle + clamp(difference, -2.8 * dt, 2.8 * dt);
          const speed = Math.hypot(shot.vx, shot.vy);
          shot.vx = Math.cos(next) * speed; shot.vy = Math.sin(next) * speed;
        }
      }
      const dx = shot.vx * dt; const dy = shot.vy * dt;
      const hit = this.sweep(shot, dx, dy, targets, floorHeight);
      shot.x += dx * hit.t; shot.y += dy * hit.t;
      shot.distance += Math.hypot(dx, dy);
      if (hit.target) this.damage(hit.target, shotSpec.damage, shotSpec, shot.x, shot.y,
        shot.vx, shot.vy, targets, onDamage, onImpact);
      else if (hit.t < 1) {
        this.effect(shot.x, shot.y, .3, false, shotSpec.color);
        this.reportImpact(shot.x, shot.y, shot.vx, shot.vy, 'terrain', false, onImpact);
      }
      return hit.t === 1 && !hit.target && shot.distance < shotSpec.range;
    });
  }

  private sweep(shot: Projectile, dx: number, dy: number, targets: CombatTarget[], floor: (x: number) => number): { t: number; target: CombatTarget | null } {
    let t = 1; let first: CombatTarget | null = null;
    const radius = weaponSpec(shot.weapon).radius;
    for (const target of targets) {
      if (target.health <= 0) continue;
      const hit = intersection(shot.x, shot.y, dx, dy, target, radius);
      if (hit !== null && hit <= t) { t = hit; first = target; }
    }
    const samples = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .4));
    for (let i = 1; i <= samples; i++) {
      const fraction = i / samples;
      if (fraction >= t) break;
      if (shot.y + dy * fraction < floor(shot.x + dx * fraction)) {
        let low = (i - 1) / samples; let high = fraction;
        for (let iteration = 0; iteration < 9; iteration++) {
          const middle = (low + high) * .5;
          if (shot.y + dy * middle < floor(shot.x + dx * middle)) high = middle;
          else low = middle;
        }
        t = high; first = null; break;
      }
    }
    return { t, target: first };
  }

  private damage(target: CombatTarget, amount: number, spec: WeaponSpec, x: number, y: number,
    vx: number, vy: number, targets: CombatTarget[], onDamage: (target: CombatTarget, damage: number) => void,
    onImpact: (impact: WeaponImpact) => void): void {
    for (const victim of targets) {
      if (victim.health <= 0 || (victim !== target && (!spec.splash || Math.hypot(victim.x - x, victim.y - y) > spec.splash + victim.radius))) continue;
      const dealt = victim === target ? amount : Math.max(1, Math.round(amount * .6));
      const remaining = victim.health - dealt;
      victim.health = remaining <= 1e-9 ? 0 : remaining;
      onDamage(victim, dealt);
      this.hitSerial++;
      if (victim.health === 0) this.destroySerial++;
      this.reportImpact(victim === target ? x : victim.x, victim === target ? y : victim.y,
        vx, vy, victim.kind, victim.health === 0, onImpact);
      this.effect(victim.x, victim.y, victim.health === 0 ? Math.max(.9, spec.splash) : .35, victim.health === 0, spec.color);
    }
  }

  private reportImpact(x: number, y: number, vx: number, vy: number, surface: WeaponImpact['surface'],
    destroyed: boolean, onImpact: (impact: WeaponImpact) => void): void {
    const speed = Math.hypot(vx, vy) || 1;
    onImpact({ x, y, directionX: vx / speed, directionY: vy / speed, surface, destroyed });
  }

  private effect(x: number, y: number, size: number, destroyed: boolean, color: string): void {
    this.effects.push({ id: ++this.serial, x, y, age: 0, size, destroyed, color });
    if (this.effects.length > 40) this.effects.shift();
  }

  snapshot(alpha = 1): WeaponSnapshot {
    const level = this.upgrades.get(this.id) ?? 0;
    const spec = weaponSpec(this.id, level);
    return { id: this.id, level, ammo: this.ammoFor(this.id), capacity: spec.ammo,
      yaw: this.previousYaw + (this.yaw - this.previousYaw) * alpha, pitch: this.pitch, direction: this.direction,
      turnRemaining: Math.abs((this.direction === 1 ? 0 : Math.PI) - this.yaw) / Math.PI * spec.turnSeconds,
      cooldown: this.cooldown, recoil: this.recoil, shotSerial: this.shotSerial,
      hitSerial: this.hitSerial, destroySerial: this.destroySerial,
      projectiles: this.projectiles.map(shot => ({ ...shot, x: shot.previousX + (shot.x - shot.previousX) * alpha,
        y: shot.previousY + (shot.y - shot.previousY) * alpha })), effects: this.effects.map(effect => ({ ...effect })) };
  }
}
