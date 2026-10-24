export const MAX_HEALTH = 100;
export const IMPACT_DAMAGE = 25;
export const IMPACT_PAUSE_SECONDS = 0.5;
export const EXPLOSION_PAUSE_SECONDS = 0.03;
export const HIT_RECOVERY_SECONDS = 0.8;
export const RESTART_DELAY_SECONDS = 3;
export const WRECK_TIME_SCALE = 0.25;
export const INVINCIBLE_SECONDS = 1.5;

export function vehicleDamageStage(health: number): 0 | 1 | 2 | 3 | 4 {
  return Math.min(4, Math.max(0, Math.floor((MAX_HEALTH - health) / IMPACT_DAMAGE))) as 0 | 1 | 2 | 3 | 4;
}

/** Damage and protection use simulation time, so pausing cannot spend immunity. */
export class VehicleDamage {
  health = MAX_HEALTH;
  impactSerial = 0;
  invincibilityRemaining = 0;

  get invincible(): boolean { return this.invincibilityRemaining > 0; }

  step(dt: number): void {
    this.invincibilityRemaining = Math.max(0, this.invincibilityRemaining - dt);
    if (this.invincibilityRemaining < 1e-9) this.invincibilityRemaining = 0;
  }

  hit(): boolean {
    if (this.health === 0 || this.invincible) return false;
    this.health = Math.max(0, this.health - IMPACT_DAMAGE);
    this.impactSerial++;
    this.invincibilityRemaining = INVINCIBLE_SECONDS;
    return true;
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

export function carVisibleDuringProtection(remaining: number, frozen: boolean): boolean {
  return frozen || remaining <= 0 || Math.floor((INVINCIBLE_SECONDS - remaining) * 8) % 2 === 0;
}
