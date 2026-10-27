import RAPIER from '@dimforge/rapier2d-compat';
import type { Collider, EventQueue, RigidBody, World } from '@dimforge/rapier2d-compat';
import { CHUNK_LENGTH, START_APRON_X, BOX_UNLOCK_DISTANCE, TrackGenerator, roadHeight, roadSlope, sampleRoad, loopsBetween, loopGeometry, rampAt, ragdollsBetween, RAMP_BOOSTER_LENGTH, type LoopSpec, type HazardSpec, type TrackChunk } from './track';
import { CAR_AXLE_Y, CAR_BODY_CLEARANCE, CAR_WHEEL_OFFSET, CAR_WHEEL_RADIUS, sprungBodyPose } from './vehicle';
import { VehicleSuspension } from './suspension';
import { WheelContactPhysics, ROAD_GRAVITY, type ContactBody } from './wheelContact';
import { PolicePursuit, type PoliceMode } from './pursuit';
import { PoliceWreck, type PoliceWreckSnapshot } from './policeWreck';
import { LOOP_XP, OBSTACLE_XP, POLICE_XP } from './experience';
import { VehicleDamage } from './damage';
import type { BreakEvent } from './obstacleDebris';
import type { SparkEvent } from './impactSparks';
import { VehicleWeapon, type AimDirection, type CombatTarget, type WeaponId, type WeaponSnapshot, type WeaponImpact, type WeaponUpgrades } from './weapons';
import { CAR_UPGRADE_IDS, carUpgradeLevel, carUpgradeStats, type CarUpgrades } from './carUpgrades';
import { RandomBoxRewards, type RandomBoxSpec, type BoxRewardEvent } from './randomBox';
import { RunMissionTracker, type MissionStats } from './missionStats';
import { carModel, type CarModelId } from './carModels';
import { Ragdoll, type RagdollImpact, type RagdollGroundEvent, type RagdollSnapshot } from './ragdoll';

export const FIXED_STEP = 1 / 120;
export const START_SPEED = 60 / 3.6;
export const SPEED_GAIN_PER_500M = 10 / 3.6;
export const MAX_CRUISE_SPEED = 320 / 3.6;
export const JUMP_THRUST_DURATION = 0.19;
export const RAMP_BOOST_SPEED = 7;

export function cruiseSpeedForDistance(distance: number): number {
  return Math.min(MAX_CRUISE_SPEED, START_SPEED + Math.max(0, distance) / 500 * SPEED_GAIN_PER_500M);
}

export interface Controls {
  jumpPressed: boolean;
  jumpHeld: boolean;
  suction: boolean;
  boost: boolean;
  frontJet?: boolean;
  rearJet?: boolean;
  fire?: boolean;
  aim?: AimDirection;
}

export interface BodyPose { x: number; y: number; angle: number }
export interface GameSnapshot {
  car: BodyPose;
  wheels: [BodyPose, BodyPose];
  wheelContacts: [boolean, boolean];
  wheelTravel: [number, number];
  wheelImpactSerials: [number, number];
  distance: number;
  speed: number;
  boost: number;
  carUpgrades: CarUpgrades;
  maxHealth: number;
  hullHealth: number;
  armorMask: number;
  grounded: boolean;
  suctionActive: boolean;
  boostActive: boolean;
  rampBoostSerial: number;
  suspensionOffset: number;
  suspensionPitch: number;
  jumpSerial: number;
  jumpJetActive: boolean;
  jumpJetRemaining: number;
  frontJetActive: boolean;
  rearJetActive: boolean;
  flipsCompleted: number;
  flipCoins: number;
  jumpsUsed: number;
  landingSerial: number;
  landingImpact: number;
  crashed: boolean;
  wrecked: boolean;
  crashPosition: { x: number; y: number } | null;
  crashReason: 'road' | 'police';
  police: BodyPose & { visibility: number; pressure: number; gap: number; mode: PoliceMode; health: number; disabled: boolean };
  policeWreck: PoliceWreckSnapshot | null;
  weapon: WeaponSnapshot;
  loop: { id: number; progress: number; centerX: number; centerY: number } | null;
  loopCompletions: number;
  obstaclesDestroyed: number;
  policeDestroyed: number;
  breakSerial: number;
  breakEvents: readonly BreakEvent[];
  sparkSerial: number;
  sparkEvents: readonly SparkEvent[];
  runXp: number;
  health: number;
  impactSerial: number;
  invincibilityRemaining: number;
  shieldRemaining: number;
  unlimitedBoostRemaining: number;
  boxCoins: number;
  boxXp: number;
  boxRewardSerial: number;
  boxRewardEvents: readonly BoxRewardEvent[];
  ragdolls: readonly RagdollSnapshot[];
  ragdollHitCount: number;
  ragdollGroundSerial: number;
  ragdollGroundEvents: readonly RagdollGroundEvent[];
  missionStats: MissionStats;
}

