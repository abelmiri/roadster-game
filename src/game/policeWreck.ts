import RAPIER from '@dimforge/rapier2d-compat';
import type { RigidBody, World } from '@dimforge/rapier2d-compat';
import type { BodyPose } from './physics';
import { CAR_AXLE_Y, CAR_WHEEL_OFFSET, CAR_WHEEL_RADIUS } from './vehicle';

export interface PoliceWreckSnapshot {
  serial: number; age: number; body: BodyPose; wheels: [BodyPose, BodyPose]; speed: number;
}

/** Three independent rigid bodies in the same solid terrain as the player
 * wreck. No pursuit/controller corrections are applied after destruction. */
export class PoliceWreck {
  readonly body: RigidBody;
  readonly wheels: [RigidBody, RigidBody];
  age = 0;
  private previous: [BodyPose, BodyPose, BodyPose];

  constructor(private readonly world: World, readonly serial: number, pose: BodyPose, speed: number) {
    const c = Math.cos(pose.angle); const s = Math.sin(pose.angle);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pose.x, pose.y)
      .setRotation(pose.angle).setLinearDamping(.18).setAngularDamping(.45).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.roundCuboid(1.73, .25, .08).setTranslation(0, .1)
      .setDensity(1.25).setFriction(.6).setRestitution(.16).setCollisionGroups(0x00080001), this.body);
    this.body.setLinvel({ x: speed * c, y: speed * s + 1.2 }, true);
    this.body.setAngvel(-.9, true);
    this.wheels = [-CAR_WHEEL_OFFSET, CAR_WHEEL_OFFSET].map((offset, index) => {
      const wheel = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pose.x + offset * c - CAR_AXLE_Y * s, pose.y + offset * s + CAR_AXLE_Y * c)
        .setLinearDamping(.12).setAngularDamping(.3).setCcdEnabled(true));
      world.createCollider(RAPIER.ColliderDesc.ball(CAR_WHEEL_RADIUS).setDensity(.8)
        .setFriction(.6).setRestitution(.2).setCollisionGroups(0x00100011), wheel);
      wheel.setLinvel({ x: speed * c + (index ? 2.8 : -2.3), y: speed * s + 2.1 + index * .8 }, true);
      wheel.setAngvel(-speed / CAR_WHEEL_RADIUS + (index ? 3 : -3), true);
      return wheel;
    }) as [RigidBody, RigidBody];
    this.previous = this.poses();
  }

  private poses(): [BodyPose, BodyPose, BodyPose] {
    return [this.body, ...this.wheels].map(part => ({ ...part.translation(), angle: part.rotation() })) as [BodyPose, BodyPose, BodyPose];
  }

  beforeStep(dt: number): void { this.previous = this.poses(); this.age += dt; }

  snapshot(alpha: number): PoliceWreckSnapshot {
    const parts = this.poses().map((pose, i) => {
      const previous = this.previous[i];
      return { x: previous.x + (pose.x - previous.x) * alpha, y: previous.y + (pose.y - previous.y) * alpha,
        angle: previous.angle + Math.atan2(Math.sin(pose.angle - previous.angle), Math.cos(pose.angle - previous.angle)) * alpha };
    });
    return { serial: this.serial, age: this.age, body: parts[0], wheels: [parts[1], parts[2]], speed: this.body.linvel().x };
  }

  dispose(): void { for (const part of [this.body, ...this.wheels]) this.world.removeRigidBody(part); }
}
