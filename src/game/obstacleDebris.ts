import * as THREE from 'three';
import { hash, roadHeight, type HazardKind } from './track';

export interface BreakEvent {
  serial: number; hazardId: string; kind: HazardKind | 'police';
  x: number; y: number; speed: number; source: 'ram' | 'weapon'; age: number;
}

interface Fragment {
  age: number; life: number; x: number; y: number; z: number;
  vx: number; vy: number; vz: number; spin: number; angle: number;
  sx: number; sy: number; sz: number; color: number;
}
const CAPACITY = 192;

/** Bounded cosmetic fragments: one draw call, no extra rigid bodies. */
export class ObstacleDebris {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly material = new THREE.MeshLambertMaterial({ flatShading: true });
  private readonly fragments: Fragment[] = Array.from({ length: CAPACITY }, () => ({
    age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, angle: 0,
    sx: 0, sy: 0, sz: 0, color: 0,
  }));
  private readonly transform = new THREE.Object3D();
  private readonly tint = new THREE.Color();
  private cursor = 0;
  private serial = 0;

  constructor() {
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  private emit(event: BreakEvent): void {
    const count = event.kind === 'police' ? 26 : event.source === 'weapon' ? 24 : event.kind === 'drone' ? 16 : event.kind === 'pulse' ? 18 : 14;
    for (let i = 0; i < count; i++) {
      const piece = this.fragments[this.cursor];
      this.cursor = (this.cursor + 1) % CAPACITY;
      const seed = event.serial * 137 + i * 11;
      piece.age = 0;
      piece.life = 1.5 + hash(seed + 1) * 0.9;
      piece.x = event.x + (hash(seed + 2) - 0.5) * 0.8;
      piece.y = event.y + (hash(seed + 3) - 0.5) * 0.85;
      piece.z = 1.1 + (hash(seed + 4) - 0.5) * 0.7;
      if (event.source === 'weapon') {
        const angle = i / count * Math.PI * 2 + (hash(seed + 5) - 0.5) * 0.35;
        const impulse = 6 + hash(seed + 6) * 8;
        piece.vx = event.speed * 0.12 + Math.cos(angle) * impulse;
        piece.vy = 3 + Math.sin(angle) * impulse;
        piece.vz = (hash(seed + 7) - 0.5) * 4;
      } else {
        piece.vx = Math.max(0, event.speed) * 0.62 + 3 + hash(seed + 5) * 7;
        piece.vy = 2.5 + hash(seed + 6) * 5;
        piece.vz = (hash(seed + 7) - 0.5) * 1.8;
      }
      piece.spin = (hash(seed + 8) - 0.5) * 15;
      piece.angle = hash(seed + 9) * Math.PI * 2;
      piece.sx = 0.15 + hash(seed + 10) * 0.32;
      piece.sy = 0.12 + hash(seed + 11) * 0.24;
      piece.sz = 0.12 + hash(seed + 12) * 0.27;
      piece.color = i % 4 === 0 ? (event.kind === 'barrier' ? 0xff806d : 0x5cebdc) : i % 5 === 0 ? 0xa5b8ca : 0x23364d;
    }
  }

  update(events: readonly BreakEvent[], serial: number, delta: number, running = true,
    road?: { hasRoad(x: number): boolean }): void {
    let changed = false;
    if (serial < this.serial) {
      for (const piece of this.fragments) piece.life = 0;
      this.mesh.count = 0;
      this.cursor = 0;
      changed = true;
    }
    for (const event of events) if (event.serial > this.serial) { this.emit(event); changed = true; }
    this.serial = serial;
    const dt = running ? Math.min(Math.max(delta, 0), 0.06) : 0;
    if (!changed && (!dt || this.mesh.count === 0)) return;
    let count = 0;
    for (const piece of this.fragments) {
      if (piece.age >= piece.life) continue;
      piece.age += dt;
      if (piece.age >= piece.life) continue;
      piece.vy -= 18 * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.z += piece.vz * dt;
      piece.angle += piece.spin * dt;
      if (piece.vy < 0 && (road?.hasRoad(piece.x) ?? true)) {
        const floor = roadHeight(piece.x) + piece.sy * 0.5;
        if (piece.y < floor) {
          piece.y = floor;
          piece.vy *= -0.23;
          piece.vx *= 0.68;
          piece.spin *= 0.5;
        }
      }
      const shrink = Math.min(1, (piece.life - piece.age) / 0.35);
      this.transform.position.set(piece.x, piece.y, piece.z);
      this.transform.rotation.set(piece.angle * 0.5, piece.angle * 0.3, piece.angle);
      this.transform.scale.set(piece.sx * shrink, piece.sy * shrink, piece.sz * shrink);
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(count, this.transform.matrix);
      this.mesh.setColorAt(count, this.tint.setHex(piece.color));
      count++;
    }
    this.mesh.count = count;
    if (count) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  get activeCount(): number { return this.mesh.count; }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
