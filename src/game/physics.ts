import RAPIER from '@dimforge/rapier2d-compat';
import type { Collider, EventQueue, RigidBody, World } from '@dimforge/rapier2d-compat';
import { CHUNK_LENGTH, TrackGenerator, roadHeight, roadSlope, type HazardSpec, type TrackChunk } from './track';
import { CAR_AXLE_Y, CAR_BODY_CLEARANCE, CAR_WHEEL_OFFSET, CAR_WHEEL_RADIUS } from './vehicle';
import { VehicleSuspension } from './suspension';

export const FIXED_STEP = 1 / 120;

export interface Controls {
  jumpPressed: boolean;
  jumpHeld: boolean;
  suction: boolean;
  boost: boolean;
}

export interface BodyPose { x: number; y: number; angle: number }
export interface GameSnapshot {
  car: BodyPose;
  wheels: [BodyPose, BodyPose];
  distance: number;
  speed: number;
  boost: number;
  grounded: boolean;
  suctionActive: boolean;
  boostActive: boolean;
  suspensionOffset: number;
  suspensionPitch: number;
  jumpSerial: number;
  jumpsUsed: number;
  landingSerial: number;
  landingImpact: number;
  crashed: boolean;
}

interface ActiveHazard {
  spec: HazardSpec;
  body: RigidBody;
  collider: Collider;
  x: number;
  y: number;
}

interface ActiveChunk {
  spec: TrackChunk;
  roads: Collider[];
  hazards: ActiveHazard[];
}

interface RoadSupport { y: number; angle: number; contacts: number }

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const GRAVITY = 22;

export class GamePhysics {
  readonly generator = new TrackGenerator();
  readonly chunks = new Map<number, ActiveChunk>();
  readonly world: World;
  readonly car: RigidBody;
  readonly wheels: [RigidBody, RigidBody];
  private readonly events: EventQueue;
  private readonly carColliders = new Set<number>();
  private readonly hazardColliders = new Set<number>();
  private previous: [BodyPose, BodyPose, BodyPose];
  private current: [BodyPose, BodyPose, BodyPose];
  private time = 0;
  private groundGrace = 0;
  private jumpLock = 0;
  private jumpHoldTime = 0;
  private jumpCount = 0;
  private charge = 1;
  private isGrounded = false;
  private fansOn = false;
  private boostOn = false;
  private wheelAngle = 0;
  private crestCooldown = 0;
  private readonly suspension = new VehicleSuspension();
  private previousSuspensionOffset = 0;
  private previousSuspensionPitch = 0;
  private previousSpeed = 11.2;
  private jumpSerial = 0;
  private landingSerial = 0;
  private landingImpact = 0;
  crashed = false;

