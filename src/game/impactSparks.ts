import * as THREE from 'three';
import { hash, roadHeight, roadSlope } from './track';

export interface SparkEvent {
  serial: number; x: number; y: number; vx: number; vy: number; strength: number; age: number;
  kind?: 'collision' | 'projectile' | 'terrain';
  directionX?: number; directionY?: number;
}

interface Spark {
  age: number; life: number; x: number; y: number; z: number;
  vx: number; vy: number; vz: number; width: number; heat: number;
}

const CAPACITY = 512;

/** A single bounded draw call for hot streaks that bounce, skid and cool. */
export class ImpactSparks {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly heat = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private readonly material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float sparkHeat;
      varying vec2 sparkUv;
      varying float temperature;
      void main() {
        sparkUv = uv;
        temperature = sparkHeat;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 sparkUv;
      varying float temperature;
      void main() {
        float edge = 1.0 - smoothstep(0.15, 1.0, abs(sparkUv.y * 2.0 - 1.0));
        float tip = smoothstep(0.0, 0.18, sparkUv.x) * (1.0 - smoothstep(0.7, 1.0, sparkUv.x));
        vec3 color = mix(vec3(1.0, 0.11, 0.01), vec3(1.0, 0.88, 0.38), temperature);
        gl_FragColor = vec4(color, temperature * edge * tip);
      }`,
  });
  private readonly sparks: Spark[] = Array.from({ length: CAPACITY }, () => ({
    age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, width: 0, heat: 0,
  }));
  private readonly transform = new THREE.Object3D();
  private cursor = 0;
  private serial = 0;

  constructor() {
    this.geometry.setAttribute('sparkHeat', this.heat);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 3;
  }

  private emit(event: SparkEvent): void {
    const projectile = event.kind === 'projectile' || event.kind === 'terrain';
    const terrain = event.kind === 'terrain';
    const count = terrain ? 7 : projectile ? 18 + Math.round(event.strength * 0.4) : Math.round(60 + Math.min(24, event.strength) * 1.5);
    for (let i = 0; i < count; i++) {
      const spark = this.sparks[this.cursor];
      this.cursor = (this.cursor + 1) % CAPACITY;
      const seed = event.serial * 173 + i * 19;
      const angle = projectile
        ? Math.atan2(-(event.directionY ?? 0), -(event.directionX ?? 1)) + (hash(seed + 1) - .5) * 1.25
        : (0.04 + hash(seed + 1) * 1.04) * Math.PI;
      const impulse = projectile ? 2 + hash(seed + 2) * (terrain ? 3 : 7)
        : 2.5 + hash(seed + 2) * (5 + Math.min(event.strength, 24) * 0.28);
      spark.x = event.x + (hash(seed + 3) - 0.5) * 0.16;
      spark.y = event.y + (hash(seed + 4) - 0.5) * 0.16;
      spark.z = 2.0 + hash(seed + 5) * 0.2;
      spark.vx = (projectile ? 0 : event.vx * 0.18) + Math.cos(angle) * impulse;
      spark.vy = (projectile ? 0 : Math.max(-1, event.vy * 0.1) + 1) + Math.sin(angle) * impulse;
      spark.vz = (hash(seed + 6) - 0.5) * 0.45;
      spark.width = (projectile ? .03 : .045) + hash(seed + 7) * 0.025;
      spark.heat = 0.8 + hash(seed + 8) * 0.2;
      spark.age = 0;
      spark.life = projectile ? .6 + hash(seed + 9) * (terrain ? .5 : .9) : 1.3 + hash(seed + 9) * 1.1;
    }
  }

  update(events: readonly SparkEvent[], serial: number, delta: number, running = true,
    road?: { hasRoad(x: number): boolean }): void {
    let changed = false;
    if (serial < this.serial) {
      for (const spark of this.sparks) spark.life = 0;
      this.mesh.count = 0;
      this.cursor = 0;
      changed = true;
    }
    for (const event of events) if (event.serial > this.serial) { this.emit(event); changed = true; }
    this.serial = serial;
    const dt = running ? Math.min(Math.max(delta, 0), 0.06) : 0;
    if (!changed && (!dt || !this.mesh.count)) return;
    const drag = Math.exp(-dt * 0.65);
    let count = 0;
    for (const spark of this.sparks) {
      if (spark.age >= spark.life) continue;
      spark.age += dt;
      if (spark.age >= spark.life) continue;
      spark.vy -= 22 * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.z += spark.vz * dt;
      spark.vx *= drag;
      if (dt && (road?.hasRoad(spark.x) ?? true)) {
        const floor = roadHeight(spark.x) + 0.025;
        if (spark.y < floor) {
          spark.y = floor;
          const slope = roadSlope(spark.x);
          const ny = 1 / Math.hypot(1, slope);
          const nx = -slope * ny;
          const normalSpeed = spark.vx * nx + spark.vy * ny;
          if (normalSpeed < 0) {
            spark.vx = (spark.vx - nx * normalSpeed * 1.24) * 0.64;
            spark.vy = (spark.vy - ny * normalSpeed * 1.24) * 0.64;
          }
          spark.vz *= 0.6;
        }
      }
      const heat = spark.heat * Math.pow(1 - spark.age / spark.life, 0.9);
      const length = Math.max(0.085, Math.min(0.42, Math.hypot(spark.vx, spark.vy) * 0.025));
      this.transform.position.set(spark.x, spark.y, spark.z);
      this.transform.rotation.z = Math.atan2(spark.vy, spark.vx);
      this.transform.scale.set(length, spark.width * (0.75 + heat * 0.25), 1);
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(count, this.transform.matrix);
      this.heat.setX(count, heat);
      count++;
    }
    this.mesh.count = count;
    if (count) { this.mesh.instanceMatrix.needsUpdate = true; this.heat.needsUpdate = true; }
  }

  get activeCount(): number { return this.mesh.count; }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