interface ActiveHazard {
  spec: HazardSpec;
  body: RigidBody;
  collider: Collider;
  x: number;
  y: number;
  health: number;
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
const GRAVITY = ROAD_GRAVITY;

export class GamePhysics {
  readonly generator = new TrackGenerator();
  readonly chunks = new Map<number, ActiveChunk>();
  readonly world: World;
  readonly car: RigidBody;
  readonly wheels: [RigidBody, RigidBody];
  private readonly events: EventQueue;
  private readonly carColliders = new Set<number>();
  private readonly hazardColliders = new Map<number, ActiveHazard>();
  readonly ragdolls = new Map<number, Ragdoll>();
  private readonly ragdollColliders = new Map<number, Ragdoll>();
  private readonly hitRagdolls = new Set<number>();
  ragdollHitSerial = 0;
  private ragdollGroundSerial = 0;
  private readonly ragdollGroundEvents: RagdollGroundEvent[] = [];
  private previous: [BodyPose, BodyPose, BodyPose];
  private current: [BodyPose, BodyPose, BodyPose];
  private time = 0;
  private jumpLock = 0;
  private jumpHoldTime = 0;
  private jumpJetActive = false;
  private frontJetActive = false;
  private rearJetActive = false;
  private airborneRotation = 0;
  private flipsCompleted = 0;
  private airborneFlips = 0;
  private flipCoins = 0;
  private jumpCount = 0;
  private charge = 1;
  private isGrounded = false;
  private fansOn = false;
  private boostOn = false;
  private rampBoostSpeed = 0;
  private rampBoostTime = 0;
  private rampBoostSerial = 0;
  private readonly usedRampBoosters = new Set<number>();
  private wheelAngle = 0;
  private readonly roadContact = new WheelContactPhysics({
    height: roadHeight, slope: roadSlope, sample: sampleRoad, exists: (x) => this.generator.hasRoad(x),
  });
  private readonly suspension = new VehicleSuspension();
  private previousSuspensionOffset = 0;
  private previousSuspensionPitch = 0;
  private readonly damage = new VehicleDamage();
  private readonly boxRewards = new RandomBoxRewards();
  private readonly runMissions = new RunMissionTracker();
  private jumpSerial = 0;
  private landingSerial = 0;
  private landingImpact = 0;
  private readonly pursuit: PolicePursuit;
  private readonly weapon: VehicleWeapon;
  private policeHealth = 12;
  private policeWreck: PoliceWreck | null = null;
  private previousPoliceX: number;
  private currentPoliceX: number;
  private readonly attemptedLoops = new Set<number>();
  private activeLoop: { spec: LoopSpec; progress: number; speed: number } | null = null;
  private loopCompletions = 0;
  private obstaclesDestroyed = 0;
  private hazardViewTime = -1;
  private hazardView: { id: string; kind: HazardSpec['kind']; x: number; y: number; phase: number }[] = [];
  private breakSerial = 0;
  private readonly breakEvents: BreakEvent[] = [];
  private sparkSerial = 0;
  private readonly sparkEvents: SparkEvent[] = [];
  private readonly destroyedHazards = new Set<string>();
  private policeDestroyed = 0;
  private furthestX: number;
  private boostExhausted = false;
  private crashReason: 'road' | 'police' = 'road';
  crashed = false;
  private wrecked = false;
  private crashPosition: { x: number; y: number } | null = null;
  private readonly carUpgrades: CarUpgrades = {};
  private carStats = carUpgradeStats();

  constructor(private readonly startX = 7, loadout?: { id: WeaponId; xp: number; upgrades?: WeaponUpgrades; carUpgrades?: CarUpgrades; vehicle?: CarModelId }) {
    this.furthestX = startX;
    this.pursuit = new PolicePursuit(startX);
    this.weapon = new VehicleWeapon('machine-gun', loadout?.upgrades);
    if (loadout) this.weapon.equip(loadout.id, loadout.xp);
    this.upgradeCar(loadout?.carUpgrades ?? {});
    this.selectVehicle(loadout?.vehicle ?? 'roadster');
    this.previousPoliceX = this.currentPoliceX = this.pursuit.x;
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
      wheels.push(wheel);
    }
    this.wheels = wheels as [RigidBody, RigidBody];

