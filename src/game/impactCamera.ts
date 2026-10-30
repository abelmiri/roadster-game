import type { SparkEvent } from './impactSparks';

export const VIEW_HALF_HEIGHT = 10.8 * 1.2;
export const CAMERA_LOOK_AHEAD = 0.27 * 1.2;
export const IMPACT_ZOOM = 1.7;
export const CRASH_ZOOM = 1.5;
const CRASH_TRANSITION = 2;
const ATTACK = .085;
const HOLD = .42;
const RELEASE = .65;
const RAM_LEAD = 8;
const RAM_ATTACK = .4;
const RAM_HOLD = .5;
const RAM_RELEASE = .95;
const smooth = (t: number): number => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/** Uses display time so the camera can frame a frozen collision. Bullet
 * sparks never retrigger this camera move during sustained firing. */
export class ImpactCamera {
  private attack = ATTACK;
  private hold = HOLD;
  private release = RELEASE;
  private age = ATTACK + HOLD + RELEASE;
  private serial = 0;
  private ragdollSerial = 0;
  private wasCrashed = false;
  private contact = { x: 0, y: 0 };
  private crashFocus: { x: number; y: number } | null = null;
  private crashAge = 0;
  private crashEntryZoom = 1;
  private crashEntryAmount = 0;

  get amount(): number {
    if (this.crashFocus) return this.crashEntryAmount + (1 - this.crashEntryAmount) * smooth(this.crashAge / CRASH_TRANSITION);
    if (this.age < this.attack) return smooth(this.age / this.attack);
    if (this.age < this.attack + this.hold) return 1;
    return 1 - smooth((this.age - this.attack - this.hold) / this.release);
  }
  get zoom(): number {
    if (this.crashFocus) return this.crashEntryZoom + (CRASH_ZOOM - this.crashEntryZoom) * smooth(this.crashAge / CRASH_TRANSITION);
    return 1 + (IMPACT_ZOOM - 1) * this.amount;
  }

  update(events: readonly SparkEvent[], serial: number, crashed: boolean, delta: number, animate = true,
    crashPosition?: { x: number; y: number }, ragdollSerial = this.ragdollSerial): void {
    if (serial < this.serial || (this.wasCrashed && !crashed)) {
      this.age = this.attack + this.hold + this.release;
      this.crashFocus = null;
    }
    const entryZoom = this.zoom;
    const entryAmount = this.amount;
    let newContact: { x: number; y: number } | undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.serial <= this.serial) break;
      if ((!event.kind || event.kind === 'collision') && (!crashed || !this.wasCrashed)) {
        this.contact = { x: event.x, y: event.y };
        newContact = this.contact;
        this.attack = ATTACK; this.hold = HOLD; this.release = RELEASE;
        this.age = 0;
        break;
      }
    }
    if (crashed && !this.wasCrashed) {
      this.crashFocus = { ...(crashPosition ?? newContact ?? this.contact) };
      this.crashAge = 0;
      this.crashEntryZoom = entryZoom;
      this.crashEntryAmount = entryAmount;
    }
    if (ragdollSerial > this.ragdollSerial && crashPosition && !crashed) {
      // Frame ahead of the car so the people it is launching stay in view.
      this.contact = { x: crashPosition.x + RAM_LEAD, y: crashPosition.y };
      newContact = this.contact;
      // Ramming people eases in and out more gently than hitting objects.
      // Resume from the current zoom level so repeated hits never snap it back.
      const level = this.crashFocus ? 0 : this.amount;
      this.attack = RAM_ATTACK; this.hold = RAM_HOLD; this.release = RAM_RELEASE;
      this.age = RAM_ATTACK * level;
    }
    this.ragdollSerial = ragdollSerial;
    this.serial = serial;
    this.wasCrashed = crashed;
    if (animate) {
      if (this.crashFocus) this.crashAge += Math.max(0, delta);
      else this.age += Math.max(0, delta);
    }
  }

  focus(car: { x: number; y: number }): { x: number; y: number } {
    if (this.crashFocus) return { ...this.crashFocus };
    return { x: (car.x + this.contact.x) * .5, y: (car.y + this.contact.y) * .5 };
  }
}
