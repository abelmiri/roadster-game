import { CAR_AXLE_Y, CAR_SUSPENSION_TRAVEL, CAR_WHEEL_OFFSET, CAR_WHEEL_RADIUS } from './vehicle';

export const ROAD_GRAVITY = 22;
export const SUCTION_ACCELERATION = 68;
export const SUCTION_RANGE = 2.4;
const INERTIA = 1.3;
const DROOP = 0.075;
const COMPRESSION = CAR_SUSPENSION_TRAVEL - 0.005;
const SPRING_RATE = 148;
const SUBSTEPS = 4;
const LANDING_GRIP_SECONDS = 0.28;
const MAX_LANDING_SPEED_LOSS = 0.8;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface ContactBody {
  x: number; y: number; angle: number;
  vx: number; vy: number; omega: number;
}

export interface WheelState {
  x: number; y: number; angle: number;
  grounded: boolean;
  travel: number;
  load: number;
  impact: number;
  impactSerial: number;
  energyLost: number;
}

interface Surface {
  height(x: number): number; slope(x: number): number; exists(x: number): boolean;
  sample?(x: number, result: { height: number; slope: number }): void;
}
interface Sample {
  x: number; y: number; nx: number; ny: number;
  lever: number; clearance: number; normalVelocity: number;
}

/** A sprung chassis with two unilateral, compliant tire contacts. Each axle
 * transmits its own spring/damper load and collision impulse to the body.
 * No road tangent or supported height is imposed on the chassis.
 */
export class WheelContactPhysics {
  readonly wheels: [WheelState, WheelState] = [0, 1].map(() => ({
    x: 0, y: 0, angle: 0, grounded: false, travel: -DROOP, load: 0,
    impact: 0, impactSerial: 0, energyLost: 0,
  })) as [WheelState, WheelState];
  suction = 0;
  undershot = false;
  private readonly spinning = [0, 0];
  private readonly touching = [false, false];
  private readonly samples: [Sample, Sample] = [0, 1].map(() => ({
    x: 0, y: 0, nx: 0, ny: 1, lever: 0, clearance: 0, normalVelocity: 0,
  })) as [Sample, Sample];
  private readonly roadSample = { height: 0, slope: 0 };
  private sampledAngle = NaN;
  private sin = 0;
  private cos = 1;
  private jumpLeveling = false;
  private jumpAirborne = false;
  private airborneTime = 0;
  private landingRemaining = 0;
  private landingSpeed = 0;
  private landingLoss = 0;

  constructor(private readonly surface: Surface) {}

  beginJump(body: ContactBody, stabilize = true): void {
    // Balanced jump jets cancel inherited tire/road spin at the centre of
    // mass. Keep the actual pitch; the airborne controller levels it gently.
    if (stabilize) body.omega = 0;
    this.jumpLeveling = stabilize;
    this.jumpAirborne = false;
    this.landingRemaining = this.airborneTime = 0;
  }

  release(body: ContactBody, wheelAngle: number): void {
    this.jumpLeveling = false;
    this.jumpAirborne = false;
    this.landingRemaining = this.airborneTime = 0;
    for (let index = 0; index < 2; index++) {
      this.touching[index] = false;
      this.wheels[index].grounded = false;
      this.wheels[index].load = 0;
      this.wheels[index].angle = wheelAngle;
      this.spinning[index] = -Math.hypot(body.vx, body.vy) / CAR_WHEEL_RADIUS;
    }
    this.sync(body);
  }

  hasContact(body: ContactBody): boolean {
    for (let index = 0; index < 2; index++) {
      const sample = this.sample(body, index);
      if (sample !== null && sample.clearance < DROOP && sample.clearance > -COMPRESSION - 0.03) return true;
    }
    return false;
  }

  private sample(body: ContactBody, index: number): Sample | null {
    const offset = index ? CAR_WHEEL_OFFSET : -CAR_WHEEL_OFFSET;
    if (body.angle !== this.sampledAngle) {
      this.sampledAngle = body.angle;
      this.sin = Math.sin(body.angle); this.cos = Math.cos(body.angle);
    }
    const dx = offset * this.cos - CAR_AXLE_Y * this.sin;
    const dy = offset * this.sin + CAR_AXLE_Y * this.cos;
    const x = body.x + dx;
    if (!this.surface.exists(x)) return null;
    if (this.surface.sample) this.surface.sample(x, this.roadSample);
    else { this.roadSample.height = this.surface.height(x); this.roadSample.slope = this.surface.slope(x); }
    const slope = this.roadSample.slope;
    const ny = 1 / Math.hypot(1, slope);
    const nx = -slope * ny;
    const lever = dx * ny - dy * nx;
    const sample = this.samples[index];
    sample.x = x; sample.y = body.y + dy; sample.nx = nx; sample.ny = ny; sample.lever = lever;
    sample.clearance = (body.y + dy - this.roadSample.height) * ny - CAR_WHEEL_RADIUS;
    sample.normalVelocity = body.vx * nx + body.vy * ny + body.omega * lever;
    return sample;
  }

