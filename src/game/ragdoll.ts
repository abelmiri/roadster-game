import RAPIER from '@dimforge/rapier2d-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier2d-compat';
import type { BodyPose } from './physics';
import type { RagdollSpec } from './track';

export const RAGDOLL_PARTS = [
  'torso', 'head', 'leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm',
  'leftThigh', 'leftShin', 'rightThigh', 'rightShin',
] as const;
export type RagdollPartName = typeof RAGDOLL_PARTS[number];
export interface RagdollSnapshot {
  id: number;
  outfit: number;
  hit: boolean;
  hitAge: number;
  parts: Record<RagdollPartName, BodyPose>;
}
export interface RagdollImpact { x: number; y: number; vx: number; vy: number; angle: number }
export interface RagdollGroundEvent { serial: number; x: number; y: number; speed: number; hard: boolean; age: number }

const partShapes: Record<RagdollPartName, { halfHeight: number; radius: number }> = {
  torso: { halfHeight: .34, radius: .19 },
  head: { halfHeight: 0, radius: .21 },
  leftUpperArm: { halfHeight: .14, radius: .09 },
  leftForearm: { halfHeight: .13, radius: .085 },
  rightUpperArm: { halfHeight: .14, radius: .09 },
  rightForearm: { halfHeight: .13, radius: .085 },
  leftThigh: { halfHeight: .13, radius: .105 },
  leftShin: { halfHeight: .14, radius: .105 },
  rightThigh: { halfHeight: .13, radius: .105 },
  rightShin: { halfHeight: .14, radius: .105 },
};

const at = (pose: BodyPose, x: number, y: number): { x: number; y: number } => ({
  x: pose.x + x * Math.cos(pose.angle) - y * Math.sin(pose.angle),
  y: pose.y + x * Math.sin(pose.angle) + y * Math.cos(pose.angle),
});
const below = (point: { x: number; y: number }, angle: number, length: number): BodyPose => ({
  x: point.x + Math.sin(angle) * length,
  y: point.y - Math.cos(angle) * length,
  angle,
});

/** A standing mannequin becomes ten jointed, solid rigid bodies on impact. */
export class Ragdoll {
  readonly bodies: Record<RagdollPartName, RigidBody>;
  readonly colliders: Collider[] = [];
  hit = false;
  hitAge = 0;
  private previous: Record<RagdollPartName, BodyPose>;
  private readonly downwardSpeed = {} as Record<RagdollPartName, number>;
  private groundImpactCooldown = 0;
  private idleTime: number;

