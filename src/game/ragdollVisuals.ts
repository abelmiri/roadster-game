import * as THREE from 'three';
import { RAGDOLL_PARTS, type RagdollPartName, type RagdollSnapshot } from './ragdoll';
import { RAGDOLL_OUTFIT_COUNT } from './track';

interface RagdollView {
  group: THREE.Group;
  parts: Record<RagdollPartName, THREE.Mesh>;
  flash: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  shotSerial: number;
}

interface BloodParticle { age: number; x: number; y: number; vx: number; vy: number; size: number }

/** Simple readable mannequin pieces follow the articulated Rapier bodies. */
export class RagdollVisuals {
  readonly group = new THREE.Group();
  private readonly views = new Map<number, RagdollView>();
  private readonly torso = new THREE.CapsuleGeometry(.19, .68, 5, 10);
  private readonly head = new THREE.SphereGeometry(.21, 12, 8);
  private readonly upperArm = new THREE.CapsuleGeometry(.09, .28, 5, 8);
  private readonly forearm = new THREE.CapsuleGeometry(.085, .26, 5, 8);
  private readonly thigh = new THREE.CapsuleGeometry(.105, .26, 5, 8);
  private readonly shin = new THREE.CapsuleGeometry(.105, .28, 5, 8);
  private readonly shirts = ['#e1aa62', '#4f9fc1', '#b45c76', '#8fb65a']
    .map(color => new THREE.MeshStandardMaterial({ color, roughness: .86 }));
  private readonly skin = new THREE.MeshStandardMaterial({ color: '#f3c9a8', roughness: .9 });
  private readonly pants = new THREE.MeshStandardMaterial({ color: '#526a85', roughness: .93 });
  private readonly lowerPants = new THREE.MeshStandardMaterial({ color: '#40566f', roughness: .93 });
  private readonly bloodGeometry = new THREE.SphereGeometry(1, 5, 4);
  private readonly bloodMaterial = new THREE.MeshBasicMaterial({ color: '#c51e35', transparent: true, opacity: .95,
    depthWrite: false });
  private readonly blood = new THREE.InstancedMesh(this.bloodGeometry, this.bloodMaterial, 96);
  private readonly bloodParticles: BloodParticle[] = Array.from({ length: 96 }, () =>
    ({ age: 1, x: 0, y: 0, vx: 0, vy: 0, size: 0 }));
  private bloodCursor = 0;
  private readonly transform = new THREE.Object3D();

  constructor() {
    this.blood.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blood.frustumCulled = false;
    this.blood.renderOrder = 4;
    this.group.add(this.blood);
  }

  private create(id: number, outfit: number): RagdollView {
    const group = new THREE.Group();
    group.name = `ragdoll-${id}`;
    const parts = {} as Record<RagdollPartName, THREE.Mesh>;
    for (const name of RAGDOLL_PARTS) {
      const geometry = name === 'torso' ? this.torso : name === 'head' ? this.head
        : name.endsWith('UpperArm') ? this.upperArm : name.endsWith('Forearm') ? this.forearm
          : name.endsWith('Thigh') ? this.thigh : this.shin;
      const material = name === 'torso' || name.endsWith('UpperArm')
        ? this.shirts[outfit % RAGDOLL_OUTFIT_COUNT]
        : name.endsWith('Thigh') ? this.pants : name.endsWith('Shin') ? this.lowerPants : this.skin;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.position.z = 1.22;
      group.add(mesh);
      parts[name] = mesh;
    }
    const flash = new THREE.Mesh(new THREE.RingGeometry(.37, .46, 24),
      new THREE.MeshBasicMaterial({ color: '#fff0a7', transparent: true, depthWrite: false }));
    flash.visible = false;
    flash.position.z = 1.5;
    group.add(flash);
    this.group.add(group);
    const view = { group, parts, flash, shotSerial: 0 };
    this.views.set(id, view);
    return view;
  }

  update(states: readonly RagdollSnapshot[], delta = 1 / 60): void {
    const visible = new Set<number>();
    for (const state of states) {
      visible.add(state.id);
      const view = this.views.get(state.id) ?? this.create(state.id, state.outfit);
      for (const name of RAGDOLL_PARTS) {
        const pose = state.parts[name];
        const mesh = view.parts[name];
        mesh.position.set(pose.x, pose.y, 1.22);
        mesh.rotation.z = pose.angle;
      }
      const flashAge = state.hit ? state.hitAge : Infinity;
      const newShots = Math.min(5, Math.max(0, state.shotSerial - view.shotSerial));
      view.shotSerial = state.shotSerial;
      for (let shot = 0; shot < newShots; shot++) {
        const count = 14;
        for (let index = 0; index < count; index++) {
          const particle = this.bloodParticles[this.bloodCursor];
          this.bloodCursor = (this.bloodCursor + 1) % this.bloodParticles.length;
          const angle = Math.atan2(state.hitVy, state.hitVx) + Math.PI + (index / count - .5) * 1.75;
          const speed = 2.8 + ((index * 37 + state.id * 19) % 17) * .22;
          particle.age = 0;
          particle.x = state.hitX; particle.y = state.hitY;
          particle.vx = Math.cos(angle) * speed - state.hitVx * .035;
          particle.vy = Math.sin(angle) * speed - state.hitVy * .025;
          particle.size = .035 + (index % 4) * .009;
        }
      }
      view.flash.visible = flashAge < .35;
      if (view.flash.visible) {
        const torso = state.parts.torso;
        view.flash.position.set(torso.x, torso.y, 1.5);
        view.flash.scale.setScalar(1 + flashAge * 3);
        view.flash.material.opacity = 1 - flashAge / .35;
      }
    }
    for (const [id, view] of this.views) {
      if (visible.has(id)) continue;
      view.flash.geometry.dispose();
      view.flash.material.dispose();
      view.group.removeFromParent();
      this.views.delete(id);
    }
    let bloodCount = 0;
    for (const particle of this.bloodParticles) {
      if (particle.age >= .58) continue;
      const dt = Math.min(Math.max(delta, 0), .06);
      particle.age += dt;
      particle.vy -= 9 * dt;
      particle.x += particle.vx * dt; particle.y += particle.vy * dt;
      particle.vx *= Math.exp(-2 * dt);
      const fade = Math.max(0, 1 - particle.age / .58);
      this.transform.position.set(particle.x, particle.y, 1.68);
      this.transform.scale.setScalar(particle.size * fade);
      this.transform.updateMatrix();
      this.blood.setMatrixAt(bloodCount++, this.transform.matrix);
    }
    this.blood.count = bloodCount;
    if (bloodCount) this.blood.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.update([]);
    for (const geometry of [this.torso, this.head, this.upperArm, this.forearm, this.thigh, this.shin]) geometry.dispose();
    for (const material of [...this.shirts, this.skin, this.pants, this.lowerPants]) material.dispose();
    this.bloodGeometry.dispose(); this.bloodMaterial.dispose();
    this.group.removeFromParent();
  }
}