  /** Normal impulses include rotational effective mass, so an off-centre hit
   * turns the chassis rather than cancelling its entire vertical velocity.
   */
  private impulse(body: ContactBody, sample: Sample, amount: number): void {
    body.vx += sample.nx * amount;
    body.vy += sample.ny * amount;
    body.omega += sample.lever * amount / INERTIA;
  }

  step(initial: ContactBody, suctionHeld: boolean, dt: number, jumpJetActive = false): ContactBody {
    const body = { ...initial };
    const h = dt / SUBSTEPS;
    this.suction = 0;
    this.undershot = false;
    // Preserve the driver's current speed through touchdown, including any
    // deliberate drive deceleration, rather than restoring a stale boost speed.
    this.landingSpeed = Math.min(this.landingSpeed, initial.vx + this.landingLoss);
    if (!jumpJetActive) this.jumpLeveling = false;
    for (const wheel of this.wheels) { wheel.impact = 0; wheel.load = 0; }
    for (let step = 0; step < SUBSTEPS; step++) {
      const rearRoadBefore = this.sample(body, 0) !== null;
      const frontRoadBefore = this.sample(body, 1) !== null;
      let ax = 0;
      let ay = -ROAD_GRAVITY;
      let torque = 0;
      let attraction = 0;
      let roadAngle = 0;
      let nearby = 0;
      let supported = false;
      for (let index = 0; index < 2; index++) {
        const wheel = this.wheels[index];
        const sample = this.sample(body, index);
        const contact = sample !== null && sample.clearance <= DROOP;
        if (sample) {
          const distance = Math.max(0, sample.clearance);
          if (suctionHeld && distance < SUCTION_RANGE && sample.clearance > -0.6) {
            const pull = SUCTION_ACCELERATION * 0.5 * (1 - (distance / SUCTION_RANGE) ** 2);
            ax -= sample.nx * pull;
            ay -= sample.ny * pull;
            attraction += pull;
          }
          if (sample.clearance < 1.5) { roadAngle += Math.atan2(-sample.nx, sample.ny); nearby++; }
        }
        if (contact && sample) {
          const compression = DROOP - sample.clearance;
          const endTravel = Math.max(0, -sample.clearance - 0.09);
          // Rebound damping absorbs the spring's return after a touchdown.
          const damping = (sample.normalVelocity < 0 ? 10 : 24) + endTravel * 90;
          const spring = SPRING_RATE * compression + endTravel * endTravel * 7500;
          // Neither a tire nor its damper can pull the road upward.
          const load = Math.max(0, spring - damping * sample.normalVelocity);
          if (load > 0.5) supported = true;
          ax += sample.nx * load;
          ay += sample.ny * load;
          torque += sample.lever * load;
          wheel.load = load;
          wheel.energyLost += Math.max(0, (spring - load) * sample.normalVelocity * h);
          if (!this.touching[index] && sample.normalVelocity < -0.6) {
            const impact = -sample.normalVelocity;
            wheel.impactSerial++;
            wheel.impact = Math.max(wheel.impact, impact);
            if ((this.airborneTime >= 0.025 || impact > 4) && this.landingRemaining <= 0) {
              this.landingRemaining = LANDING_GRIP_SECONDS;
              this.landingSpeed = body.vx;
              this.landingLoss = 0;
            }
            const pitch = body.angle - Math.atan2(-sample.nx, sample.ny);
            const alignmentError = Math.abs(Math.atan2(Math.sin(pitch), Math.cos(pitch)));
            const severity = Math.max(clamp((alignmentError - 0.2) / 0.6, 0, 1), clamp((impact - 14) / 14, 0, 1));
            this.landingLoss = Math.max(this.landingLoss, MAX_LANDING_SPEED_LOSS * severity);
            // Aligned landings roll cleanly. A tilted or very hard impact has
            // a small scrub at each tire; vertical damping still absorbs energy.
            const tangentVelocity = body.vx * sample.ny - body.vy * sample.nx;
            const scrub = Math.sign(tangentVelocity) * Math.min(Math.abs(tangentVelocity), impact * 0.006, 0.12) * severity;
            body.vx -= sample.ny * scrub;
            body.vy += sample.nx * scrub;
            wheel.energyLost += Math.max(0, scrub * tangentVelocity - 0.5 * scrub * scrub);
          }
        } else {
          wheel.load = 0;
        }
        this.touching[index] = contact;
      }
      this.suction = Math.max(this.suction, attraction);
      if (this.jumpLeveling) {
        if (!supported) this.jumpAirborne = true;
        else if (this.jumpAirborne) this.jumpLeveling = false;
        if (this.jumpLeveling && !supported) {
          // Damped attitude control acts only during a requested
          // jump. It eases toward level without snapping or overshooting, and
          // yields as soon as either tire starts carrying a landing load.
          const pitch = Math.atan2(Math.sin(body.angle), Math.cos(body.angle));
          torque += INERTIA * clamp(-12 * pitch - 7 * body.omega, -9, 9);
        }
      }
      // Fans pull along the sampled road normals and assist pitch only within
      // their finite range. They never set a height, angle, or grounded flag.
      if (attraction && nearby) {
        const error = Math.atan2(Math.sin(roadAngle / nearby - body.angle), Math.cos(roadAngle / nearby - body.angle));
        torque += clamp(error * 20 - body.omega * 3, -18, 18) * attraction / SUCTION_ACCELERATION;
      }
      body.vx += ax * h;
      body.vy += ay * h;
      body.omega += torque / INERTIA * h;
      body.omega *= Math.exp(-0.65 * h);
      body.x += body.vx * h;
      body.y += body.vy * h;
      body.angle += body.omega * h;

      for (let index = 0; index < 2; index++) {
        const sample = this.sample(body, index);
        if (!(index ? frontRoadBefore : rearRoadBefore) && sample && sample.clearance < -COMPRESSION - 0.025) {
          this.undershot = true;
          this.sync(body, dt);
          return body;
        }
      }

      // Progressive stops resolve each tire independently. Swept substeps and
      // split position correction prevent a fast landing tunnelling through
      // the surface, without flattening the body or lifting an undershot gap.
      for (let iteration = 0; iteration < 4; iteration++) {
        let corrected = false;
        for (let index = 0; index < 2; index++) {
          const sample = this.sample(body, index);
          if (!sample || sample.clearance >= -COMPRESSION) continue;
          corrected = true;
          const effectiveMass = 1 + sample.lever ** 2 / INERTIA;
          const correction = (-sample.clearance - COMPRESSION) / effectiveMass;
          body.x += sample.nx * correction;
          body.y += sample.ny * correction;
          body.angle += sample.lever * correction / INERTIA;
          if (sample.normalVelocity < 0) {
            const impulse = -sample.normalVelocity / effectiveMass;
            this.impulse(body, sample, impulse);
            this.wheels[index].energyLost += sample.normalVelocity ** 2 / (2 * effectiveMass);
          }
        }
        if (!corrected) break;
      }
      if (this.landingRemaining > 0 && supported && nearby) {
        // Rolling grip carries forward momentum through the spring's short
        // settling stroke. Restore along the road tangent so this cannot add
        // a normal rebound or cancel either axle's independent pitch impulse.
        const carry = Math.max(0, this.landingSpeed - this.landingLoss - body.vx);
        body.vx += carry;
        body.vy += carry * Math.tan(roadAngle / nearby);
      }
      this.landingRemaining = Math.max(0, this.landingRemaining - h);
      this.airborneTime = supported ? 0 : this.airborneTime + h;
      if (this.airborneTime >= 0.025) this.landingRemaining = 0;
    }
    this.sync(body, dt);
    return body;
  }

  sync(body: ContactBody, dt = 0): void {
    for (let index = 0; index < 2; index++) {
      const wheel = this.wheels[index];
      const sample = this.sample(body, index);
      const offset = index ? CAR_WHEEL_OFFSET : -CAR_WHEEL_OFFSET;
      const alignment = sample ? Math.max(0.25, Math.cos(body.angle) * sample.ny - Math.sin(body.angle) * sample.nx) : 1;
      wheel.travel = sample ? clamp(-sample.clearance / alignment, -DROOP, COMPRESSION) : -DROOP;
      const axleY = CAR_AXLE_Y + wheel.travel;
      wheel.x = body.x + offset * Math.cos(body.angle) - axleY * Math.sin(body.angle);
      wheel.y = body.y + offset * Math.sin(body.angle) + axleY * Math.cos(body.angle);
      wheel.grounded = sample !== null && sample.clearance < DROOP - 0.002;
      if (wheel.grounded && sample) {
        this.spinning[index] = -(body.vx * sample.ny - body.vy * sample.nx) / CAR_WHEEL_RADIUS;
      } else {
        this.spinning[index] *= Math.exp(-0.12 * dt);
      }
      wheel.angle += this.spinning[index] * dt;
    }
  }
}
