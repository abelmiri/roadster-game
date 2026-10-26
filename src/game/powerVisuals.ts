import * as THREE from 'three';
import { shieldVisible, type BoxRewardEvent, type RandomBoxSpec } from './randomBox';

/** A translucent magnetic field follows the car, including its pitch. */
export class MagneticShield {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.SphereGeometry(1, 40, 24);
  private readonly material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec3 fieldNormal; varying vec3 fieldPosition;
      void main() { fieldNormal = normalize(normalMatrix * normal); fieldPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float time; varying vec3 fieldNormal; varying vec3 fieldPosition;
      void main() {
        float rim = pow(1.0 - abs(normalize(fieldNormal).z), 2.2);
        float bands = pow(max(0.0, sin(fieldPosition.y * 36.0 + time * 2.5)), 18.0);
        float pulse = 0.85 + 0.15 * sin(time * 4.0);
        gl_FragColor = vec4(mix(vec3(0.15, 0.48, 1.0), vec3(0.45, 1.0, 0.92), rim),
          (0.025 + rim * 0.48 + bands * 0.075) * pulse);
      }`,
  });
  private readonly latticeGeometry = new THREE.IcosahedronGeometry(1, 1);
  private readonly edgeGeometry = new THREE.EdgesGeometry(this.latticeGeometry);
  private readonly edgeMaterial = new THREE.LineBasicMaterial({ color: '#77f2f7', transparent: true, opacity: .16, depthWrite: false });

  constructor() {
    this.group.name = 'magnetic-shield';
    const shell = new THREE.Mesh(this.geometry, this.material);
    const lattice = new THREE.LineSegments(this.edgeGeometry, this.edgeMaterial);
    shell.scale.set(2.65, 1.48, 1.02);
    lattice.scale.copy(shell.scale).multiplyScalar(1.015);
    this.group.add(shell, lattice);
    this.group.position.set(0, -.08, .15);
    this.group.visible = false;
  }

  update(remaining: number, delta: number, running: boolean, crashed = false): void {
    if (running) this.material.uniforms.time.value += delta;
    this.group.visible = !crashed && shieldVisible(remaining);
  }

  dispose(): void {
    this.geometry.dispose(); this.latticeGeometry.dispose(); this.edgeGeometry.dispose(); this.material.dispose(); this.edgeMaterial.dispose();
    this.group.removeFromParent();
  }
}

interface BoxFlap {
  hinge: THREE.Group;
  petal: THREE.Group;
  axis: 'x' | 'z';
  direction: number;
}

interface BoxView {
  group: THREE.Group;
  flaps: BoxFlap[];
  flames: THREE.Mesh[];
  mode: 'idle' | 'opening' | 'launching';
  x: number;
  y: number;
  phase: number;
  age: number;
  jetDelays: number[];
}

const BOX_VISUAL_SECONDS = 3;
const MAX_BOX_VISUALS = 48;
const BOX_SMOKE_CAPACITY = 256;
const BOX_SMOKE_PUFFS = 32;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const boxNoise = (value: number): number => {
  const sample = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return sample - Math.floor(sample);
};

/** Closed crates, unfolding walls and launches share their geometry. Purple
 * smoke has one bounded draw and bends farther downwind as each puff rises. */
export class RandomBoxVisuals {
  readonly group = new THREE.Group();
  private readonly crates = new Map<string, BoxView>();
  private readonly floorGeometry = new THREE.BoxGeometry(1.05, .10, .85);
  private readonly frontGeometry = new THREE.BoxGeometry(1.05, 1, .08);
  private readonly sideGeometry = new THREE.BoxGeometry(.08, 1, .85);
  private readonly frontRailGeometry = new THREE.BoxGeometry(1.12, .085, .105);
  private readonly sideRailGeometry = new THREE.BoxGeometry(.105, .085, .92);
  private readonly frontRoofGeometry = this.roofGeometry([
    [-.525, 0, 0], [.525, 0, 0], [0, 0, -.425],
  ]);
  private readonly sideRoofGeometry = this.roofGeometry([
    [0, 0, -.425], [0, 0, .425], [.525, 0, 0],
  ]);
  private readonly nozzleGeometry = new THREE.CylinderGeometry(.11, .08, .19, 10);
  private readonly flameGeometry = new THREE.ConeGeometry(.08, .38, 10);
  private readonly shell = new THREE.MeshLambertMaterial({ color: '#49246d', flatShading: true, side: THREE.DoubleSide });
  private readonly frame = new THREE.MeshLambertMaterial({ color: '#bc80ec', flatShading: true });
  private readonly nozzle = new THREE.MeshLambertMaterial({ color: '#263342' });
  private readonly glow = new THREE.MeshBasicMaterial({ color: '#c5a1ff' });
  private readonly markGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-.15, .17, .055), new THREE.Vector3(-.1, .28, .055),
    new THREE.Vector3(.13, .28, .055), new THREE.Vector3(.20, .13, .055),
    new THREE.Vector3(0, -.02, .055), new THREE.Vector3(0, -.13, .055),
  ]);
  private readonly markMaterial = new THREE.LineBasicMaterial({ color: '#f6dbff' });
  private readonly dotGeometry = new THREE.CircleGeometry(.045, 10);
  private readonly smokeGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly smokeOpacity = new THREE.InstancedBufferAttribute(new Float32Array(BOX_SMOKE_CAPACITY), 1);
  private readonly smokeMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `attribute float puffOpacity; varying vec2 puffUv; varying float opacity;
      void main() { puffUv = uv; opacity = puffOpacity;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 puffUv; varying float opacity;
      void main() { float r = length(puffUv * 2.0 - 1.0);
        float alpha = exp(-2.2 * r * r) * (1.0 - smoothstep(0.35, 1.0, r));
        gl_FragColor = vec4(mix(vec3(0.56, 0.13, 0.9), vec3(0.85, 0.48, 1.0), r), alpha * opacity); }`,
  });
  readonly smoke: THREE.InstancedMesh;
  private readonly transform = new THREE.Object3D();
  private elapsed = 0;
  private lastSerial = 0;

  constructor() {
    this.smokeGeometry.setAttribute('puffOpacity', this.smokeOpacity);
    this.smoke = new THREE.InstancedMesh(this.smokeGeometry, this.smokeMaterial, BOX_SMOKE_CAPACITY);
    this.smoke.name = 'box-purple-smoke';
    this.smoke.userData.windDirection = -1;
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smoke.frustumCulled = false;
    this.smoke.count = 0;
    this.smoke.renderOrder = 2;
    this.group.add(this.smoke);
  }

  private roofGeometry(points: number[][]): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  private create(box: RandomBoxSpec): BoxView {
    if (this.crates.size >= MAX_BOX_VISUALS) {
      const oldest = [...this.crates].find(([, view]) => view.mode === 'idle') ?? this.crates.entries().next().value;
      if (oldest) { oldest[1].group.removeFromParent(); this.crates.delete(oldest[0]); }
    }
    const crate = new THREE.Group();
    crate.name = box.id;
    crate.position.set(box.x, box.y, 1.15);
    crate.userData.airborne = box.airborne;
    crate.userData.mode = 'idle';
    crate.userData.age = 0;
    const floor = new THREE.Mesh(this.floorGeometry, this.shell);
    floor.name = 'box-floor'; floor.position.y = -.48; crate.add(floor);
    const flaps: BoxFlap[] = [];
    for (const [index, name] of ['left', 'right', 'front', 'back'].entries()) {
      const side = index < 2;
      const direction = index === 0 || index === 2 ? 1 : -1;
      const hinge = new THREE.Group();
      hinge.name = `box-flap-${name}`;
      hinge.position.set(side ? (index === 0 ? -.50 : .50) : 0, -.48, side ? 0 : index === 2 ? .40 : -.40);
      const face = new THREE.Mesh(side ? this.sideGeometry : this.frontGeometry, this.shell);
      face.position.y = .50; hinge.add(face);
      for (const y of [.045, .96]) {
        const rail = new THREE.Mesh(side ? this.sideRailGeometry : this.frontRailGeometry, this.frame);
        rail.position.y = y; hinge.add(rail);
      }
      const petal = new THREE.Group();
      petal.name = `box-roof-${name}`;
      petal.position.y = 1;
      const roof = new THREE.Mesh(side ? this.sideRoofGeometry : this.frontRoofGeometry, this.shell);
      // Each triangle reaches from one wall's top edge to the box center.
      if (index === 1 || index === 3) roof.rotation.y = Math.PI;
      petal.add(roof); hinge.add(petal); crate.add(hinge);
      flaps.push({ hinge, petal, axis: side ? 'z' : 'x', direction });
      if (index === 2) {
        const mark = new THREE.Line(this.markGeometry, this.markMaterial);
        mark.position.y = .48; hinge.add(mark);
        const dot = new THREE.Mesh(this.dotGeometry, this.glow);
        dot.position.set(0, .21, .057); hinge.add(dot);
      }
    }
    const flames: THREE.Mesh[] = [];
    if (box.airborne) for (const [index, x] of [-.31, .31].entries()) {
      const housing = new THREE.Mesh(this.nozzleGeometry, this.nozzle);
      housing.name = 'box-jet-nozzle'; housing.position.set(x, -.62, 0);
      const flame = new THREE.Mesh(this.flameGeometry, this.glow);
      flame.name = 'box-jet-flame'; flame.rotation.z = Math.PI; flame.position.set(x, -.88, .1);
      flame.userData.jetIndex = index; flame.userData.ignitionDelay = 0; flame.userData.ignited = false;
      flames.push(flame);
      crate.add(housing, flame);
    }
    this.group.add(crate);
    const view: BoxView = { group: crate, flaps, flames, mode: 'idle', x: box.x, y: box.y,
      phase: box.phase, age: 0, jetDelays: [] };
    this.crates.set(box.id, view);
    return view;
  }

  private reset(): void {
    for (const view of this.crates.values()) view.group.removeFromParent();
    this.crates.clear(); this.elapsed = 0; this.lastSerial = 0;
    this.smoke.count = 0;
  }

  update(boxes: readonly RandomBoxSpec[], delta: number, running: boolean,
    events: readonly BoxRewardEvent[] = [], serial = 0): void {
    const dt = running && Number.isFinite(delta) ? Math.max(0, delta) : 0;
    if (serial < this.lastSerial) this.reset();
    this.elapsed += dt;
    const alive = new Set(boxes.map(box => box.id));
    // Remove streamed-out idle crates first; reward animations finish locally
    // even when their physics target disappears from the chunk immediately.
    for (const [id, view] of this.crates) if (view.mode === 'idle' && !alive.has(id)
      && !events.some(event => event.serial > this.lastSerial && event.boxId === id)) {
      view.group.removeFromParent(); this.crates.delete(id);
    }
    const fresh = new Set<BoxView>();
    for (const event of events) if (event.serial > this.lastSerial && event.serial <= serial && event.age < BOX_VISUAL_SECONDS) {
      const view = this.crates.get(event.boxId) ?? this.create({ id: event.boxId, x: event.x, y: event.y,
        airborne: event.airborne, phase: event.phase });
      view.mode = event.airborne ? 'launching' : 'opening';
      view.x = event.x; view.y = event.y; view.phase = event.phase;
      view.age = Math.max(0, event.age);
      view.group.userData.mode = view.mode;
      if (event.airborne) {
        view.jetDelays = [0, 1].map(index => .05 + boxNoise(event.phase + event.serial * .731 + index * 7.41) * .25);
        view.group.userData.jetDelays = [...view.jetDelays];
        view.flames.forEach((flame, index) => { flame.userData.ignitionDelay = view.jetDelays[index]; });
      }
      fresh.add(view);
    }
    this.lastSerial = serial;
    for (const box of boxes.slice(0, MAX_BOX_VISUALS)) {
      const view = this.crates.get(box.id) ?? this.create(box);
      if (view.mode !== 'idle') continue;
      view.x = box.x; view.y = box.y; view.phase = box.phase;
      view.group.position.set(box.x, box.y, 1.15);
      for (const [index, flame] of view.flames.entries()) {
        const scale = .68 + Math.sin(this.elapsed * 23 + box.phase + index * 2.1) * .12;
        flame.scale.set(1, scale, 1); flame.position.y = -.72 - .19 * scale;
      }
    }
    for (const [id, view] of this.crates) if (view.mode !== 'idle') {
      // An event may first arrive after several physics ticks. Honor that age
      // instead of replaying its first frame, then advance only simulation time.
      if (!fresh.has(view) || view.age === 0) view.age += dt;
      if (running) {
        const event = events.find(item => item.boxId === id);
        if (event) view.age = Math.max(view.age, event.age);
      }
      if (view.age >= BOX_VISUAL_SECONDS) {
        view.group.removeFromParent(); this.crates.delete(id); continue;
      }
      view.group.userData.age = view.age;
      const fade = clamp01((BOX_VISUAL_SECONDS - view.age) / .3);
      view.group.scale.setScalar(fade);
      if (view.mode === 'opening') {
        const opened = 1 - (1 - clamp01(view.age / .65)) ** 3;
        for (const flap of view.flaps) {
          const angle = 1.48 * opened * flap.direction;
          flap.hinge.rotation[flap.axis] = angle;
          flap.petal.rotation[flap.axis] = angle;
        }
      } else {
        const launchAge = Math.max(0, view.age - Math.min(...view.jetDelays));
        view.group.position.set(view.x + Math.sin(view.phase) * launchAge * .10,
          view.y + launchAge * .65 + launchAge * launchAge * 3.7, 1.15);
        const ignition = view.jetDelays.map(delay => view.age >= delay);
        view.group.rotation.z = Math.sin(view.age * 9 + view.phase) * .09 * Math.exp(-view.age)
          + (Number(ignition[0]) - Number(ignition[1])) * .07;
        for (const [index, flame] of view.flames.entries()) {
          flame.userData.ignited = ignition[index];
          const power = ignition[index] ? 4.5 + Math.sin(view.age * 73 + view.phase + index * 2.7) * 1.25 : .25;
          flame.scale.set(ignition[index] ? 1.2 : .55, power, ignition[index] ? 1.2 : .55);
          flame.position.y = -.72 - .19 * power;
        }
      }
    }
    let count = 0;
    for (const box of boxes) {
      if (this.crates.get(box.id)?.mode !== 'idle') continue;
      for (let i = 0; i < BOX_SMOKE_PUFFS && count < BOX_SMOKE_CAPACITY; i++) {
        const age = (this.elapsed * .36 + i / BOX_SMOKE_PUFFS + box.phase / (Math.PI * 2)) % 1;
        const phase = i * 2.4 + box.phase;
        const wind = -1.65 * age ** 1.7;
        const curl = Math.sin(phase + age * 5) * (.06 + age * .13);
        this.transform.position.set(box.x + wind + curl, box.y + .55 + age * 3.8, 1.75);
        this.transform.rotation.z = phase + age;
        const size = .55 + age * 1.6;
        this.transform.scale.set(size, size * .9, 1);
        this.transform.updateMatrix();
        this.smoke.setMatrixAt(count, this.transform.matrix);
        this.smokeOpacity.setX(count++, .68 * Math.sin(Math.PI * age) ** .6 * (1 - age * .25));
      }
    }
    this.smoke.count = count;
    this.smoke.instanceMatrix.needsUpdate = this.smokeOpacity.needsUpdate = true;
  }

  dispose(): void {
    for (const resource of [this.floorGeometry, this.frontGeometry, this.sideGeometry, this.frontRailGeometry,
      this.sideRailGeometry, this.frontRoofGeometry, this.sideRoofGeometry, this.nozzleGeometry, this.flameGeometry,
      this.markGeometry, this.markMaterial, this.dotGeometry, this.shell, this.frame, this.nozzle, this.glow,
      this.smokeGeometry, this.smokeMaterial]) resource.dispose();
    this.crates.clear(); this.group.clear(); this.group.removeFromParent();
  }
}
