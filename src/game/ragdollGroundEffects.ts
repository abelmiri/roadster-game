import * as THREE from 'three';
import { hash, roadHeight } from './track';
import type { RagdollGroundEvent } from './ragdoll';

interface Particle {
  age: number; life: number; x: number; y: number; z: number;
  vx: number; vy: number; size: number;
}

const DUST_CAPACITY = 128;
const DROP_CAPACITY = 72;

/** Short, bounded bursts at the ragdoll's actual ground contacts. */
export class RagdollGroundEffects {
  readonly dust: THREE.InstancedMesh;
  readonly drops: THREE.InstancedMesh;
  private readonly dustGeometry = new THREE.CircleGeometry(1, 8);
  private readonly dropGeometry = new THREE.SphereGeometry(1, 6, 4);
  private readonly dustMaterial = new THREE.MeshBasicMaterial({ color: '#b9a083', transparent: true,
    opacity: .78, depthWrite: false });
  private readonly dropMaterial = new THREE.MeshBasicMaterial({ color: '#b42638', transparent: true,
    opacity: .95, depthWrite: false });
  private readonly dustParticles = this.pool(DUST_CAPACITY);
  private readonly dropParticles = this.pool(DROP_CAPACITY);
  private readonly transform = new THREE.Object3D();
  private dustCursor = 0;
  private dropCursor = 0;
  private serial = 0;

  constructor() {
    this.dust = new THREE.InstancedMesh(this.dustGeometry, this.dustMaterial, DUST_CAPACITY);
    this.drops = new THREE.InstancedMesh(this.dropGeometry, this.dropMaterial, DROP_CAPACITY);
    for (const mesh of [this.dust, this.drops]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 4;
    }
  }

  private pool(capacity: number): Particle[] {
    return Array.from({ length: capacity }, () => ({ age: 0, life: 0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, size: 0 }));
  }

  private emit(event: RagdollGroundEvent): void {
    const dustCount = Math.min(22, 8 + Math.round(event.speed));
    for (let index = 0; index < dustCount; index++) {
      const particle = this.dustParticles[this.dustCursor];
      this.dustCursor = (this.dustCursor + 1) % DUST_CAPACITY;
      const seed = event.serial * 181 + index * 23;
      particle.age = 0;
      particle.life = .45 + hash(seed + 1) * .35;
      particle.x = event.x + (hash(seed + 2) - .5) * .35;
      particle.y = event.y + .06;
      particle.z = 2.15 + hash(seed + 3) * .18;
      particle.vx = (hash(seed + 4) - .5) * (4 + event.speed * .22);
      particle.vy = 1 + hash(seed + 5) * 2.8;
      particle.size = .10 + hash(seed + 6) * .17;
    }
    if (!event.hard) return;
    const dropCount = Math.min(18, 5 + Math.round((event.speed - 9) * .8));
    for (let index = 0; index < dropCount; index++) {
      const particle = this.dropParticles[this.dropCursor];
      this.dropCursor = (this.dropCursor + 1) % DROP_CAPACITY;
      const seed = event.serial * 239 + index * 17;
      particle.age = 0;
      particle.life = .65 + hash(seed + 1) * .5;
      particle.x = event.x + (hash(seed + 2) - .5) * .22;
      particle.y = event.y + .17;
      particle.z = 2.36 + hash(seed + 3) * .25;
      particle.vx = (hash(seed + 4) - .5) * (5 + event.speed * .32);
      particle.vy = 2 + hash(seed + 5) * 4;
      particle.size = .035 + hash(seed + 6) * .035;
    }
  }

  private advance(particles: Particle[], mesh: THREE.InstancedMesh, dt: number, dust: boolean,
    road?: { hasRoad(x: number): boolean }): void {
    let count = 0;
    for (const particle of particles) {
      if (particle.age >= particle.life) continue;
      particle.age += dt;
      if (particle.age >= particle.life) continue;
      particle.vy -= (dust ? 7 : 17) * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.exp(-(dust ? 2.2 : .5) * dt);
      if (dt && (road?.hasRoad(particle.x) ?? true)) {
        const floor = roadHeight(particle.x) + particle.size * .35;
        if (particle.y < floor) {
          // Particles that fell through a gap must not snap back onto the
          // road when their horizontal drift reaches the far edge.
          if (particle.y < floor - .45) {
            particle.life = particle.age;
            continue;
          }
          particle.y = floor;
          particle.vy = dust ? 0 : Math.max(0, -particle.vy * .22);
          particle.vx *= dust ? .72 : .48;
        }
      }
      const fade = Math.min(1, (particle.life - particle.age) / .25);
      this.transform.position.set(particle.x, particle.y, particle.z);
      this.transform.rotation.z = dust ? Math.atan2(particle.vy, particle.vx) : 0;
      this.transform.scale.set(particle.size * fade * (dust ? 1.6 : 1),
        particle.size * fade * (dust ? .7 : 1), particle.size * fade);
      this.transform.updateMatrix();
      mesh.setMatrixAt(count++, this.transform.matrix);
    }
    mesh.count = count;
    if (count) mesh.instanceMatrix.needsUpdate = true;
  }

  update(events: readonly RagdollGroundEvent[], serial: number, delta: number, running = true,
    road?: { hasRoad(x: number): boolean }): void {
    let changed = false;
    if (serial < this.serial) {
      for (const particle of [...this.dustParticles, ...this.dropParticles]) particle.life = 0;
      this.dust.count = this.drops.count = 0;
      this.dustCursor = this.dropCursor = 0;
      changed = true;
    }
    for (const event of events) if (event.serial > this.serial) { this.emit(event); changed = true; }
    this.serial = serial;
    const dt = running ? Math.min(Math.max(delta, 0), .06) : 0;
    if (!dt && !changed) return;
    this.advance(this.dustParticles, this.dust, dt, true, road);
    this.advance(this.dropParticles, this.drops, dt, false, road);
  }

  get dustCount(): number { return this.dust.count; }
  get dropCount(): number { return this.drops.count; }

  dispose(): void {
    for (const mesh of [this.dust, this.drops]) { mesh.removeFromParent(); mesh.dispose(); }
    this.dustGeometry.dispose();
    this.dropGeometry.dispose();
    this.dustMaterial.dispose();
    this.dropMaterial.dispose();
  }
}