    this.car.setLinvel({ x: START_SPEED, y: START_SPEED * Math.tan(startAngle) }, true);
    this.isGrounded = support !== null;
    this.setGravity(0);
    this.roadContact.sync(this.contactBody());
    this.syncWheels();
    this.ensureChunks(startX);
    // The depot apron behind the start is solid even after wheels detach.
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(-START_APRON_X / 2, .25)
      .setTranslation(START_APRON_X / 2, roadHeight(0) - .25).setFriction(.65).setRestitution(.12));
    this.current = this.readPoses();
    this.previous = this.current.map((pose) => ({ ...pose })) as [BodyPose, BodyPose, BodyPose];
  }

  private readPoses(): [BodyPose, BodyPose, BodyPose] {
    return [this.car, ...this.wheels].map((body) => {
      const position = body.translation();
      return { x: position.x, y: position.y, angle: body.rotation() };
    }) as [BodyPose, BodyPose, BodyPose];
  }

  /** Reference pose for spawning, police and magnetic-loop joins. Ordinary
   * player motion is determined by independent spring/tire forces instead.
   */
  private roadSupport(x: number, angleOffset = 0): RoadSupport | null {
    let angle = Math.atan(roadSlope(x)) + angleOffset;
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
        angle = Math.atan2(points[1].h - points[0].h, points[1].x - points[0].x) + angleOffset;
      } else {
        angle = Math.atan(roadSlope(points[0].x)) + angleOffset;
      }
      y = Math.max(...points.map((point) => point.h + CAR_WHEEL_RADIUS * Math.hypot(1, roadSlope(point.x)) -
        point.offset * Math.sin(angle) - CAR_AXLE_Y * Math.cos(angle)));
    }
    return { y, angle, contacts };
  }

  private contactBody(): ContactBody {
    const p = this.car.translation();
    const v = this.car.linvel();
    return { ...p, angle: this.car.rotation(), vx: v.x, vy: v.y, omega: this.car.angvel() };
  }

  private setGravity(scale: number): void {
    for (const body of [this.car, ...this.wheels]) body.setGravityScale(scale, true);
  }

  private syncWheels(): void {
    const p = this.car.translation();
    const angle = this.car.rotation();
    this.wheels.forEach((wheel, index) => {
      if (this.activeLoop) {
        const offset = index ? CAR_WHEEL_OFFSET : -CAR_WHEEL_OFFSET;
        wheel.setTranslation({
          x: p.x + offset * Math.cos(angle) - CAR_AXLE_Y * Math.sin(angle),
          y: p.y + offset * Math.sin(angle) + CAR_AXLE_Y * Math.cos(angle),
        }, true);
        wheel.setRotation(this.wheelAngle, true);
      } else {
        const contact = this.roadContact.wheels[index];
        wheel.setTranslation({ x: contact.x, y: contact.y }, true);
        wheel.setRotation(contact.angle, true);
      }
      // Tire motion is integrated by the independent contact solver. Rapier
      // retains the sensors for obstacles, without a rigid axle undoing travel.
      wheel.setLinvel({ x: 0, y: 0 }, true);
      wheel.setAngvel(0, true);
    });
  }

  private makeRoad(start: number, end: number): Collider {
    const samples = Math.max(2, Math.ceil((end - start) / 0.32));
    const points = new Float32Array((samples + 1) * 2);
    for (let i = 0; i <= samples; i++) {
      const x = lerp(start, end, i / samples);
      points[i * 2] = x;
      points[i * 2 + 1] = roadHeight(x);
    }
    return this.world.createCollider(RAPIER.ColliderDesc.polyline(points)
      .setFriction(0.65).setRestitution(0.12));
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
        shape.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      const destroyed = this.destroyedHazards.has(hazard.id);
      collider.setEnabled(!destroyed);
      const active = { spec: hazard, body, collider, x: hazard.x, y,
        health: destroyed ? 0 : hazard.kind === 'drone' ? 2 : hazard.kind === 'pulse' ? 4 : 3 };
      if (!destroyed) this.hazardColliders.set(collider.handle, active);
      return active;
    });

    this.chunks.set(index, { spec, roads, hazards });
  }

  private ensureChunks(x: number, rearX = x): void {
    const first = Math.max(0, Math.floor((rearX - 40) / CHUNK_LENGTH));
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

  private syncRagdolls(x: number): void {
    for (const spec of ragdollsBetween(x - 65, x + 90)) {
      if (this.ragdolls.has(spec.id) || this.hitRagdolls.has(spec.id)) continue;
      const actor = new Ragdoll(this.world, spec);
      this.ragdolls.set(spec.id, actor);
      for (const collider of actor.colliders) this.ragdollColliders.set(collider.handle, actor);
    }
    for (const [id, actor] of this.ragdolls) {
      if (actor.spec.x >= x - 110 && actor.hitAge < 8 && actor.bodies.torso.translation().x < x + 135) continue;
      for (const collider of actor.colliders) this.ragdollColliders.delete(collider.handle);
      actor.dispose();
      this.ragdolls.delete(id);
    }
  }

  private launchRagdoll(first: number, second: number, impact: RagdollImpact): void {
    const actor = this.carColliders.has(first) ? this.ragdollColliders.get(second)
      : this.carColliders.has(second) ? this.ragdollColliders.get(first) : undefined;
    if (actor?.launch(impact)) {
      this.hitRagdolls.add(actor.spec.id);
      this.ragdollHitSerial++;
    }
  }

  private collectRagdollGroundImpacts(): void {
    for (const event of this.ragdollGroundEvents) event.age += FIXED_STEP;
    while (this.ragdollGroundEvents.length && this.ragdollGroundEvents[0].age > 1.6) {
      this.ragdollGroundEvents.shift();
    }
    const surface = { hasRoad: (x: number): boolean => this.generator.hasRoad(x), height: roadHeight };
    for (const actor of this.ragdolls.values()) {
      const impact = actor.groundImpact(surface);
      if (impact) this.ragdollGroundEvents.push({ serial: ++this.ragdollGroundSerial, ...impact, age: 0 });
    }
  }

  private updateHazards(): void {
    for (const chunk of this.chunks.values()) {
      for (const hazard of chunk.hazards) {
        if (hazard.health <= 0) continue;
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

  private driveSpeed(speed: number, controls: Controls): number {
    const unlimited = this.boxRewards.boostRemaining > 0;
    if (!controls.boost || unlimited) this.boostExhausted = false;
    this.boostOn = controls.boost && (unlimited || !this.boostExhausted && this.charge > 0.01);
    const stats = this.carStats;
    this.rampBoostSpeed = Math.max(0, this.rampBoostSpeed - 5 * FIXED_STEP);
    this.rampBoostTime = Math.max(0, this.rampBoostTime - FIXED_STEP);
    const cruiseSpeed = cruiseSpeedForDistance(this.distance);
    const target = Math.max(this.rampBoostSpeed, cruiseSpeed + (this.boostOn ? 9 * stats.boostPower : 0));
    const acceleration = this.boostOn ? 18 * stats.boostPower : this.isGrounded ? 7 : 3;
    if (!unlimited) this.charge = clamp(this.charge + FIXED_STEP * (this.boostOn ? -0.48 : 0.19) / stats.boostCapacity, 0, 1);
    if (!unlimited && this.boostOn && this.charge <= 0.01) this.boostExhausted = true;
    return clamp(speed + clamp(target - speed, -5 * FIXED_STEP, acceleration * FIXED_STEP), 6,
      Math.max(this.rampBoostSpeed, cruiseSpeed + 9 * stats.boostPower));
  }

  private applyRampBooster(body: ContactBody): void {
    if (body.vx <= 0 || this.crashed) return;
    for (const wheel of this.roadContact.wheels) {
      if (!wheel.grounded) continue;
      const ramp = rampAt(wheel.x);
      if (!ramp || this.usedRampBoosters.has(ramp.id) || body.x < ramp.boosterX - 1 ||
          Math.abs(wheel.x - ramp.boosterX) > RAMP_BOOSTER_LENGTH / 2) continue;
      this.usedRampBoosters.add(ramp.id);
      this.rampBoostSerial++;
      // Apply an impulse along the road tangent while the tire is on the pad.
      // The extra speed decays gently and uses no player boost reserve. Reduce
      // inherited pitch spin without changing the car's current takeoff angle.
      body.vx += RAMP_BOOST_SPEED;
      body.vy += RAMP_BOOST_SPEED * roadSlope(wheel.x);
      body.omega *= .35;
      this.rampBoostSpeed = body.vx;
      this.rampBoostTime = RAMP_BOOST_SPEED / 5;
      break;
    }
  }

  /** The magnetic branch is an exact circular contact constraint. The ordinary
   * road remains underneath it. Releasing suction returns to airborne dynamics. */
  private stepLoop(controls: Controls): boolean {
    const p = this.car.translation();
    if (!this.activeLoop && controls.suction && this.isGrounded) {
      const spec = loopsBetween(p.x - 0.28, p.x + 0.28).find((loop) => !this.attemptedLoops.has(loop.id));
      if (spec) {
        this.attemptedLoops.add(spec.id);
        this.activeLoop = { spec, progress: 0, speed: Math.max(8, this.car.linvel().x / Math.cos(this.car.rotation())) };
        this.pursuit.beginLoop(p.x, this.activeLoop.speed);
        this.jumpCount = 0;
      }
    }
    const active = this.activeLoop;
    if (!active) return false;
    if (!controls.suction) {
      this.pursuit.finishLoop(false);
      this.activeLoop = null;
      this.isGrounded = false;
      this.fansOn = false;
      // A loop release is not a jump. Near the exit the tires may reach the
      // road on the very next step, so landing must remain enabled throughout.
      // attemptedLoops already prevents re-entering the magnetic branch.
      this.jumpLock = 0;
      this.jumpHoldTime = 1;
      this.car.setRotation(Math.atan2(Math.sin(this.car.rotation()), Math.cos(this.car.rotation())), true);
      this.roadContact.release(this.contactBody(), this.wheelAngle);
      this.setGravity(0);
      return false;
    }
    const geometry = loopGeometry(active.spec);
    // Both tires sit inside the ring; account for the wheelbase's chord.
    const radius = Math.sqrt((active.spec.radius - CAR_WHEEL_RADIUS) ** 2 - CAR_WHEEL_OFFSET ** 2) + CAR_AXLE_Y;
    active.speed = this.driveSpeed(active.speed, controls);
    active.progress = Math.min(Math.PI * 2, active.progress + active.speed * FIXED_STEP / radius);
    const angle = geometry.angle + active.progress;
    const theta = angle - Math.PI / 2;
    this.updateHazards();
    this.world.step(this.events);
    this.events.drainCollisionEvents((first, second, started) => {
      if (started) this.launchRagdoll(first, second, {
        x: p.x, y: p.y, vx: active.speed * Math.cos(this.car.rotation()),
        vy: active.speed * Math.sin(this.car.rotation()), angle: this.car.rotation(),
      });
    });
    this.collectRagdollGroundImpacts();
    this.car.setTranslation({ x: geometry.x + radius * Math.cos(theta), y: geometry.y + radius * Math.sin(theta) }, true);
    this.car.setRotation(angle, true);
    this.car.setLinvel({ x: active.speed * Math.cos(angle), y: active.speed * Math.sin(angle) }, true);
    this.car.setAngvel(active.speed / radius, true);
    this.isGrounded = true;
    this.fansOn = true;
    this.setGravity(0);
    this.wheelAngle -= active.speed * FIXED_STEP / CAR_WHEEL_RADIUS;
    this.syncWheels();
    this.suspension.update({ grounded: true,
      normalAcceleration: active.speed * active.speed / radius + GRAVITY * (Math.cos(angle) - 1),
      roadAngularAcceleration: 0, forwardAcceleration: 0, suction: true }, FIXED_STEP);
    this.pursuit.update(FIXED_STEP, this.boostOn, { x: this.car.translation().x, speed: active.speed });
    this.currentPoliceX = this.pursuit.x;
    this.furthestX = Math.max(this.furthestX, this.car.translation().x);
    if (active.progress >= Math.PI * 2) {
      this.loopCompletions++;
      this.pursuit.finishLoop(true);
      this.activeLoop = null;
      this.jumpLock = 0;
      this.jumpHoldTime = 1;
      this.jumpCount = 0;
      this.car.setRotation(geometry.angle, true);
      const support = this.roadSupport(this.car.translation().x);
      if (support) this.car.setTranslation({ x: this.car.translation().x, y: support.y }, true);
      this.roadContact.sync(this.contactBody());
      this.car.setAngvel(0, true);
      this.syncWheels();
    }
    this.updateWeapon(controls);
    this.current = this.readPoses();
    return true;
  }

  private updatePursuit(): void {
    const p = this.car.translation();
    this.pursuit.update(FIXED_STEP, this.boostOn, { x: p.x, speed: this.car.linvel().x });
    this.currentPoliceX = this.pursuit.x;
    if (!this.pursuit.disabled && this.pursuit.visibility > 0.5 && Math.abs(p.x - this.pursuit.x) <= 3.9) {
      const policeY = this.roadSupport(this.pursuit.x)?.y ?? roadHeight(this.pursuit.x) + CAR_BODY_CLEARANCE;
      if (Math.abs(p.y - policeY) < 0.95 && this.registerImpact('police')) {
        const v = this.car.linvel();
        this.emitSparks((p.x + this.pursuit.x) * 0.5, p.y - 0.1, v.x, v.y);
        this.pursuit.afterImpact();
      }
    }
  }

  equipWeapon(id: string, xp: number): boolean { return this.weapon.equip(id, xp); }
  upgradeWeapon(id: WeaponId, level: number): void { this.weapon.setUpgradeLevel(id, level); }
  weaponAmmo(id: WeaponId): number { return this.weapon.ammoFor(id); }
  selectVehicle(id: string): void { this.weapon.mountLift = carModel(id).roofLift; }
  upgradeCar(upgrades: CarUpgrades): void {
    const previousCapacity = this.carStats.boostCapacity;
    for (const id of CAR_UPGRADE_IDS) this.carUpgrades[id] = Math.max(this.carUpgrades[id] ?? 0, carUpgradeLevel(upgrades[id]));
    const stats = carUpgradeStats(this.carUpgrades);
    this.carStats=stats;
    if(stats.boostCapacity>previousCapacity) this.charge = Math.min(1, (this.charge * previousCapacity + stats.boostCapacity - previousCapacity) / stats.boostCapacity);
    if (!this.crashed) this.damage.upgradeArmor(stats.armor);
  }

  private updateWeapon(controls: Controls): void {
    if (!this.pursuit.disabled && this.policeHealth <= 0) this.policeHealth = 12;
    const targets: CombatTarget[] = [];
    const active = new Map<string, ActiveHazard>();
    for (const chunk of this.chunks.values()) for (const hazard of chunk.hazards) {
      if (hazard.health <= 0) continue;
      active.set(hazard.spec.id, hazard);
      targets.push({ id: hazard.spec.id, kind: 'hazard', x: hazard.x, y: hazard.y, radius: .65, health: hazard.health });
    }
    const boxes = new Map(this.randomBoxStates.map(box => [box.id, box]));
    for (const box of boxes.values()) targets.push({ id: box.id, kind: 'box', x: box.x, y: box.y, radius: .58, health: 1 });
    for (const actor of this.ragdolls.values()) {
      const torso = actor.bodies.torso.translation();
      targets.push({ id: `ragdoll-${actor.spec.id}`, kind: 'ragdoll', x: torso.x, y: torso.y,
        radius: .62, health: 1 });
    }
    if (!this.pursuit.disabled && this.pursuit.visibility > .5) {
      targets.push({ id: 'police', kind: 'police', x: this.pursuit.x,
        y: (this.roadSupport(this.pursuit.x)?.y ?? roadHeight(this.pursuit.x) + CAR_BODY_CLEARANCE) + .20,
        radius: .95, health: this.policeHealth });
    }
    const p = this.car.translation();
    const body = sprungBodyPose({ ...p, angle: this.car.rotation() },
      this.activeLoop ? this.suspension.offset : 0, this.activeLoop ? this.suspension.pitch : 0);
    const v = this.car.linvel();
    this.weapon.step(FIXED_STEP, controls, { ...body, vx: v.x, vy: v.y }, targets, (target, _damage, hit) => {
      if (target.kind === 'ragdoll') {
        const actor = this.ragdolls.get(Number(target.id.slice('ragdoll-'.length)));
        if (actor) {
          actor.shoot({ x: hit?.x ?? target.x, y: hit?.y ?? target.y,
            vx: hit?.vx ?? 0, vy: hit?.vy ?? 0, angle: Math.atan2(hit?.vy ?? 0, hit?.vx ?? 1) });
          this.hitRagdolls.add(actor.spec.id);
          this.ragdollHitSerial++;
        }
        return;
      }
      if (target.kind === 'police') {
        const destroyed = this.policeHealth > 0 && target.health === 0;
        this.policeHealth = target.health;
        if (destroyed) {
          this.policeDestroyed++;
          const support = this.roadSupport(this.pursuit.x);
          this.policeWreck?.dispose();
          this.policeWreck = new PoliceWreck(this.world, this.policeDestroyed,
            { x: this.pursuit.x, y: target.y - .2, angle: support?.angle ?? 0 }, this.pursuit.speed);
          this.pursuit.disable(8);
          this.addBreakEvent({ hazardId: 'police', kind: 'police', x: target.x, y: target.y,
            speed: this.car.linvel().x, source: 'weapon' });
        }
      } else if (target.kind === 'box') {
        const box = boxes.get(target.id);
        if (box && target.health === 0 && !this.crashed) {
          const activeWeapon = this.weapon.snapshot();
          const reward = this.boxRewards.open(box, {
            health: this.damage.health < this.damage.maxHealth,
            ammo: activeWeapon.ammo < activeWeapon.capacity,
          });
          if (reward?.kind === 'health') this.damage.restoreUnit();
          else if (reward?.kind === 'ammo') this.weapon.refillActive();
        }
      } else {
        const hazard = active.get(target.id);
        if (!hazard || hazard.health <= 0) return;
        if (target.health === 0) this.breakHazard(hazard, 'weapon', this.car.linvel().x);
        else hazard.health = target.health;
      }
    }, x => this.generator.hasRoad(x) ? roadHeight(x) : -Infinity, impact => this.emitWeaponSparks(impact));
    this.runMissions.recordWeapon(this.weapon.activeId, this.weapon.ammoFor(this.weapon.activeId), this.weapon.shotsFired);
  }

  private breakHazard(hazard: ActiveHazard, source: BreakEvent['source'], speed: number): void {
    if (hazard.health <= 0) return;
    hazard.health = 0;
    this.hazardViewTime = -1;
    hazard.collider.setEnabled(false);
    this.hazardColliders.delete(hazard.collider.handle);
    this.destroyedHazards.add(hazard.spec.id);
    if (source === 'weapon') {
      this.obstaclesDestroyed++; this.runMissions.stats.obstaclesShot++;
      if (hazard.spec.kind === 'drone') this.runMissions.stats.dronesShot++;
      if (hazard.spec.kind === 'pulse') this.runMissions.stats.pulsesShot++;
    } else {
      this.runMissions.stats.hazardsRammed++;
      if (hazard.spec.kind === 'drone') this.runMissions.stats.dronesRammed++;
    }
    this.addBreakEvent({ hazardId: hazard.spec.id, kind: hazard.spec.kind,
      x: hazard.x, y: hazard.y, speed, source });
  }

  private addBreakEvent(event: Omit<BreakEvent, 'serial' | 'age'>): void {
    this.breakEvents.push({ ...event, serial: ++this.breakSerial, age: 0 });
    if (this.breakEvents.length > 32) this.breakEvents.shift();
  }

  private emitSparks(x: number, y: number, vx: number, vy: number): void {
    this.sparkEvents.push({ serial: ++this.sparkSerial, x, y, vx, vy, strength: Math.hypot(vx, vy), age: 0, kind: 'collision' });
    if (this.sparkEvents.length > 24) this.sparkEvents.shift();
  }

  private emitWeaponSparks(impact: WeaponImpact): void {
    if (impact.surface === 'ragdoll') return;
    this.sparkEvents.push({ serial: ++this.sparkSerial, x: impact.x, y: impact.y,
      vx: 0, vy: 0, directionX: impact.directionX, directionY: impact.directionY,
      strength: impact.destroyed ? 24 : 10, age: 0, kind: impact.surface === 'terrain' ? 'terrain' : 'projectile' });
    if (this.sparkEvents.length > 24) this.sparkEvents.shift();
  }

  private advancePoliceWreck(): void {
    if (!this.policeWreck) return;
    this.policeWreck.beforeStep(FIXED_STEP);
    if (this.policeWreck.age > 10 || this.car.translation().x - this.policeWreck.body.translation().x > 75) {
      this.policeWreck.dispose();
      this.policeWreck = null;
    }
  }

  private ageSparks(): void {
    for (const event of this.sparkEvents) event.age += FIXED_STEP;
    while (this.sparkEvents.length && this.sparkEvents[0].age > 2.5) this.sparkEvents.shift();
  }

  private registerImpact(source: 'road' | 'police'): boolean {
    if (this.boxRewards.shieldRemaining > 0) return false;
    const rearImpact = source === 'police' && this.pursuit.x < this.car.translation().x;
    if (!this.damage.hit(rearImpact ? 3 : 0)) return false;
    if (this.activeLoop) this.suspension.land(4.5, 0, 0);
    if (this.damage.health === 0) {
      this.crashed = true;
      this.crashReason = source;
    }
    return true;
  }

  step(controls: Controls): void {
    if (this.crashed) return;
    this.stepDriving(controls);
    this.runMissions.step({ distance: this.distance, speed: this.activeLoop?.speed ?? this.car.linvel().x,
      grounded: this.isGrounded, loop: this.activeLoop !== null, crashed: this.crashed,
      boost: this.boostOn, impacts: this.damage.impactSerial, loops: this.loopCompletions,
      police: this.policeDestroyed, boxes: this.boxRewards.serial, ramps: this.rampBoostSerial }, FIXED_STEP);
  }

  private stepDriving(controls: Controls): void {
    if (this.crashed) return;
    this.jumpJetActive = false;
    this.frontJetActive = this.rearJetActive = false;
    this.damage.step(FIXED_STEP);
    this.boxRewards.step(FIXED_STEP);
    this.previousPoliceX = this.currentPoliceX;
    this.previousSuspensionOffset = this.suspension.offset;
    this.previousSuspensionPitch = this.suspension.pitch;
    this.previous = this.current.map((pose) => ({ ...pose })) as [BodyPose, BodyPose, BodyPose];
    this.time += FIXED_STEP;
    this.ageSparks();
    this.advancePoliceWreck();
    for (const event of this.breakEvents) event.age += FIXED_STEP;
    while (this.breakEvents.length && this.breakEvents[0].age > 2.5) this.breakEvents.shift();
    this.jumpLock = Math.max(0, this.jumpLock - FIXED_STEP);
    const before = this.contactBody();
    this.ensureChunks(before.x);
    this.syncRagdolls(before.x);
    for (const actor of this.ragdolls.values()) actor.beforeStep(FIXED_STEP);
    if (this.stepLoop(controls)) {
      this.airborneRotation = 0;
      this.airborneFlips = 0;
      return;
    }

    const support = this.roadSupport(before.x);
    if (support && before.y < support.y + 0.3 && Math.abs(before.angle) > 1.65) {
      this.runMissions.stats.roofHits = 1;
      this.crashed = true;
      this.beginWreck();
      this.current = this.readPoses();
      return;
    }
    if (!this.roadContact.hasContact(before)) this.isGrounded = false;
    if (this.isGrounded && this.jumpLock === 0) this.jumpCount = 0;
    if (controls.jumpPressed) {
      // A fall or ramp launch still leaves the first jump available in mid-air.
      const firstJump = this.jumpCount === 0;
      const secondJump = this.jumpCount === 1 && !this.isGrounded;
      if (firstJump || secondJump) {
        // Add lift vertically while retaining the climb's upward momentum.
        // Capping total speed here used to consume jump power on uphill waves.
        // An early double jump must add lift instead of braking that ascent.
        before.vy = firstJump
          ? Math.max(0, before.vy) + 11.2
          : Math.max(9.2, before.vy + 1.8);
        this.roadContact.beginJump(before, controls.jumpHeld);
        this.jumpCount = firstJump ? 1 : 2;
        if (firstJump) this.runMissions.stats.jumps++;
        else this.runMissions.stats.doubleJumps++;
        this.jumpSerial++;
        this.jumpLock = 0.16;
        this.jumpHoldTime = 0;
        this.isGrounded = false;
      }
    }
    before.vx = this.driveSpeed(before.vx, controls);
    if (controls.jumpHeld && this.jumpCount > 0 && this.jumpHoldTime < JUMP_THRUST_DURATION && before.vy > 0) {
      const thrustTime = Math.min(FIXED_STEP, JUMP_THRUST_DURATION - this.jumpHoldTime);
      before.vy += 14 * thrustTime;
      this.jumpHoldTime += thrustTime;
      this.jumpJetActive = true;
    } else if (!controls.jumpHeld) {
      this.jumpHoldTime = 1;
    }

    // The chassis remains a free body: springs, dampers, tire impulses, gravity
    // and finite fan forces determine its motion on the road and in the air.
    const wasGrounded = this.isGrounded;
    const body = this.roadContact.step(before, controls.suction && this.jumpLock <= 0.08, FIXED_STEP, this.jumpJetActive,
      { front: controls.frontJet, rear: controls.rearJet });
    if (this.roadContact.undershot) this.crashed = true;
    this.isGrounded = this.roadContact.wheels.some((wheel) => wheel.grounded);
    if (!this.roadContact.undershot) this.applyRampBooster(body);
    this.frontJetActive = !this.isGrounded && this.roadContact.frontJetActive;
    this.rearJetActive = !this.isGrounded && this.roadContact.rearJetActive;
    this.fansOn = this.roadContact.suction > 0;
    if (!wasGrounded && this.isGrounded && this.jumpLock <= 0) {
      this.landingSerial++;
      this.landingImpact = clamp(Math.max(...this.roadContact.wheels.map((wheel) => wheel.impact)) / 18, 0, 1);
      this.jumpCount = 0;
      this.jumpHoldTime = 1;
    }
    this.car.setTranslation({ x: body.x, y: body.y }, true);
    this.car.setRotation(body.angle, true);
    this.car.setLinvel({ x: 0, y: 0 }, true);
    this.car.setAngvel(0, true);
    this.setGravity(0);
    this.syncWheels();
    this.updateHazards();
    this.world.step(this.events);
    this.events.drainCollisionEvents((first, second, started) => {
      if (!started) return;
      this.launchRagdoll(first, second, body);
      const hazard = this.carColliders.has(first) ? this.hazardColliders.get(second)
        : this.carColliders.has(second) ? this.hazardColliders.get(first) : undefined;
      if (hazard && hazard.health > 0) {
        this.emitSparks(hazard.x - Math.sign(body.vx) * 0.5, hazard.y, body.vx, body.vy);
        this.registerImpact('road');
        this.breakHazard(hazard, 'ram', body.vx);
      }
    });
    this.collectRagdollGroundImpacts();
    this.car.setLinvel({ x: body.vx, y: body.vy }, true);
    this.car.setAngvel(body.omega, true);
    if (body.y < roadHeight(body.x) - 5.5 || body.y < -8) this.crashed = true;
    if (this.generator.hasRoad(body.x) && body.y - roadHeight(body.x) < CAR_BODY_CLEARANCE && Math.abs(body.angle) > 1.65) {
      this.runMissions.stats.roofHits = 1;
      this.crashed = true;
    }
    this.furthestX = Math.max(this.furthestX, body.x);
    this.updatePursuit();
    this.updateWeapon(controls);
    if (!this.isGrounded && !this.crashed) {
      if (wasGrounded) {
        this.airborneRotation = 0;
        this.airborneFlips = 0;
      }
      // Rapier wraps angles at ±π. Accumulate signed, unwrapped motion so
      // partial turns cancel when reversed, and each full turn pays once.
      this.airborneRotation += angleDelta(before.angle, body.angle);
      while (Math.abs(this.airborneRotation) >= Math.PI * 2) {
        if (this.airborneRotation > 0) this.runMissions.stats.backflips++;
        else this.runMissions.stats.forwardFlips++;
        this.flipsCompleted++;
        this.airborneFlips++;
        // Top up this jump to 5 × n² coins: 5, 20, 45, 80, ... .
        this.flipCoins += 5 * (2 * this.airborneFlips - 1);
        this.airborneRotation -= Math.sign(this.airborneRotation) * Math.PI * 2;
      }
    } else {
      this.airborneRotation = 0;
      this.airborneFlips = 0;
    }
    if (this.crashed) this.beginWreck();
    this.current = this.readPoses();
  }

  get impactSerial(): number { return this.damage.impactSerial; }
  get explosionSerial(): number { return this.weapon.destructionSerial; }

  /** Hand the sensors over to Rapier once the run ends. The tire solver no
   * longer positions the wheels, and no driving or stabilization is applied. */
  private beginWreck(): void {
    this.boxRewards.shieldRemaining = this.boxRewards.boostRemaining = 0;
    if (this.wrecked) return;
    this.wrecked = true;
    this.activeLoop = null;
    this.fansOn = this.boostOn = this.jumpJetActive = this.isGrounded = false;
    this.frontJetActive = this.rearJetActive = false;
    this.airborneRotation = 0;
    const velocity = this.car.linvel();
    const omega = this.car.angvel();
    const carPosition = this.car.translation();
    this.crashPosition = { x: carPosition.x, y: carPosition.y };
    this.setGravity(1);
    this.car.setLinearDamping(0.16);
    this.car.setAngularDamping(0.45);
    // Keep the broad chassis hull from interpenetrating the tire sensors at
    // detachment. Both parts still collide with terrain and every obstacle.
    this.car.collider(0).setCollisionGroups(0x00020001);
    for (const handle of this.carColliders) {
      const collider = this.world.getCollider(handle);
      collider.setSensor(false);
      collider.setFriction(0.6);
      collider.setRestitution(0.16);
    }
    this.wheels.forEach((wheel, index) => {
      const p = wheel.translation();
      wheel.setLinvel({ x: velocity.x - omega * (p.y - carPosition.y) + (index ? 2.4 : -1.8),
        y: velocity.y + omega * (p.x - carPosition.x) + 1.8 + index * 0.7 }, true);
      wheel.setAngvel(-velocity.x / CAR_WHEEL_RADIUS + (index ? 3 : -3), true);
      wheel.setLinearDamping(0.12);
      wheel.setAngularDamping(0.3);
      wheel.collider(0).setCollisionGroups(0x00040005);
    });
    this.car.setAngvel(omega + 0.7, true);
    for (const chunk of this.chunks.values()) {
      for (const road of chunk.roads) road.setSensor(false);
      for (const hazard of chunk.hazards) hazard.collider.setSensor(false);
    }
  }

  /** Fixed simulation time; the caller scales the number of steps in the
   * game-over scene. Momentum is preserved rather than scaling velocities. */
  stepWreck(): void {
    if (!this.crashed) return;
    this.beginWreck();
    this.previous = this.current.map(pose => ({ ...pose })) as [BodyPose, BodyPose, BodyPose];
    this.time += FIXED_STEP;
    this.ageSparks();
    this.advancePoliceWreck();
    for (const event of this.breakEvents) event.age += FIXED_STEP;
    const partXs = [this.car, ...this.wheels].map(part => part.translation().x);
    this.ensureChunks(Math.max(...partXs), Math.min(...partXs));
    for (const actor of this.ragdolls.values()) actor.beforeStep(FIXED_STEP);
    this.updateHazards();
    const velocityBefore = this.car.linvel();
    const spinBefore = this.car.angvel();
    this.world.step(this.events);
    this.events.drainCollisionEvents((first, second, started) => {
      if (!started) return;
      const carPosition = this.car.translation();
      this.launchRagdoll(first, second, { ...carPosition, vx: velocityBefore.x,
        vy: velocityBefore.y, angle: this.car.rotation() });
      const partHandle = this.carColliders.has(first) ? first : this.carColliders.has(second) ? second : undefined;
      if (partHandle === undefined) return;
      const other = partHandle === first ? second : first;
      const hazard = this.hazardColliders.get(other);
      const part = this.world.getCollider(partHandle).parent();
      if (!part || part.handle !== this.car.handle) return;
      const p = part.translation();
      if (Math.hypot(velocityBefore.x, velocityBefore.y) + Math.abs(spinBefore) < 2) return;
      this.emitSparks(hazard ? (p.x + hazard.x) * 0.5 : p.x, hazard ? hazard.y : p.y - 0.25,
        velocityBefore.x, velocityBefore.y);
    });
    this.collectRagdollGroundImpacts();
    const p = this.car.translation();
    const v = this.car.linvel();
    this.weapon.step(FIXED_STEP, {}, { ...p, angle: this.car.rotation(), vx: v.x, vy: v.y }, [], () => {}, roadHeight);
    this.current = this.readPoses();
  }

  get distance(): number {
    return Math.max(0, (this.wrecked ? this.furthestX : Math.max(this.furthestX, this.car.translation().x)) - this.startX);
  }

  get hazardStates(): ReadonlyArray<{ id: string; kind: HazardSpec['kind']; x: number; y: number; phase: number }> {
    if (this.hazardViewTime !== this.time) {
      this.hazardViewTime = this.time;
      this.hazardView = [];
      for (const chunk of this.chunks.values()) for (const hazard of chunk.hazards) {
        if (hazard.health > 0) this.hazardView.push({ id: hazard.spec.id, kind: hazard.spec.kind,
          x: hazard.x, y: hazard.y, phase: hazard.spec.phase });
      }
    }
    return this.hazardView;
  }

  get randomBoxStates(): RandomBoxSpec[] {
    if (this.distance < BOX_UNLOCK_DISTANCE) return [];
    const boxes: RandomBoxSpec[] = [];
    for (const chunk of this.chunks.values()) for (const box of chunk.spec.boxes) {
      if (!this.boxRewards.opened.has(box.id)) boxes.push(box.airborne
        ? { ...box, y: box.y + Math.sin(this.time * 1.5 + box.phase) * .045 } : box);
    }
    return boxes;
  }

  snapshot(alpha: number): GameSnapshot {
    const pose = (index: number): BodyPose => ({
      x: lerp(this.previous[index].x, this.current[index].x, alpha),
      y: lerp(this.previous[index].y, this.current[index].y, alpha),
      angle: this.previous[index].angle + angleDelta(this.previous[index].angle, this.current[index].angle) * alpha,
    });
    const policeX = lerp(this.previousPoliceX, this.currentPoliceX, alpha);
    const policeSupport = this.roadSupport(policeX);
    const loopCenter = this.activeLoop ? loopGeometry(this.activeLoop.spec) : null;
    return {
      car: pose(0), wheels: [pose(1), pose(2)], distance: this.distance,
      carUpgrades: { ...this.carUpgrades }, maxHealth: this.damage.maxHealth,
      hullHealth: this.damage.hullHealth, armorMask: this.damage.armorMask,
      wheelContacts: this.roadContact.wheels.map((wheel) => this.activeLoop !== null || wheel.grounded) as [boolean, boolean],
      wheelTravel: this.roadContact.wheels.map((wheel) => this.activeLoop ? 0 : wheel.travel) as [number, number],
      wheelImpactSerials: this.roadContact.wheels.map((wheel) => wheel.impactSerial) as [number, number],
      speed: this.activeLoop?.speed ?? this.car.linvel().x, boost: this.charge, grounded: this.isGrounded,
      suctionActive: this.fansOn, boostActive: this.boostOn || (!this.crashed && this.rampBoostTime > 0),
      rampBoostSerial: this.rampBoostSerial, crashed: this.crashed, wrecked: this.wrecked,
      crashPosition: this.crashPosition ? { ...this.crashPosition } : null,
      suspensionOffset: this.activeLoop ? lerp(this.previousSuspensionOffset, this.suspension.offset, alpha) : 0,
      suspensionPitch: this.activeLoop ? lerp(this.previousSuspensionPitch, this.suspension.pitch, alpha) : 0,
      jumpSerial: this.jumpSerial, jumpsUsed: this.jumpCount,
      jumpJetActive: this.jumpJetActive,
      frontJetActive: this.frontJetActive, rearJetActive: this.rearJetActive,
      flipsCompleted: this.flipsCompleted, flipCoins: this.flipCoins,
      jumpJetRemaining: this.jumpCount > 0 ? Math.max(0, JUMP_THRUST_DURATION - this.jumpHoldTime) : 0,
      landingSerial: this.landingSerial, landingImpact: this.landingImpact,
      crashReason: this.crashReason,
      police: { x: policeX, y: policeSupport?.y ?? roadHeight(policeX) + CAR_BODY_CLEARANCE,
        angle: policeSupport?.angle ?? Math.atan(roadSlope(policeX)),
        visibility: this.pursuit.visibility, pressure: this.pursuit.pressure, gap: this.pursuit.gap, mode: this.pursuit.mode,
        health: this.policeHealth, disabled: this.pursuit.disabled },
      policeWreck: this.policeWreck?.snapshot(alpha) ?? null,
      weapon: this.weapon.snapshot(alpha),
      loop: this.activeLoop && loopCenter ? { id: this.activeLoop.spec.id, progress: this.activeLoop.progress / (Math.PI * 2),
        centerX: loopCenter.x, centerY: loopCenter.y } : null,
      loopCompletions: this.loopCompletions,
      obstaclesDestroyed: this.obstaclesDestroyed, policeDestroyed: this.policeDestroyed,
      breakSerial: this.breakSerial, breakEvents: this.breakEvents,
      sparkSerial: this.sparkSerial, sparkEvents: this.sparkEvents,
      runXp: this.loopCompletions * LOOP_XP + this.obstaclesDestroyed * OBSTACLE_XP + this.policeDestroyed * POLICE_XP + this.boxRewards.xp,
      health: this.damage.health, impactSerial: this.damage.impactSerial,
      invincibilityRemaining: this.damage.invincibilityRemaining,
      shieldRemaining: this.boxRewards.shieldRemaining,
      unlimitedBoostRemaining: this.boxRewards.boostRemaining,
      boxCoins: this.boxRewards.coins, boxXp: this.boxRewards.xp,
      boxRewardSerial: this.boxRewards.serial, boxRewardEvents: this.boxRewards.events,
      ragdolls: Array.from(this.ragdolls.values(), actor => actor.snapshot(alpha)),
      ragdollHitCount: this.hitRagdolls.size,
      ragdollGroundSerial: this.ragdollGroundSerial,
      ragdollGroundEvents: this.ragdollGroundEvents,
      missionStats: { ...this.runMissions.stats },
    };
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }
}
