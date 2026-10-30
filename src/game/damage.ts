import { carUpgradeLevel } from './carUpgrades';

export const MAX_HEALTH = 100;
export const IMPACT_DAMAGE = 25;
export const IMPACT_PAUSE_SECONDS = 0.5;
export const EXPLOSION_SLOWDOWN_SECONDS = 0.2;
export const EXPLOSION_RECOVERY_SECONDS = 1;
export const EXPLOSION_MIN_TIME_SCALE = 0.25;
export const RAGDOLL_SLOWDOWN_SECONDS = 0.28;
export const RAGDOLL_RECOVERY_SECONDS = 2.2;
export const RAGDOLL_MIN_TIME_SCALE = 0.14;
export const HIT_RECOVERY_SECONDS = 0.8;
export const RESTART_DELAY_SECONDS = 1;
export const WRECK_TIME_SCALE = 0.125;
export const INVINCIBLE_SECONDS = 1.5;

export function vehicleDamageStage(health: number): 0 | 1 | 2 | 3 | 4 {
  return Math.min(4, Math.max(0, Math.floor((MAX_HEALTH - health) / IMPACT_DAMAGE))) as 0 | 1 | 2 | 3 | 4;
}

/** Damage and protection use simulation time, so pausing cannot spend immunity. */
export class VehicleDamage {
  hullHealth = MAX_HEALTH;
  armorMask = 0;
  private armorLevel = 0;
  impactSerial = 0;
  invincibilityRemaining = 0;

  get invincible(): boolean { return this.invincibilityRemaining > 0; }
  get health(): number {
    let pieces = 0;
    for (let mask = this.armorMask; mask; mask >>= 1) pieces += mask & 1;
    return this.hullHealth + pieces * IMPACT_DAMAGE;
  }
  get maxHealth(): number { return MAX_HEALTH + this.armorLevel * IMPACT_DAMAGE; }

  constructor(armorLevel = 0) { this.upgradeArmor(armorLevel); }

  upgradeArmor(level: number): void {
    const next = carUpgradeLevel(level);
    if (next <= this.armorLevel) return;
    if (this.hullHealth > 0) for (let index = this.armorLevel; index < next; index++) this.armorMask |= 1 << index;
    this.armorLevel = next;
  }

  step(dt: number): void {
    this.invincibilityRemaining = Math.max(0, this.invincibilityRemaining - dt);
    if (this.invincibilityRemaining < 1e-9) this.invincibilityRemaining = 0;
  }

  hit(preferredArmor?: number): boolean {
    if (this.health === 0 || this.invincible) return false;
    if (this.armorMask) {
      const preferred = preferredArmor === undefined ? 0 : 1 << preferredArmor;
      const lost = this.armorMask & preferred ? preferred : this.armorMask & -this.armorMask;
      this.armorMask &= ~lost;
    } else this.hullHealth = Math.max(0, this.hullHealth - IMPACT_DAMAGE);
    this.impactSerial++;
    this.invincibilityRemaining = INVINCIBLE_SECONDS;
    return true;
  }

  restoreUnit(): number {
    if (this.health === 0 || this.health >= this.maxHealth) return 0;
    const previous = this.health;
    if (this.hullHealth < MAX_HEALTH) {
      this.hullHealth = Math.min(MAX_HEALTH, this.hullHealth + IMPACT_DAMAGE);
    } else {
      const missing = ((1 << this.armorLevel) - 1) & ~this.armorMask;
      this.armorMask |= missing & -missing;
    }
    return this.health - previous;
  }
}

/** Wall-clock hit stop followed by a smoothstep return to normal speed.
 * Integrating the curve makes simulation time independent of display rate. */
