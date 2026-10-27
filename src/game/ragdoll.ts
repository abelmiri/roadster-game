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
    if (this.hit) this.hitAge += dt;
  }

  launch(carSpeed: number): boolean {
    if (this.hit) return false;
    this.hit = true;
    this.hitAge = 0;
    const forward = Math.max(7, Math.abs(carSpeed) * .75);
    for (const [index, name] of RAGDOLL_PARTS.entries()) {
      const body = this.bodies[name];
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setLinearDamping(.22);
      body.setAngularDamping(.45);
      body.setLinvel({ x: forward + (index % 2 ? 1.2 : -.8), y: 4.5 + (index < 2 ? 2 : 0) }, true);
      body.setAngvel(index % 2 ? -2.5 : 2.5, true);
    }
    const torso = this.bodies.torso;
    torso.applyImpulseAtPoint({ x: torso.mass() * forward * .35, y: torso.mass() * 2.5 },
      { x: this.spec.x, y: this.spec.y + 1.4 }, true);
    return true;
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
