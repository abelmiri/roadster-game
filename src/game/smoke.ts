import * as THREE from 'three';
import type { GameSnapshot } from './physics';

const CAPACITY = 128;
const BOOST_INTERVAL = 1 / 45;
const JUMP_INTERVAL = 1 / 50;

interface Puff {
  life: number; age: number; x: number; y: number; z: number;
  vx: number; vy: number; size: number; rotation: number;
}

/** A fixed pool of soft white puffs, drawn in one instanced call. */
export class CarSmoke {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly opacity = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private readonly material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `
      attribute float smokeOpacity;
      varying vec2 puffUv;
      varying float puffOpacity;
      void main() {
        puffUv = uv;
        puffOpacity = smokeOpacity;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 puffUv;
      varying float puffOpacity;
      void main() {
        vec2 p = puffUv * 2.0 - 1.0;
        float r = dot(p, p);
        float softness = exp(-2.8 * r) * (1.0 - smoothstep(0.48, 1.0, r));
        gl_FragColor = vec4(vec3(0.98, 0.99, 1.0), softness * puffOpacity);
      }`,
  });
  private readonly puffs: Puff[] = Array.from({ length: CAPACITY }, () => ({
    life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, size: 0, rotation: 0,
  }));
  private readonly transform = new THREE.Object3D();
  private cursor = 0;
  private boostClock = 0;
  private jumpClock = 0;
  private jumpJetTime = 0;
  private jumpSerial = 0;
  private previousDistance = 0;

  constructor() {
    this.geometry.setAttribute('smokeOpacity', this.opacity);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.writeInstances();
  }

  private emit(snapshot: GameSnapshot, kind: 'boost' | 'jump', nozzle: number, burst = false): void {
    const puff = this.puffs[this.cursor];
    this.cursor = (this.cursor + 1) % CAPACITY;
    const angle = snapshot.car.angle + snapshot.suspensionPitch;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const localX = kind === 'boost' ? -2.15 : nozzle * 0.46;
    const localY = kind === 'boost' ? -0.25 : -0.55;
    const spread = (Math.random() - 0.5) * (burst ? 1.8 : 0.65);
    puff.x = snapshot.car.x + localX * cos - localY * sin;
    puff.y = snapshot.car.y + snapshot.suspensionOffset + localX * sin + localY * cos;
    puff.z = nozzle > 0 ? 1.96 : 1.70;
    puff.vx = kind === 'boost' ? -cos * 6.3 + snapshot.speed * 0.12 : sin * 4.0 + snapshot.speed * 0.20 + spread;
    puff.vy = kind === 'boost' ? -sin * 6.3 + spread : -cos * 4.0 + spread * 0.3;
    puff.life = (kind === 'boost' ? 0.72 : 0.58) + Math.random() * 0.18;
    puff.age = 0;
    puff.size = 0.18 + Math.random() * 0.13;
    puff.rotation = Math.random() * Math.PI * 2;
  }

  update(snapshot: GameSnapshot, delta: number, running = true): void {
    if (snapshot.distance < this.previousDistance - 1 || snapshot.jumpSerial < this.jumpSerial) this.clear();
    this.previousDistance = snapshot.distance;
    const dt = running ? Math.min(Math.max(delta, 0), 0.06) : 0;
    if (running && !snapshot.crashed) {
      if (snapshot.jumpSerial > this.jumpSerial) {
        for (let i = 0; i < 16; i++) this.emit(snapshot, 'jump', i % 2 ? 1 : -1, true);
        this.jumpJetTime = 0.16;
        this.jumpClock = 0;
      }
      if (snapshot.boostActive && !snapshot.grounded) {
        this.boostClock += dt;
        while (this.boostClock >= BOOST_INTERVAL) {
          this.emit(snapshot, 'boost', -1);
          this.emit(snapshot, 'boost', 1);
          this.boostClock -= BOOST_INTERVAL;
        }
      } else this.boostClock = 0;
      if (this.jumpJetTime > 0) {
        this.jumpClock += dt;
        while (this.jumpClock >= JUMP_INTERVAL) {
          this.emit(snapshot, 'jump', -1);
          this.emit(snapshot, 'jump', 1);
          this.jumpClock -= JUMP_INTERVAL;
        }
        this.jumpJetTime = Math.max(0, this.jumpJetTime - dt);
      }
    }
    this.jumpSerial = snapshot.jumpSerial;
    for (const puff of this.puffs) {
      if (puff.age >= puff.life) continue;
      puff.age += dt;
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.vy += 0.55 * dt;
      puff.vx *= Math.exp(-dt * 1.7);
    }
    this.writeInstances();
  }

  private writeInstances(): void {
    for (let i = 0; i < CAPACITY; i++) {
      const puff = this.puffs[i];
      const alive = puff.life > 0 && puff.age < puff.life;
      const t = alive ? puff.age / puff.life : 1;
      const scale = alive ? puff.size + t * 0.80 : 0;
      this.transform.position.set(puff.x, puff.y, puff.z);
      this.transform.rotation.z = puff.rotation;
      this.transform.scale.set(scale * 1.15, scale, 1);
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(i, this.transform.matrix);
      this.opacity.setX(i, alive ? Math.pow(1 - t, 1.5) * 0.78 : 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacity.needsUpdate = true;
  }

  get activeCount(): number {
    return this.puffs.reduce((count, puff) => count + Number(puff.life > 0 && puff.age < puff.life), 0);
  }

  private clear(): void {
    for (const puff of this.puffs) puff.life = 0;
    this.boostClock = 0;
    this.jumpJetTime = 0;
    this.jumpClock = 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