export class ImpactPause {
  remaining = 0;
  private recoveryElapsed = HIT_RECOVERY_SECONDS;
  get active(): boolean { return this.remaining > 0; }
  get recovering(): boolean { return !this.active && this.recoveryElapsed < HIT_RECOVERY_SECONDS; }
  get timeScale(): number {
    const t = this.recoveryElapsed / HIT_RECOVERY_SECONDS;
    return this.active ? 0 : t * t * (3 - 2 * t);
  }
  start(duration = IMPACT_PAUSE_SECONDS): void {
    this.remaining = Math.max(this.remaining, duration);
    this.recoveryElapsed = 0;
  }
  reset(): void { this.remaining = 0; this.recoveryElapsed = HIT_RECOVERY_SECONDS; }
  consume(elapsed: number): number {
    const frozen = Math.min(this.remaining, Math.max(0, elapsed));
    this.remaining = Math.max(0, this.remaining - frozen);
    if (this.remaining < 1e-9) this.remaining = 0;
    const unfrozen = Math.max(0, elapsed - frozen);
    const recovering = Math.min(unfrozen, HIT_RECOVERY_SECONDS - this.recoveryElapsed);
    const before = this.recoveryElapsed / HIT_RECOVERY_SECONDS;
    this.recoveryElapsed = Math.min(HIT_RECOVERY_SECONDS, this.recoveryElapsed + recovering);
    if (HIT_RECOVERY_SECONDS - this.recoveryElapsed < 1e-9) this.recoveryElapsed = HIT_RECOVERY_SECONDS;
    const after = this.recoveryElapsed / HIT_RECOVERY_SECONDS;
    const integral = (t: number): number => t ** 3 - 0.5 * t ** 4;
    return unfrozen - recovering + HIT_RECOVERY_SECONDS * (integral(after) - integral(before));
  }
}

/** Explosions dip into slow motion without freezing. Both eased phases use
 * wall time and an exact integral, including frames crossing phase boundaries. */
export class ExplosionSlowMotion {
  private elapsed: number;
  private entryScale = 1;

  constructor(private readonly slowdownSeconds = EXPLOSION_SLOWDOWN_SECONDS,
    private readonly recoverySeconds = EXPLOSION_RECOVERY_SECONDS,
    private readonly minTimeScale = EXPLOSION_MIN_TIME_SCALE) {
    this.elapsed = slowdownSeconds + recoverySeconds;
  }

  get active(): boolean { return this.elapsed < this.slowdownSeconds + this.recoverySeconds; }
  get timeScale(): number {
    const slowing = this.elapsed < this.slowdownSeconds;
    const t = slowing ? this.elapsed / this.slowdownSeconds
      : Math.min(1, (this.elapsed - this.slowdownSeconds) / this.recoverySeconds);
    const eased = t * t * (3 - 2 * t);
    return slowing ? this.entryScale + (this.minTimeScale - this.entryScale) * eased
      : this.minTimeScale + (1 - this.minTimeScale) * eased;
  }

  start(): void {
    // A second explosion deepens the current effect without jumping to full speed.
    this.entryScale = this.timeScale;
    this.elapsed = 0;
  }
  reset(): void {
    this.elapsed = this.slowdownSeconds + this.recoverySeconds;
    this.entryScale = 1;
  }
  consume(elapsed: number): number {
    const dt = Math.max(0, elapsed);
    if (!this.active) return dt;
    const before = this.elapsed;
    this.elapsed = Math.min(this.slowdownSeconds + this.recoverySeconds, before + dt);
    if (this.slowdownSeconds + this.recoverySeconds - this.elapsed < 1e-9) {
      this.elapsed = this.slowdownSeconds + this.recoverySeconds;
    }
    return dt - (this.elapsed - before) + this.integral(this.elapsed) - this.integral(before);
  }

  private integral(elapsed: number): number {
    const primitive = (t: number): number => t ** 3 - 0.5 * t ** 4;
    const down = Math.min(elapsed, this.slowdownSeconds);
    const up = Math.max(0, elapsed - this.slowdownSeconds);
    return this.entryScale * down + (this.minTimeScale - this.entryScale)
      * this.slowdownSeconds * primitive(down / this.slowdownSeconds)
      + this.minTimeScale * up + (1 - this.minTimeScale)
      * this.recoverySeconds * primitive(up / this.recoverySeconds);
  }
}

export function carVisibleDuringProtection(remaining: number, frozen: boolean): boolean {
  return frozen || remaining <= 0 || Math.floor((INVINCIBLE_SECONDS - remaining) * 8) % 2 === 0;
}