  constructor(private readonly world: World, readonly spec: RagdollSpec) {
    this.idleTime = spec.siteId * .83 + spec.memberIndex * 1.17;
    const bodies = {} as Record<RagdollPartName, RigidBody>;
    const standing = this.standingPose();
    for (const name of RAGDOLL_PARTS) {
      const part = partShapes[name];
      const pose = standing[name];
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(pose.x, pose.y).setRotation(pose.angle).setCcdEnabled(true));
      const shape = part.halfHeight
        ? RAPIER.ColliderDesc.capsule(part.halfHeight, part.radius)
        : RAPIER.ColliderDesc.ball(part.radius);
      this.colliders.push(world.createCollider(shape.setDensity(name === 'torso' ? 2 : 1)
        .setFriction(.8).setRestitution(.14).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body));
      bodies[name] = body;
    }
    this.bodies = bodies;
    const join = (parent: RagdollPartName, child: RagdollPartName,
      parentAnchor: { x: number; y: number }, childAnchor: { x: number; y: number }): void => {
      const joint = world.createImpulseJoint(RAPIER.JointData.revolute(parentAnchor, childAnchor), bodies[parent], bodies[child], true);
      joint.setContactsEnabled(false);
    };
    join('torso', 'head', { x: 0, y: .53 }, { x: 0, y: -.21 });
    for (const side of ['left', 'right'] as const) {
      const direction = side === 'left' ? -1 : 1;
      const upper = `${side}UpperArm` as RagdollPartName;
      const forearm = `${side}Forearm` as RagdollPartName;
      const thigh = `${side}Thigh` as RagdollPartName;
      const shin = `${side}Shin` as RagdollPartName;
      join('torso', upper, { x: direction * .24, y: .30 }, { x: 0, y: .17 });
      join(upper, forearm, { x: 0, y: -.17 }, { x: 0, y: .16 });
      join('torso', thigh, { x: direction * .15, y: -.34 }, { x: 0, y: .17 });
      join(thigh, shin, { x: 0, y: -.17 }, { x: 0, y: .17 });
    }
    this.previous = this.poses();
  }

  private standingPose(): Record<RagdollPartName, BodyPose> {
    const { x, y, id, siteId, memberIndex, groupSize } = this.spec;
    const middle = (groupSize - 1) / 2;
    const toward = groupSize === 1 ? (id % 2 ? 1 : -1)
      : memberIndex < middle ? 1 : memberIndex > middle ? -1 : siteId % 2 ? 1 : -1;
    const sway = Math.sin(this.idleTime * .85 + memberIndex * .37);
    const angle = toward * .045 + sway * .025 + (id % 3 - 1) * .012;
    const torso: BodyPose = { x: x + toward * .02 + sway * .016,
      y: y + 1.12 + Math.sin(this.idleTime * 1.1) * .006, angle };
    const neck = at(torso, 0, .53);
    const headAngle = angle + toward * .06 + Math.sin(this.idleTime * .68) * .025;
    const result = { torso, head: { x: neck.x - Math.sin(headAngle) * .21,
      y: neck.y + Math.cos(headAngle) * .21, angle: headAngle } } as Record<RagdollPartName, BodyPose>;
    const gesturing = groupSize > 1 && (siteId + memberIndex) % 2 === 0;
    for (const side of ['left', 'right'] as const) {
      const direction = side === 'left' ? -1 : 1;
      const towardNeighbor = gesturing && direction === toward;
      const upperAngle = towardNeighbor ? direction * (.72 + .05 * sway)
        : angle + direction * (.18 + .025 * sway);
      const forearmAngle = towardNeighbor ? direction * (1.55 + .10 * sway)
        : angle + direction * (.26 + .07 * Math.sin(this.idleTime + direction));
      const upper = below(at(torso, direction * .24, .30), upperAngle, .17);
      const forearm = below(at(upper, 0, -.17), forearmAngle, .16);
      const thighAngle = angle + direction * (.095 + memberIndex * .012);
      const shinAngle = angle + direction * .045 - thighAngle * .22;
      const thigh = below(at(torso, direction * .15, -.34), thighAngle, .17);
      const shin = below(at(thigh, 0, -.17), shinAngle, .17);
      result[`${side}UpperArm`] = upper;
      result[`${side}Forearm`] = forearm;
      result[`${side}Thigh`] = thigh;
      result[`${side}Shin`] = shin;
    }
    return result;
  }

  private poses(): Record<RagdollPartName, BodyPose> {
    const result = {} as Record<RagdollPartName, BodyPose>;
    for (const name of RAGDOLL_PARTS) {
      const body = this.bodies[name];
      result[name] = { ...body.translation(), angle: body.rotation() };
    }
    return result;
  }

  beforeStep(dt: number): void {
    this.previous = this.poses();
    if (this.hit) {
      this.hitAge += dt;
      this.groundImpactCooldown = Math.max(0, this.groundImpactCooldown - dt);
    } else {
      this.idleTime += dt;
      const standing = this.standingPose();
      for (const name of RAGDOLL_PARTS) {
        this.bodies[name].setNextKinematicTranslation(standing[name]);
        this.bodies[name].setNextKinematicRotation(standing[name].angle);
      }
    }
    for (const name of RAGDOLL_PARTS) this.downwardSpeed[name] = -this.bodies[name].linvel().y;
  }

  launch(impact: RagdollImpact): boolean {
    if (this.hit) return false;
    this.hit = true;
    this.hitAge = 0;
    const fromAbove = impact.y > this.spec.y + 1.65;
    const direction = Math.sign(impact.vx || this.spec.x - impact.x || 1);
    const forward = fromAbove ? impact.vx * .38 + direction * 2
      : direction * Math.max(7, Math.abs(impact.vx) * .75);
    const lift = Math.min(11, 3.8 + Math.abs(impact.vx) * .2
      + Math.max(0, impact.vy) * .2 + impact.vx * Math.sin(impact.angle) * .12);
    const slam = Math.min(22, Math.max(9, Math.max(0, -impact.vy) * 1.3 + Math.abs(impact.vx) * .27));
    const vertical = fromAbove ? -slam : lift;
    for (const [index, name] of RAGDOLL_PARTS.entries()) {
      const body = this.bodies[name];
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setLinearDamping(.22);
      body.setAngularDamping(.45);
      body.setLinvel({ x: forward + (index % 2 ? 1.2 : -.8),
        y: vertical + (index < 2 ? (fromAbove ? -1 : 1.5) : 0) }, true);
      body.setAngvel((index % 2 ? -2.5 : 2.5) * direction, true);
    }
    const torso = this.bodies.torso;
    torso.applyImpulseAtPoint({ x: torso.mass() * forward * .25,
      y: torso.mass() * vertical * .28 },
      { x: this.spec.x, y: this.spec.y + 1.4 }, true);
    return true;
  }

  /** Detect the strongest downward part contact, including the first slam. */
  groundImpact(surface: { hasRoad(x: number): boolean; height(x: number): number }):
    Omit<RagdollGroundEvent, 'serial' | 'age'> | null {
    if (!this.hit || this.groundImpactCooldown > 0) return null;
    let strongest: { x: number; y: number; speed: number } | null = null;
    for (const name of RAGDOLL_PARTS) {
      const speed = this.downwardSpeed[name];
      if (speed < 3.2) continue;
      const body = this.bodies[name];
      const position = body.translation();
      if (!surface.hasRoad(position.x)) continue;
      const shape = partShapes[name];
      const floor = surface.height(position.x);
      const bottom = position.y - Math.abs(Math.cos(body.rotation())) * shape.halfHeight - shape.radius;
      if (bottom > floor + .16) continue;
      if (!strongest || speed > strongest.speed) strongest = { x: position.x, y: floor, speed };
    }
    if (!strongest) return null;
    this.groundImpactCooldown = .2;
    return { ...strongest, hard: strongest.speed >= 9 };
  }

  snapshot(alpha: number): RagdollSnapshot {
    const parts = {} as Record<RagdollPartName, BodyPose>;
    for (const name of RAGDOLL_PARTS) {
      const before = this.previous[name];
      const body = this.bodies[name];
      const now = body.translation();
      const angle = body.rotation();
      parts[name] = { x: before.x + (now.x - before.x) * alpha,
        y: before.y + (now.y - before.y) * alpha,
        angle: before.angle + Math.atan2(Math.sin(angle - before.angle), Math.cos(angle - before.angle)) * alpha };
    }
    return { id: this.spec.id, outfit: this.spec.outfit, hit: this.hit, hitAge: this.hitAge, parts };
  }

  dispose(): void { for (const name of RAGDOLL_PARTS) this.world.removeRigidBody(this.bodies[name]); }
}