  constructor(private readonly startX = 7) {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY });
    this.world.timestep = FIXED_STEP;
    this.events = new RAPIER.EventQueue(true);

    const support = this.roadSupport(startX);
    const startY = support?.y ?? roadHeight(startX) + CAR_BODY_CLEARANCE;
    const startAngle = support?.angle ?? 0;
    this.car = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(startX, startY)
        .setRotation(startAngle)
        .setLinearDamping(0)
        .setAngularDamping(2)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    const shell = this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(1.73, 0.25, 0.08).setTranslation(0, 0.10)
        .setDensity(1.25).setSensor(true)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.car,
    );
    this.carColliders.add(shell.handle);

    const wheels: RigidBody[] = [];
    for (const offset of [-CAR_WHEEL_OFFSET, CAR_WHEEL_OFFSET]) {
      const wheel = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(startX + offset, startY + CAR_AXLE_Y)
          .setLinearDamping(0)
          .setAngularDamping(0)
          .setCanSleep(false)
          .setCcdEnabled(true),
      );
      const tire = this.world.createCollider(
        RAPIER.ColliderDesc.ball(CAR_WHEEL_RADIUS).setDensity(0.8).setSensor(true)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        wheel,
      );
      this.carColliders.add(tire.handle);
      this.world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: offset, y: CAR_AXLE_Y }, { x: 0, y: 0 }),
        this.car,
        wheel,
        true,
      ).setContactsEnabled(false);
      wheels.push(wheel);
    }
    this.wheels = wheels as [RigidBody, RigidBody];

    this.car.setLinvel({ x: 11.2, y: 11.2 * Math.tan(startAngle) }, true);
    this.isGrounded = support !== null;
    this.setGravity(this.isGrounded ? 0 : 1);
    this.syncWheels();
    this.ensureChunks(startX);
    this.current = this.readPoses();
    this.previous = this.current.map((pose) => ({ ...pose })) as [BodyPose, BodyPose, BodyPose];
  }

  private readPoses(): [BodyPose, BodyPose, BodyPose] {
    return [this.car, ...this.wheels].map((body) => {
      const position = body.translation();
      return { x: position.x, y: position.y, angle: body.rotation() };
    }) as [BodyPose, BodyPose, BodyPose];
  }

  /** Sample the two tire contact points on the continuous track curve.
   * Road support is solved here instead of allowing polygon edges and rigid axles
   * to inject energy into each other on landing. Rapier integrates the airborne
   * assembly and detects hazard overlaps; ground contact removes normal velocity.
   */
  private roadSupport(x: number): RoadSupport | null {
    let angle = Math.atan(roadSlope(x));
    let contacts = 0;
    let y = 0;
    for (let iteration = 0; iteration < 3; iteration++) {
      const points = [-CAR_WHEEL_OFFSET, CAR_WHEEL_OFFSET].map((offset) => {
        const wheelX = x + offset * Math.cos(angle) - CAR_AXLE_Y * Math.sin(angle);
        return { offset, x: wheelX, h: roadHeight(wheelX), valid: this.generator.hasRoad(wheelX) };
      }).filter((point) => point.valid);
      contacts = points.length;
      if (!contacts) return null;
      if (contacts === 2) {
        angle = Math.atan2(points[1].h - points[0].h, points[1].x - points[0].x);
      } else {
        angle = Math.atan(roadSlope(points[0].x));
      }
      y = Math.max(...points.map((point) => point.h + CAR_WHEEL_RADIUS -
        point.offset * Math.sin(angle) - CAR_AXLE_Y * Math.cos(angle)));
    }
    return { y, angle, contacts };
  }

  private setGravity(scale: number): void {
    for (const body of [this.car, ...this.wheels]) body.setGravityScale(scale, true);
  }

  private syncWheels(): void {
    const p = this.car.translation();
    const v = this.car.linvel();
    const angle = this.car.rotation();
    const omega = this.car.angvel();
    this.wheels.forEach((wheel, index) => {
      const offset = index === 0 ? -CAR_WHEEL_OFFSET : CAR_WHEEL_OFFSET;
      const dx = offset * Math.cos(angle) - CAR_AXLE_Y * Math.sin(angle);
      const dy = offset * Math.sin(angle) + CAR_AXLE_Y * Math.cos(angle);
      wheel.setTranslation({ x: p.x + dx, y: p.y + dy }, true);
      wheel.setLinvel({ x: v.x - omega * dy, y: v.y + omega * dx }, true);
      wheel.setRotation(this.wheelAngle, true);
      wheel.setAngvel(-v.x / CAR_WHEEL_RADIUS, true);
    });
  }

  private settleOnRoad(support: RoadSupport): void {
    const p = this.car.translation();
    const v = this.car.linvel();
    if (!this.isGrounded) {
      const impact = Math.max(0, v.x * Math.tan(support.angle) - v.y);
      this.landingSerial++;
      this.landingImpact = clamp(impact / 18, 0, 1);
      this.suspension.land(impact, angleDelta(support.angle, this.car.rotation()), p.y - support.y);
    }
    this.car.setTranslation({ x: p.x, y: support.y }, true);
    this.car.setRotation(support.angle, true);
    this.car.setAngvel(0, true);
    this.car.setLinvel({ x: clamp(v.x, 6, 23), y: v.x * Math.tan(support.angle) }, true);
    this.isGrounded = true;
    this.setGravity(0);
  }

  /** Inertial road loads excite the two body springs independently. */
  private updateSuspension(): void {
    const p = this.car.translation();
    const speed = this.car.linvel().x;
    const acceleration = (speed - this.previousSpeed) / FIXED_STEP;
    let normalAcceleration = 0;
    let roadAngularAcceleration = 0;
    if (this.isGrounded) {
      const sample = 0.4;
      const before = this.roadSupport(p.x - sample);
      const here = this.roadSupport(p.x);
      const after = this.roadSupport(p.x + sample);
      if (before?.contacts === 2 && here?.contacts === 2 && after?.contacts === 2) {
        const slope = (after.y - before.y) / (2 * sample);
        const curvature = (before.y - 2 * here.y + after.y) / (sample * sample);
        const angleSlope = angleDelta(before.angle, after.angle) / (2 * sample);
        const angleCurvature = (angleDelta(here.angle, before.angle) + angleDelta(here.angle, after.angle)) / (sample * sample);
        normalAcceleration = curvature * speed * speed + slope * acceleration;
        roadAngularAcceleration = angleCurvature * speed * speed + angleSlope * acceleration;
      }
    }
    this.suspension.update({ grounded: this.isGrounded, normalAcceleration, roadAngularAcceleration,
      forwardAcceleration: acceleration, suction: this.fansOn }, FIXED_STEP);
    this.previousSpeed = speed;
  }

  private makeRoad(start: number, end: number): Collider {
    const samples = Math.max(2, Math.ceil((end - start) / 0.32));
    const points = new Float32Array((samples + 1) * 2);
    for (let i = 0; i <= samples; i++) {
      const x = lerp(start, end, i / samples);
      points[i * 2] = x;
      points[i * 2 + 1] = roadHeight(x);
    }
    return this.world.createCollider(RAPIER.ColliderDesc.polyline(points).setSensor(true));
  }

  private addChunk(index: number): void {
    const spec = this.generator.chunk(index);
    const roads: Collider[] = [];
    if (spec.gap) {
      roads.push(this.makeRoad(spec.start, spec.gap.start));
      roads.push(this.makeRoad(spec.gap.end, spec.end));
    } else {
      roads.push(this.makeRoad(spec.start, spec.end));
    }

    const hazards = spec.hazards.map((hazard): ActiveHazard => {
      const y = hazard.kind === 'drone' ? hazard.y + 3.0 : hazard.y + 0.63;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(hazard.x, y),
      );
      const shape = hazard.kind === 'drone'
        ? RAPIER.ColliderDesc.ball(0.48)
        : hazard.kind === 'pulse'
          ? RAPIER.ColliderDesc.cuboid(0.54, 0.68)
          : RAPIER.ColliderDesc.cuboid(0.55, 0.58);
      const collider = this.world.createCollider(
        shape.setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      this.hazardColliders.add(collider.handle);
      return { spec: hazard, body, collider, x: hazard.x, y };
    });

    this.chunks.set(index, { spec, roads, hazards });
  }

  private ensureChunks(x: number): void {
    const first = Math.max(0, Math.floor((x - 40) / CHUNK_LENGTH));
    const last = Math.floor((x + 95) / CHUNK_LENGTH);
    for (let index = first; index <= last; index++) {
      if (!this.chunks.has(index)) this.addChunk(index);
    }
    for (const [index, chunk] of this.chunks) {
      if (index >= first) continue;
      for (const road of chunk.roads) this.world.removeCollider(road, true);
      for (const hazard of chunk.hazards) {
        this.hazardColliders.delete(hazard.collider.handle);
        this.world.removeRigidBody(hazard.body);
      }
      this.chunks.delete(index);
    }
    this.generator.trim(first);
  }

  private updateHazards(): void {
    for (const chunk of this.chunks.values()) {
      for (const hazard of chunk.hazards) {
        const { spec } = hazard;
        hazard.x = spec.x + (spec.kind === 'drone' ? Math.sin(this.time * 0.9 + spec.phase) * 0.58 : 0);
        hazard.y = spec.y + (spec.kind === 'drone'
          ? 3.05 + Math.sin(this.time * 2.1 + spec.phase) * 0.35
          : spec.kind === 'pulse'
            ? 0.62 + Math.max(0, Math.sin(this.time * 2.9 + spec.phase)) * 0.50
            : 0.63);
        hazard.body.setNextKinematicTranslation({ x: hazard.x, y: hazard.y });
      }
    }
  }

  step(controls: Controls): void {
    if (this.crashed) return;
    this.previousSuspensionOffset = this.suspension.offset;
    this.previousSuspensionPitch = this.suspension.pitch;
    for (const body of [this.car, ...this.wheels]) {
      body.resetForces(true);
      body.resetTorques(true);
    }
    this.previous = this.current.map((pose) => ({ ...pose })) as [BodyPose, BodyPose, BodyPose];
    this.time += FIXED_STEP;
    this.jumpLock = Math.max(0, this.jumpLock - FIXED_STEP);
    this.crestCooldown = Math.max(0, this.crestCooldown - FIXED_STEP);
    const positionBefore = this.car.translation();
    this.ensureChunks(positionBefore.x);
    const support = this.roadSupport(positionBefore.x);
    const clearance = support ? positionBefore.y - support.y : Infinity;
    const angle = this.car.rotation();
    if (support && clearance < 0.30 && Math.abs(angle) > 1.65) {
      this.crashed = true;
      this.current = this.readPoses();
      return;
    }
    if (!support || Math.abs(clearance) > 0.20 || this.jumpLock > 0) this.isGrounded = false;

    let velocity = { ...this.car.linvel() };
    if (!this.isGrounded && support && this.jumpLock === 0 && clearance <= 0.03 && clearance > -0.15 &&
        velocity.y - velocity.x * Math.tan(support.angle) <= 0.8 && Math.abs(angle) < 1.4) {
      this.settleOnRoad(support);
      velocity = { ...this.car.linvel() };
    }

    // Only a sufficiently fast convex crest can release road support. Ordinary
    // contours remain planted; suction also keeps fast crests planted.
    if (this.isGrounded && support?.contacts === 2 && velocity.x > 16.5 && !controls.suction && this.crestCooldown === 0) {
      const before = this.roadSupport(positionBefore.x - 0.2);
      const after = this.roadSupport(positionBefore.x + 0.2);
      if (before?.contacts === 2 && after?.contacts === 2) {
        const curvature = (before.y - 2 * support.y + after.y) / 0.04;
        if (curvature * velocity.x * velocity.x < -GRAVITY * 0.95) {
          this.isGrounded = false;
          this.jumpLock = 0.18;
          this.crestCooldown = 0.8;
          velocity.y += 0.9;
        }
      }
    }
    this.groundGrace = this.isGrounded ? 0.10 : Math.max(0, this.groundGrace - FIXED_STEP);
    if (this.isGrounded) this.jumpCount = 0;

    if (controls.jumpPressed) {
      const firstJump = this.jumpCount === 0 && (this.isGrounded || this.groundGrace > 0);
      const secondJump = this.jumpCount === 1 && !this.isGrounded;
      if (firstJump || secondJump) {
        // Give all three bodies the same takeoff velocity: applying an impulse
        // only to the chassis made the rigid wheel joints kick on the next step.
        velocity.y = firstJump ? clamp(Math.max(0, velocity.y) + 9.4, 9.4, 12) : 9.2;
        this.jumpCount = firstJump ? 1 : 2;
        this.jumpSerial++;
        this.suspension.takeoff();
        this.groundGrace = 0;
        this.jumpLock = 0.16;
        this.jumpHoldTime = 0;
        this.isGrounded = false;
      }
    }

    const targetSpeed = 11.2 + Math.min(6.8, Math.max(0, this.distance) / 160);
    this.boostOn = controls.boost && !this.isGrounded && this.charge > 0.01;
    const desiredSpeed = targetSpeed + (this.boostOn ? 4.5 : 0);
    const acceleration = this.boostOn ? 12 : this.isGrounded ? 7 : 3;
    velocity.x = clamp(velocity.x + clamp(desiredSpeed - velocity.x, -5 * FIXED_STEP, acceleration * FIXED_STEP), 6, 23);

    if (controls.jumpHeld && this.jumpCount > 0 && this.jumpHoldTime < 0.19 && velocity.y > 0) {
      velocity.y += 14 * FIXED_STEP;
      this.jumpHoldTime += FIXED_STEP;
    } else if (!controls.jumpHeld) {
      this.jumpHoldTime = 1;
    }

    this.fansOn = controls.suction && support !== null && clearance < 1.10 && clearance > -0.35 && this.jumpLock <= 0;
    if (this.fansOn && !this.isGrounded) velocity.y -= 38 * FIXED_STEP;

    if (this.boostOn) {
      this.charge = Math.max(0, this.charge - FIXED_STEP * 0.48);
    } else {
      this.charge = Math.min(1, this.charge + FIXED_STEP * 0.19);
    }

    if (this.isGrounded && support) {
      velocity.y = velocity.x * Math.tan(support.angle);
      this.car.setRotation(support.angle, true);
      this.car.setAngvel(0, true);
    } else {
      const targetAngle = support && clearance < 1.5
        ? support.angle
        : clamp(velocity.y * 0.025, -0.28, 0.32);
      this.car.setAngvel(clamp(angleDelta(angle, targetAngle) * 8, -1.6, 1.6), true);
    }
    this.car.setLinvel({ x: velocity.x, y: clamp(velocity.y, -25, 16) }, true);
    this.setGravity(this.isGrounded ? 0 : 1);
    this.syncWheels();

    this.updateHazards();
    this.world.step(this.events);
    this.events.drainCollisionEvents((first, second, started) => {
      if (!started) return;
      if ((this.carColliders.has(first) && this.hazardColliders.has(second)) ||
          (this.carColliders.has(second) && this.hazardColliders.has(first))) {
        this.crashed = true;
      }
    });

    const position = this.car.translation();
    const landing = this.roadSupport(position.x);
    // A tire arriving below a broken road's far lip is an undershot gap,
    // rather than a reason to teleport the assembly up through the road.
    if (!support && landing && !this.isGrounded && position.y < landing.y - 0.05) this.crashed = true;
    if (this.isGrounded) {
      if (landing) this.settleOnRoad(landing);
      else { this.isGrounded = false; this.setGravity(1); }
    } else if (!this.crashed && landing && this.jumpLock <= 0 && Math.abs(this.car.rotation()) < 1.4) {
      const depth = position.y - landing.y;
      const relativeVelocity = this.car.linvel().y - this.car.linvel().x * Math.tan(landing.angle);
      const crossedRoad = support !== null && clearance >= 0 && depth <= 0.03;
      if (depth <= 0.03 && (depth > -0.15 || crossedRoad) && relativeVelocity <= 0.8) {
        this.settleOnRoad(landing);
        this.jumpCount = 0;
        this.jumpHoldTime = 1;
        this.groundGrace = 0.10;
      }
    }
    this.wheelAngle -= (position.x - positionBefore.x) / CAR_WHEEL_RADIUS;
    this.syncWheels();
    if (position.y < roadHeight(position.x) - 5.5 || position.y < -8) this.crashed = true;
    if (this.generator.hasRoad(position.x) &&
        position.y - roadHeight(position.x) < CAR_BODY_CLEARANCE &&
        Math.abs(this.car.rotation()) > 1.65) this.crashed = true;
    this.updateSuspension();
    this.current = this.readPoses();
  }

  get distance(): number {
    return Math.max(0, this.car.translation().x - this.startX);
  }

  get hazardStates(): ReadonlyArray<{ id: string; kind: HazardSpec['kind']; x: number; y: number; phase: number }> {
    return [...this.chunks.values()].flatMap((chunk) => chunk.hazards.map((hazard) => ({
      id: hazard.spec.id, kind: hazard.spec.kind, x: hazard.x, y: hazard.y, phase: hazard.spec.phase,
    })));
  }

  snapshot(alpha: number): GameSnapshot {
    const pose = (index: number): BodyPose => ({
      x: lerp(this.previous[index].x, this.current[index].x, alpha),
      y: lerp(this.previous[index].y, this.current[index].y, alpha),
      angle: this.previous[index].angle + angleDelta(this.previous[index].angle, this.current[index].angle) * alpha,
    });
    return {
      car: pose(0), wheels: [pose(1), pose(2)], distance: this.distance,
      speed: this.car.linvel().x, boost: this.charge, grounded: this.isGrounded,
      suctionActive: this.fansOn, boostActive: this.boostOn, crashed: this.crashed,
      suspensionOffset: lerp(this.previousSuspensionOffset, this.suspension.offset, alpha),
      suspensionPitch: lerp(this.previousSuspensionPitch, this.suspension.pitch, alpha),
      jumpSerial: this.jumpSerial, jumpsUsed: this.jumpCount,
      landingSerial: this.landingSerial, landingImpact: this.landingImpact,
    };
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }
}
