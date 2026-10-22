import { CAR_SUSPENSION_TRAVEL, CAR_WHEEL_OFFSET } from './vehicle';

interface SuspensionInput {
  grounded: boolean;
  normalAcceleration: number;
  roadAngularAcceleration: number;
  forwardAcceleration: number;
  suction: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const INERTIA = 1.30;
const CG_HEIGHT = 0.44;
const FRONT_RATE = 29;
const REAR_RATE = 26;

/** Two sprung axles drive body heave and pitch. Rates are normalized by sprung
 * mass, with lighter compression damping and slower, controlled rebound.
 * Contact/drive stay in the stable tire frame; the sprung body retains inertia.
 */
export class VehicleSuspension {
  offset = 0;
  pitch = 0;
  private velocity = 0;
  private pitchVelocity = 0;
  private normalAcceleration = 0;
  private angularAcceleration = 0;
  private forwardAcceleration = 0;

  takeoff(): void {
    this.velocity += 0.22;
  }

  land(impact: number, angleError: number, penetration: number, angularVelocity = 0): void {
    // Preserve a little of the incoming body pose, then absorb impact over the
    // stroke rather than flattening the spring at the moment tires touch down.
    this.offset += clamp(penetration, -0.035, 0.035);
    this.pitch += angleError;
    // Retain part of the sprung body's incoming normal and angular momentum.
    // A harder landing spends more of the available stroke instead of giving
    // every touchdown the same small kick.
    this.velocity -= clamp(impact * 0.20, 0, 3.6);
    this.pitchVelocity += clamp(angularVelocity * 0.45, -1.2, 1.2);
    this.limitStroke();
  }

  update(input: SuspensionInput, dt: number): void {
    const filter = 1 - Math.exp(-dt * 24);
    this.normalAcceleration += (clamp(input.normalAcceleration, -30, 36) - this.normalAcceleration) * filter;
    this.angularAcceleration += (clamp(input.roadAngularAcceleration, -14, 14) - this.angularAcceleration) * filter;
    this.forwardAcceleration += (clamp(input.forwardAcceleration, -10, 14) - this.forwardAcceleration) * filter;

    const lever = CAR_WHEEL_OFFSET;
    const rotation = Math.sin(this.pitch) * lever;
    const rotationVelocity = Math.cos(this.pitch) * lever * this.pitchVelocity;
    const frontTravel = this.offset + rotation;
    const rearTravel = this.offset - rotation;
    // The wheels droop gently when unloaded in flight.
    const rest = input.grounded ? 0 : 0.055;
    const front = this.axleForce(frontTravel, this.velocity + rotationVelocity, FRONT_RATE, rest, input.grounded);
    const rear = this.axleForce(rearTravel, this.velocity - rotationVelocity, REAR_RATE, rest, input.grounded);
    const roadLoad = input.grounded ? this.normalAcceleration + (input.suction ? 3.8 : 0) : 0;
    const roadRotation = input.grounded ? this.angularAcceleration : 0;
    const weightTransfer = this.forwardAcceleration * CG_HEIGHT * (input.grounded ? 1 : 0.24);
    this.velocity += (front + rear - roadLoad) * dt;
    this.pitchVelocity += ((front - rear) * lever / INERTIA + weightTransfer / INERTIA - roadRotation) * dt;
    this.offset += this.velocity * dt;
    this.pitch += this.pitchVelocity * dt;
    this.limitStroke();
  }

  private axleForce(travel: number, velocity: number, rate: number, rest: number, grounded: boolean): number {
    const displacement = travel - rest;
    const damping = grounded ? (velocity < 0 ? 3.4 : 5.4) : 4.4;
    // Progressive rubber stops cushion the last part of the stroke. The hard
    // limit below is only a final guard against extreme landing impulses.
    const endTravel = Math.max(0, Math.abs(travel) - 0.115);
    const bumpStop = Math.sign(travel) * endTravel * endTravel * 4500;
    const stopDamping = endTravel * 120 * velocity;
    return -rate * displacement - damping * velocity - bumpStop - stopDamping;
  }

  private limitStroke(): void {
    const lever = CAR_WHEEL_OFFSET;
    const rotation = Math.sin(this.pitch) * lever;
    const front = this.offset + rotation;
    const rear = this.offset - rotation;
    const limitedFront = clamp(front, -CAR_SUSPENSION_TRAVEL, CAR_SUSPENSION_TRAVEL);
    const limitedRear = clamp(rear, -CAR_SUSPENSION_TRAVEL, CAR_SUSPENSION_TRAVEL);
    if (front === limitedFront && rear === limitedRear) return;
    let frontVelocity = this.velocity + lever * this.pitchVelocity;
    let rearVelocity = this.velocity - lever * this.pitchVelocity;
    if (front !== limitedFront && Math.sign(frontVelocity) === Math.sign(front)) frontVelocity *= 0.04;
    if (rear !== limitedRear && Math.sign(rearVelocity) === Math.sign(rear)) rearVelocity *= 0.04;
    this.offset = (limitedFront + limitedRear) * 0.5;
    this.pitch = Math.asin((limitedFront - limitedRear) / (2 * lever));
    this.velocity = (frontVelocity + rearVelocity) * 0.5;
    this.pitchVelocity = (frontVelocity - rearVelocity) / (2 * lever);
  }
}
