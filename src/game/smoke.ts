import * as THREE from 'three';
import type { GameSnapshot } from './physics';
import { sprungBodyPose } from './vehicle';
import { AIR_JET_X, AIR_JET_Y } from './airJets';

type SmokeSnapshot = Pick<GameSnapshot, 'car' | 'suspensionOffset' | 'suspensionPitch' | 'speed' | 'distance' |
  'health' | 'wrecked' | 'crashed' | 'jumpSerial' | 'boostActive' | 'jumpJetActive'> &
  Partial<Pick<GameSnapshot, 'frontJetActive' | 'rearJetActive'>>;

const CAPACITY = 128;
const BOOST_INTERVAL = 1 / 45;
const JUMP_INTERVAL = 1 / 50;
const DAMAGE_INTERVAL = 1 / 26;

interface Puff {
  life: number; age: number; x: number; y: number; z: number;
  vx: number; vy: number; size: number; rotation: number; darkness: number;
}

/** Jet exhaust and rising black engine smoke share one bounded draw call. */
export class CarSmoke {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly opacity = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private readonly darkness = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private readonly material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `
      attribute float smokeOpacity;
      attribute float smokeDarkness;
      varying vec2 puffUv;
      varying float puffOpacity;
      varying float puffDarkness;
      void main() {
        puffUv = uv;
        puffOpacity = smokeOpacity;
        puffDarkness = smokeDarkness;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 puffUv;
      varying float puffOpacity;
      varying float puffDarkness;
      void main() {
        vec2 p = puffUv * 2.0 - 1.0;
        float r = dot(p, p);
        float softness = exp(-mix(2.8, 1.5, puffDarkness) * r) * (1.0 - smoothstep(0.48, 1.0, r));
        vec3 color = mix(vec3(0.98, 0.99, 1.0), vec3(0.055, 0.063, 0.075), puffDarkness);
        gl_FragColor = vec4(color, softness * puffOpacity);
      }`,
  });
  private readonly puffs: Puff[] = Array.from({ length: CAPACITY }, () => ({
    life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, size: 0, rotation: 0, darkness: 0,
  }));
  private readonly transform = new THREE.Object3D();
  private cursor = 0;
  private dirty = false;
  private boostClock = 0;
  private jumpClock = 0;
  private frontJetClock = 0;
  private rearJetClock = 0;
  private damageClock = 0;
  private jumpSerial = 0;
  private previousDistance = 0;
  private previousHealth = 100;
  private wasWrecked = false;

  constructor() {
    this.geometry.setAttribute('smokeOpacity', this.opacity);
    this.geometry.setAttribute('smokeDarkness', this.darkness);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.writeInstances();
  }

  private emit(snapshot: SmokeSnapshot, kind: 'boost' | 'jump' | 'air' | 'damage', nozzle: number, burst = false): void {
    this.dirty = true;
    const puff = this.puffs[this.cursor];
    this.cursor = (this.cursor + 1) % CAPACITY;
    const body = sprungBodyPose(snapshot.car, snapshot.suspensionOffset, snapshot.suspensionPitch);
    const angle = body.angle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const localX = kind === 'damage' ? 1.25 + nozzle * 0.14 : kind === 'boost' ? -2.15 : nozzle * (kind === 'air' ? AIR_JET_X : 0.46);
    const localY = kind === 'damage' ? 0.30 : kind === 'boost' ? -0.25 : kind === 'air' ? AIR_JET_Y : -0.55;
    const spread = (Math.random() - 0.5) * (burst ? 1.8 : 0.65);
    puff.x = body.x + localX * cos - localY * sin;
    puff.y = body.y + localX * sin + localY * cos;
    puff.z = nozzle > 0 ? 1.96 : 1.70;
    puff.vx = kind === 'boost' ? -cos * 6.3 + snapshot.speed * 0.12 : sin * 4.0 + snapshot.speed * 0.20 + spread;
    puff.vy = kind === 'boost' ? -sin * 6.3 + spread : -cos * 4.0 + spread * 0.3;
    puff.life = (kind === 'boost' ? 0.72 : 0.58) + Math.random() * 0.18;
    puff.age = 0;
    puff.size = 0.18 + Math.random() * 0.13;
    puff.rotation = Math.random() * Math.PI * 2;
    puff.darkness = 0;
    if (kind === 'damage') {
      puff.vx = snapshot.speed * 0.08 - 1.2 + (Math.random() - 0.5) * 1.5;
      puff.vy = 1.5 + Math.random();
      puff.z = 1.8;
      puff.life = 1.8 + Math.random() * 0.6;
      puff.size = 0.38 + Math.random() * 0.24;
      puff.darkness = 0.93 + Math.random() * 0.07;
    }
  }

  update(snapshot: SmokeSnapshot, delta: number, running = true, damageIntensity = 1): void {
    if (snapshot.distance < this.previousDistance - 1 || snapshot.jumpSerial < this.jumpSerial ||
      snapshot.health > this.previousHealth || (this.wasWrecked && !snapshot.wrecked)) this.clear();
    this.previousDistance = snapshot.distance;
    this.previousHealth = snapshot.health;
    this.wasWrecked = snapshot.wrecked;
    const dt = running ? Math.min(Math.max(delta, 0), 0.06) : 0;
    if (dt > 0 && (snapshot.health === 0 || snapshot.wrecked)) {
      this.damageClock += dt * damageIntensity;
      while (this.damageClock >= DAMAGE_INTERVAL) {
        this.emit(snapshot, 'damage', this.cursor % 2 ? 1 : -1);
        this.damageClock -= DAMAGE_INTERVAL;
      }
    } else if (snapshot.health > 0 && !snapshot.wrecked) this.damageClock = 0;
    if (running && !snapshot.crashed) {
      if (snapshot.jumpSerial > this.jumpSerial) {
        for (let i = 0; i < 16; i++) this.emit(snapshot, 'jump', i % 2 ? 1 : -1, true);
        this.jumpClock = 0;
      }
      if (snapshot.boostActive) {
        this.boostClock += dt;
        while (this.boostClock >= BOOST_INTERVAL) {
          this.emit(snapshot, 'boost', -1);
          this.emit(snapshot, 'boost', 1);
          this.boostClock -= BOOST_INTERVAL;
        }
      } else this.boostClock = 0;
      if (snapshot.jumpJetActive) {
        this.jumpClock += dt;
        while (this.jumpClock >= JUMP_INTERVAL) {
          this.emit(snapshot, 'jump', -1);
          this.emit(snapshot, 'jump', 1);
          this.jumpClock -= JUMP_INTERVAL;
        }
      } else this.jumpClock = 0;
      for (const front of [true, false]) {
        const active = front ? snapshot.frontJetActive : snapshot.rearJetActive;
        let clock = front ? this.frontJetClock : this.rearJetClock;
        clock = active ? clock + dt : 0;
        while (clock >= JUMP_INTERVAL) {
          this.emit(snapshot, 'air', front ? 1 : -1);
          clock -= JUMP_INTERVAL;
        }
        if (front) this.frontJetClock = clock;
        else this.rearJetClock = clock;
      }
    }
    this.jumpSerial = snapshot.jumpSerial;
    for (const puff of this.puffs) {
      if (puff.age >= puff.life) continue;
      if (dt > 0) this.dirty = true;
      puff.age += dt;
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.vy += 0.55 * dt;
      puff.vx *= Math.exp(-dt * 1.7);
    }
    if (this.dirty) this.writeInstances();
  }

  private writeInstances(): void {
    let count = 0;
    for (const puff of this.puffs) {
      if (puff.life <= 0 || puff.age >= puff.life) continue;
      const t = puff.age / puff.life;
      const scale = puff.size + t * (puff.darkness > 0 ? 1.35 : 0.80);
      this.transform.position.set(puff.x, puff.y, puff.z);
      this.transform.rotation.z = puff.rotation;
      this.transform.scale.set(scale * 1.15, scale, 1);
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(count, this.transform.matrix);
      this.opacity.setX(count, Math.pow(1 - t, puff.darkness > 0 ? 0.7 : 1.5) * (puff.darkness > 0 ? 0.92 : 0.78));
      this.darkness.setX(count, puff.darkness);
      count++;
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.opacity.needsUpdate = true;
      this.darkness.needsUpdate = true;
    }
    this.dirty = false;
  }

  get activeCount(): number { return this.mesh.count; }

  updateWreck(car: GameSnapshot['car'], speed: number, age: number, delta: number, running = true): void {
    this.update({ car, speed, distance: age, suspensionOffset: 0, suspensionPitch: 0,
      health: 0, wrecked: true, crashed: true, jumpSerial: 0, boostActive: false, jumpJetActive: false }, delta, running);
  }

  clear(): void {
    this.dirty = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
    for (const puff of this.puffs) puff.life = 0;
    this.boostClock = 0;
    this.jumpClock = 0;
    this.frontJetClock = this.rearJetClock = 0;
    this.damageClock = 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
