export type PoliceMode = 'chasing' | 'bypassing' | 'rejoining' | 'intercepting';
interface PursuitTarget { x: number; speed: number }
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The patrol has its own road position while the player circles a loop. */
export class PolicePursuit {
  idleSeconds = 0;
  gap = 30;
  visibility = 0;
  x: number;
  mode: PoliceMode = 'chasing';
  private roadSpeed = 14;
  private bypassSpeed = 14;
  private regroupDistance = 8;
  private engaged = false;
  private loopSpeed: number | null = null;
  private disabledSeconds = 0;
  private yielding = false;

  get disabled(): boolean { return this.disabledSeconds > 0; }
  disable(seconds: number): void {
    this.disabledSeconds = seconds;
    this.engaged = false;
    this.idleSeconds = 0;
    this.roadSpeed = Math.min(this.roadSpeed, 4);
    this.yielding = false;
  }

  constructor(startX = 7) { this.x = startX - this.gap; }

  beginLoop(carX: number, speed: number): void {
    this.loopSpeed = speed;
    if (this.disabled) return;
    // An absent patrol must not silently pass the player during a loop and
    // later materialize ahead when the no-boost warning begins.
    if (!this.engaged && this.visibility <= 0.01 && this.idleSeconds <= 10) return;
    this.engaged = true;
    this.bypassLoop(carX, speed);
  }

  private bypassLoop(carX: number, speed: number): void {
    if (this.mode === 'chasing') this.x = carX - this.gap;
    this.mode = 'bypassing';
    this.bypassSpeed = clamp(speed + (this.idleSeconds >= 12 ? 2.6 : 0), 8, 23);
    this.roadSpeed = this.bypassSpeed;
    this.regroupDistance = 8;
  }

  finishLoop(completed: boolean): void {
    this.loopSpeed = null;
    // Keep driving along the road after either kind of exit. Once ahead, the
    // patrol keeps yielding until the player has passed it with room to spare.
    if (this.mode === 'bypassing') this.mode = completed ? 'rejoining' : 'intercepting';
  }

  afterImpact(): void {
    this.mode = 'rejoining';
    this.regroupDistance = 12;
  }

  update(dt: number, boosting: boolean, target: PursuitTarget): void {
    if (this.disabled) {
      this.disabledSeconds = Math.max(0, this.disabledSeconds - dt);
      this.idleSeconds = 0;
      this.x += this.roadSpeed * dt;
      this.gap = target.x - this.x;
      this.visibility *= Math.exp(-dt * 4);
      if (!this.disabled) {
        this.visibility = 0;
        this.gap = 30;
        this.x = target.x - this.gap;
        this.mode = 'chasing';
        this.yielding = false;
      }
      return;
    }
    this.idleSeconds = boosting ? 0 : this.idleSeconds + dt;
    if (!this.engaged && this.idleSeconds > 10) {
      if (this.visibility <= 0.01) {
        // Every new pursuit starts behind, with two seconds of warning before
        // closing. A visible patrol already bypassing a loop stays continuous.
        this.gap = 30;
        this.x = target.x - this.gap;
        this.mode = 'chasing';
        if (this.loopSpeed !== null) this.bypassLoop(target.x, this.loopSpeed);
      }
      this.engaged = true;
    }
    if (!this.engaged && this.visibility <= 0.01) {
      this.mode = 'chasing';
      this.gap = 30;
      this.yielding = false;
    }
    if ((this.engaged || this.visibility > 0.01) && this.x > target.x) {
      this.yielding = true;
      if (this.mode === 'chasing') {
        this.mode = 'rejoining';
        this.regroupDistance = 8;
      }
    }
    if (this.mode === 'chasing') {
      if (boosting) this.gap = Math.min(30, this.gap + dt * 10);
      else if (this.idleSeconds >= 12) this.gap = Math.max(3.5, this.gap - dt * 2.6);
      else this.gap = Math.min(30, this.gap + dt * 2);
      const nextX = target.x - this.gap;
      this.roadSpeed = clamp((nextX - this.x) / dt, 0, 23);
      this.x = nextX;
    } else {
      const desired = this.yielding || this.mode === 'rejoining' ? clamp(target.speed * 0.35, 4, 8) : this.bypassSpeed;
      this.roadSpeed += clamp(desired - this.roadSpeed, -20 * dt, 8 * dt);
      this.x += Math.max(0, this.roadSpeed) * dt;
      this.gap = target.x - this.x;
      if (this.mode !== 'bypassing' && this.gap >= this.regroupDistance) {
        this.mode = 'chasing';
        this.yielding = false;
      }
    }
    if (this.mode === 'chasing' && this.gap >= 29 && this.idleSeconds < 10) this.engaged = false;
    this.visibility += ((this.engaged ? 1 : 0) - this.visibility) * (1 - Math.exp(-dt * 1.4));
  }

  get pressure(): number {
    return this.visibility * (0.2 + 0.8 * clamp((30 - Math.abs(this.gap)) / 26.5, 0, 1));
  }
}
