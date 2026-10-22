export const MAX_HEALTH = 100;
export const IMPACT_DAMAGE = 25;
export const IMPACT_PAUSE_SECONDS = 0.5;
export const INVINCIBLE_SECONDS = 1.5;

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

/** Wall-clock hit stop. Return only the unfrozen part of a display frame. */
export class ImpactPause {
  remaining = 0;
  get active(): boolean { return this.remaining > 0; }
  start(): void { this.remaining = IMPACT_PAUSE_SECONDS; }
  reset(): void { this.remaining = 0; }
  consume(elapsed: number): number {
    const frozen = Math.min(this.remaining, Math.max(0, elapsed));
    this.remaining = Math.max(0, this.remaining - frozen);
    if (this.remaining < 1e-9) this.remaining = 0;
    return Math.max(0, elapsed - frozen);
  }
}

export function carVisibleDuringProtection(remaining: number, frozen: boolean): boolean {
  return frozen || remaining <= 0 || Math.floor((INVINCIBLE_SECONDS - remaining) * 8) % 2 === 0;
}
