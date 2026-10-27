import RAPIER from '@dimforge/rapier2d-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier2d-compat';
import type { BodyPose } from './physics';
import type { RagdollSpec } from './track';

export const RAGDOLL_PARTS = ['torso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
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

const partShapes: Record<RagdollPartName, { x: number; y: number; halfHeight: number; radius: number }> = {
  torso: { x: 0, y: 1.15, halfHeight: .36, radius: .19 },
  head: { x: 0, y: 1.93, halfHeight: 0, radius: .21 },
  leftArm: { x: -.36, y: 1.25, halfHeight: .27, radius: .10 },
  rightArm: { x: .36, y: 1.25, halfHeight: .27, radius: .10 },
  leftLeg: { x: -.17, y: .42, halfHeight: .32, radius: .11 },
  rightLeg: { x: .17, y: .42, halfHeight: .32, radius: .11 },
};

/** A standing mannequin becomes six jointed, solid rigid bodies on impact. */
export class Ragdoll {
  readonly bodies: Record<RagdollPartName, RigidBody>;
  readonly colliders: Collider[] = [];
  hit = false;
  hitAge = 0;
  private previous: Record<RagdollPartName, BodyPose>;
  private readonly downwardSpeed = {} as Record<RagdollPartName, number>;
  private groundImpactCooldown = 0;

  constructor(private readonly world: World, readonly spec: RagdollSpec) {
    const bodies = {} as Record<RagdollPartName, RigidBody>;
    for (const name of RAGDOLL_PARTS) {
      const part = partShapes[name];
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(spec.x + part.x, spec.y + part.y).setCcdEnabled(true));
      const shape = part.halfHeight
        ? RAPIER.ColliderDesc.capsule(part.halfHeight, part.radius)
        : RAPIER.ColliderDesc.ball(part.radius);
      this.colliders.push(world.createCollider(shape.setDensity(name === 'torso' ? 2 : 1)
        .setFriction(.8).setRestitution(.14).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body));
      bodies[name] = body;
    }
    this.bodies = bodies;
    const join = (name: RagdollPartName, torsoAnchor: { x: number; y: number }, partAnchor: { x: number; y: number }): void => {
      const joint = world.createImpulseJoint(RAPIER.JointData.revolute(torsoAnchor, partAnchor), bodies.torso, bodies[name], true);
      joint.setContactsEnabled(false);
    };
    join('head', { x: 0, y: .57 }, { x: 0, y: -.21 });
    join('leftArm', { x: -.25, y: .33 }, { x: .11, y: .23 });
    join('rightArm', { x: .25, y: .33 }, { x: -.11, y: .23 });
    join('leftLeg', { x: -.15, y: -.45 }, { x: .02, y: .28 });
    join('rightLeg', { x: .15, y: -.45 }, { x: -.02, y: .28 });
    this.previous = this.poses();
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
