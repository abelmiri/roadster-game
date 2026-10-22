import * as THREE from 'three';
import type { GamePhysics, GameSnapshot } from './physics';
import { getDistrict, hash, roadHeight, type HazardKind, type TrackChunk } from './track';
import { CAR_ARCH_RADIUS, CAR_AXLE_Y, CAR_WHEEL_OFFSET, CAR_WHEEL_RADIUS } from './vehicle';
import { CarSmoke } from './smoke';

interface Theme {
  sky: string; haze: string; far: string; middle: string; near: string;
  road: string; roadSide: string; stripe: string; light: string;
}

const THEMES: Theme[] = [
  { sky: '#f8d5bc', haze: '#f7bda9', far: '#bdafba', middle: '#798ba1', near: '#465a76', road: '#263447', roadSide: '#192637', stripe: '#f8c7a0', light: '#fff0c4' },
  { sky: '#a8d7cf', haze: '#80c8bf', far: '#80b5ba', middle: '#4f8499', near: '#2d5c74', road: '#203749', roadSide: '#122b3b', stripe: '#c8eee0', light: '#e1fff7' },
  { sky: '#18233f', haze: '#34416b', far: '#374368', middle: '#253755', near: '#172841', road: '#172338', roadSide: '#101a2b', stripe: '#65ddda', light: '#ffb790' },
];

const color = (value: string): THREE.Color => new THREE.Color(value);
const ease = (t: number): number => t * t * (3 - 2 * t);
const mix = (a: string, b: string, t: number): THREE.Color => color(a).lerp(color(b), t);

interface ChunkView { group: THREE.Group; hazards: Map<string, THREE.Group> }
interface Building { mesh: THREE.Group; baseX: number; depth: number }
interface CityMotion { mesh: THREE.Group; baseX: number; speed: number; phase: number }

function box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) child.geometry.dispose();
  });
  group.removeFromParent();
}

export class GameVisuals {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.OrthographicCamera;
  private readonly worldGroup = new THREE.Group();
  private readonly backdrop = new THREE.Group();
  private readonly chunks = new Map<number, ChunkView>();
  private readonly buildings: Building[] = [];
  private readonly traffic: CityMotion[] = [];
  private readonly signs: CityMotion[] = [];
  private readonly farMat = new THREE.MeshLambertMaterial({ color: THEMES[0].far, flatShading: true });
  private readonly midMat = new THREE.MeshLambertMaterial({ color: THEMES[0].middle, flatShading: true });
  private readonly nearMat = new THREE.MeshLambertMaterial({ color: THEMES[0].near, flatShading: true });
  private readonly roadMat = new THREE.MeshLambertMaterial({ color: THEMES[0].road, flatShading: true });
  private readonly roadSideMat = new THREE.MeshLambertMaterial({ color: THEMES[0].roadSide, flatShading: true });
  private readonly stripeMat = new THREE.MeshBasicMaterial({ color: THEMES[0].stripe });
  private readonly windowMat = new THREE.MeshBasicMaterial({ color: THEMES[0].light });
  private readonly poleMat = new THREE.MeshLambertMaterial({ color: '#334d62' });
  private readonly lampMat = new THREE.MeshBasicMaterial({ color: '#dffaf0' });
  private readonly edgeMat = new THREE.LineBasicMaterial({ color: '#79d5c8', transparent: true, opacity: 0.72 });
  private readonly hazardMat = new THREE.MeshStandardMaterial({ color: '#23364d', roughness: 0.48, metalness: 0.3, flatShading: true });
  private readonly cyanMat = new THREE.MeshBasicMaterial({ color: '#5cebdc' });
  private readonly coralMat = new THREE.MeshBasicMaterial({ color: '#ff806d' });
  private readonly sunMat = new THREE.MeshBasicMaterial({ color: '#fff4d9', transparent: true });
  private readonly moonMat = new THREE.MeshBasicMaterial({ color: '#cce5f6', transparent: true, opacity: 0 });
  private readonly starMat = new THREE.PointsMaterial({ color: '#e5f5ff', size: 0.07, transparent: true, opacity: 0, sizeAttenuation: false });
  private readonly carGroup = new THREE.Group();
  private readonly wheelGroups: [THREE.Group, THREE.Group];
  private readonly fanGlow: THREE.Mesh;
  private readonly smoke = new CarSmoke();
  private sun!: THREE.Mesh;
  private moon!: THREE.Mesh;
  private stars!: THREE.Points;
  private cameraX = 4;
  private cameraY = 2.3;
  private elapsed = 0;
  private qualityReduced = false;
  private slowFrames = 0;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(THEMES[0].sky);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-16, 16, 9, -9, 0.1, 120);
    this.camera.position.set(this.cameraX, this.cameraY, 36);
    this.camera.lookAt(this.cameraX, this.cameraY, 0);
    this.scene.add(this.backdrop, this.worldGroup);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x536177, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(-8, 14, 22);
    this.scene.add(light);

    this.createSky();
    this.createBuildings();
    this.createCityMotion();
    this.createCar();
    this.wheelGroups = [this.createWheel(), this.createWheel()];
    this.worldGroup.add(this.carGroup, ...this.wheelGroups, this.smoke.mesh);
    this.fanGlow = box(1.8, 0.07, 0.55, new THREE.MeshBasicMaterial({ color: '#58f4dd', transparent: true, opacity: 0.8 }));
    this.fanGlow.position.set(0, -0.48, 0.08);
    this.fanGlow.visible = false;
    this.carGroup.add(this.fanGlow);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private createSky(): void {
    const disc = new THREE.CircleGeometry(1.45, 48);
    this.sun = new THREE.Mesh(disc, this.sunMat);
    this.sun.position.z = -29;
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(0.92, 40), this.moonMat);
    this.moon.position.z = -28;
    this.backdrop.add(this.sun, this.moon);

    const positions: number[] = [];
    for (let i = 0; i < 90; i++) {
      positions.push((hash(i + 400) - 0.5) * 90, hash(i + 1000) * 13 - 1, -27);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.stars = new THREE.Points(geometry, this.starMat);
    this.backdrop.add(this.stars);

    const cloudMat = new THREE.MeshBasicMaterial({ color: '#fff4e4', transparent: true, opacity: 0.25, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const cloud = new THREE.Mesh(new THREE.CircleGeometry(1, 20), cloudMat);
      cloud.scale.set(1.7 + hash(i + 21) * 2.2, 0.23 + hash(i + 35) * 0.14, 1);
      cloud.position.set((hash(i + 18) - 0.5) * 95, 5.4 + hash(i + 37) * 5.8, -25);
      this.backdrop.add(cloud);
    }
  }

  private createBuildings(): void {
    const layers = [
      { count: 37, depth: -18, material: this.farMat, base: -1.5, min: 3.0, max: 8.0, width: 2.5 },
      { count: 33, depth: -12, material: this.midMat, base: -2.6, min: 3.8, max: 9.5, width: 3.2 },
      { count: 28, depth: -6.3, material: this.nearMat, base: -3.9, min: 3.8, max: 10.5, width: 3.9 },
    ];
    for (const [layerIndex, layer] of layers.entries()) {
      for (let i = 0; i < layer.count; i++) {
        const group = new THREE.Group();
        const width = layer.width * (0.7 + hash(i * 5 + layerIndex) * 0.62);
        const height = layer.min + hash(i * 11 + layerIndex * 60) * (layer.max - layer.min);
        const body = box(width, height, 0.9 + layerIndex * 0.2, layer.material);
        body.position.y = layer.base + height / 2;
        group.add(body);

        if (i % 3 === 0) {
          const roof = box(width * 0.73, 0.18, 1.4, layer.material);
          roof.position.y = layer.base + height + 0.08;
          group.add(roof);
        }
        if (i % 7 === 0) {
          const antenna = box(0.055, 0.9, 0.055, layer.material);
          antenna.position.set(width * 0.20, layer.base + height + 0.52, 0);
          group.add(antenna);
        }
        if (layerIndex > 0 && i % 2 === 0) {
          const cols = Math.max(1, Math.floor(width / 0.65));
          const rows = Math.max(1, Math.floor(height / 1.05) - 1);
          for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
              if (hash(i * 73 + row * 17 + col * 31) < 0.46) continue;
              const window = box(0.18, 0.25, 0.02, this.windowMat);
              window.position.set((col - (cols - 1) / 2) * 0.57, layer.base + 0.72 + row * 0.83, 0.73 + layerIndex * 0.12);
              group.add(window);
            }
          }
        }
        const baseX = -60 + i * (150 / layer.count) + hash(i + layerIndex * 80) * 2;
        group.position.set(baseX, 0, layer.depth);
        this.backdrop.add(group);
        this.buildings.push({ mesh: group, baseX, depth: layerIndex });
      }
    }
  }

  private createCityMotion(): void {
    const podMat = new THREE.MeshLambertMaterial({ color: '#354f69', flatShading: true });
    const glassMat = new THREE.MeshBasicMaterial({ color: '#9cdedb' });
    for (let i = 0; i < 6; i++) {
      const pod = new THREE.Group();
      pod.add(box(1.1, 0.29, 0.55, podMat));
      const canopy = box(0.47, 0.18, 0.48, glassMat);
      canopy.position.set(0.04, 0.22, 0);
      pod.add(canopy);
      const lamp = box(0.12, 0.08, 0.47, i % 2 ? this.coralMat : this.cyanMat);
      lamp.position.set(i % 2 ? -0.57 : 0.57, -0.01, 0.02);
      pod.add(lamp);
      pod.position.set(0, 2.8 + (i % 3) * 1.05, -4.8);
      this.backdrop.add(pod);
      this.traffic.push({ mesh: pod, baseX: -57 + i * 25, speed: i % 2 ? -2.4 : 3.5, phase: i * 1.7 });
    }

    for (let i = 0; i < 6; i++) {
      const sign = new THREE.Group();
      sign.add(box(1.55, 0.7, 0.14, this.hazardMat));
      const bar = box(0.92, 0.07, 0.03, this.cyanMat);
      bar.position.set(-0.07, 0.10, 0.09);
      sign.add(bar);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.34, 3), this.cyanMat);
      arrow.rotation.z = -Math.PI / 2;
      arrow.position.set(0.55, 0.10, 0.10);
      sign.add(arrow);
      const lowerBar = box(0.63, 0.05, 0.03, this.coralMat);
      lowerBar.position.set(-0.22, -0.14, 0.09);
      sign.add(lowerBar);
      sign.position.set(0, 4.0 + (i % 3) * 0.8, -5.2);
      this.backdrop.add(sign);
      this.signs.push({ mesh: sign, baseX: -54 + i * 26, speed: 0, phase: i * 2.2 });
    }
  }

  private createCar(): void {
    const white = new THREE.MeshLambertMaterial({ color: '#f3f4ee', flatShading: true });
    const top = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
    const pale = new THREE.MeshLambertMaterial({ color: '#d3d8d9', flatShading: true });
    const shade = new THREE.MeshLambertMaterial({ color: '#b3bdc5', flatShading: true });
    const glass = new THREE.MeshBasicMaterial({ color: '#101c26' });
    const glassReflection = new THREE.MeshBasicMaterial({ color: '#354851' });
    const trim = new THREE.MeshLambertMaterial({ color: '#1b2832', flatShading: true });
    const seam = new THREE.LineBasicMaterial({ color: '#65717a' });
    const profileY = (y: number): number => y > 0.30 ? 0.30 + (y - 0.30) * 0.62 : y;

    // The silhouette is a low wedge. The tire openings are part of the body
    // contour so the large wheels remain visible against any city palette.
    const bodyShape = new THREE.Shape();
    bodyShape.moveTo(-2.04, -0.43);
    bodyShape.lineTo(-2.04, 0.12);
    bodyShape.lineTo(-1.85, 0.26);
    bodyShape.lineTo(-0.95, profileY(0.45));
    bodyShape.lineTo(-0.43, profileY(0.69));
    bodyShape.lineTo(0.44, profileY(0.72));
    bodyShape.lineTo(1.10, profileY(0.35));
    bodyShape.lineTo(1.53, 0.29);
    bodyShape.lineTo(2.04, -0.05);
    bodyShape.lineTo(2.03, -0.43);
    const archRadius = CAR_ARCH_RADIUS;
    const archAngle = Math.asin((-0.43 - CAR_AXLE_Y) / archRadius);
    for (const axle of [CAR_WHEEL_OFFSET, -CAR_WHEEL_OFFSET]) {
      bodyShape.lineTo(axle + Math.cos(archAngle) * archRadius, -0.43);
      bodyShape.absarc(axle, CAR_AXLE_Y, archRadius, archAngle, Math.PI - archAngle, false);
    }
    bodyShape.closePath();
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(bodyShape, {
      depth: 1.02, bevelEnabled: false, curveSegments: 12,
    }), [white, pale]);
    body.position.z = -0.51;
    this.carGroup.add(body);

    const panel = (points: [number, number][], material: THREE.Material, z = 0.516): THREE.Mesh => {
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, profileY(y))));
      shape.closePath();
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
      mesh.position.z = z;
      this.carGroup.add(mesh);
      return mesh;
    };
    const line = (points: [number, number][], z = 0.531): void => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => new THREE.Vector3(x, profileY(y), z)));
      this.carGroup.add(new THREE.Line(geometry, seam));
    };

    // Keep the facets between the fenders so they cannot cover the tire gaps.
    panel([[-0.68, 0.31], [0.65, 0.21], [0.56, -0.35], [-0.68, -0.31]], pale);
    panel([[-0.68, -0.31], [0.56, -0.35], [0.68, -0.43], [-0.68, -0.43]], shade);
    panel([[1.87, -0.30], [2.03, -0.30], [2.03, -0.43], [1.87, -0.43]], pale);
    panel([[-2.04, -0.04], [-1.87, -0.13], [-1.87, -0.40], [-2.04, -0.43]], trim, 0.519);

    // A continuous black canopy, thin white roof and sloping windshield keep
    // the cabin long and low instead of the upright shape of the old model.
    panel([[-1.08, 0.43], [-0.41, 0.63], [0.43, 0.65], [1.00, 0.34], [0.24, 0.29]], glass, 0.522);
    panel([[-0.95, 0.44], [-0.40, 0.61], [0.36, 0.63], [0.24, 0.59], [-0.41, 0.56]], glassReflection, 0.523);
    panel([[-0.48, 0.64], [-0.43, 0.69], [0.44, 0.72], [0.50, 0.68]], top, 0.525);
    panel([[-0.44, 0.63], [-0.39, 0.64], [-0.22, 0.30], [-0.27, 0.30]], pale, 0.526);
    panel([[0.44, 0.65], [0.50, 0.68], [1.10, 0.35], [1.00, 0.34]], white, 0.526);
    panel([[0.52, 0.19], [0.82, 0.17], [0.71, 0.12], [0.51, 0.14]], glass, 0.527);
    line([[-0.65, 0.31], [-0.64, -0.29], [-0.45, -0.34], [0.53, -0.36], [0.59, 0.17]]);

    const rocker = box(1.38, 0.075, 1.055, trim);
    rocker.position.set(0, -0.425, 0.004);
    this.carGroup.add(rocker);
    const splitter = box(0.20, 0.065, 1.07, trim);
    splitter.position.set(1.965, -0.43, 0.004);
    this.carGroup.add(splitter);
    const headlight = new THREE.MeshBasicMaterial({ color: '#e9faff' });
    const tailLight = new THREE.MeshBasicMaterial({ color: '#ff6c66' });
    panel([[1.82, 0.055], [2.04, -0.06], [2.04, -0.11], [1.84, 0.015]], headlight, 0.529);
    panel([[-2.045, 0.13], [-1.85, 0.20], [-1.86, 0.15], [-2.045, 0.09]], tailLight, 0.530);
    // Rear air-boost ports and two downward jump nozzles share the smoke emitters.
    for (const z of [-0.33, 0.38]) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.17, 12), trim);
      nozzle.rotation.z = Math.PI / 2;
      nozzle.position.set(-2.055, -0.25, z);
      this.carGroup.add(nozzle);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.017, 5, 12), shade);
      rim.rotation.y = Math.PI / 2;
      rim.position.set(-2.145, -0.25, z);
      this.carGroup.add(rim);
    }
    for (const x of [-0.46, 0.46]) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.075, 0.13, 12), trim);
      nozzle.position.set(x, -0.49, 0.38);
      this.carGroup.add(nozzle);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.017, 5, 12), shade);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x, -0.555, 0.38);
      this.carGroup.add(rim);
    }
    this.carGroup.position.z = 1.15;
  }

  private createWheel(): THREE.Group {
    const group = new THREE.Group();
    const rubber = new THREE.MeshLambertMaterial({ color: '#14202a', flatShading: true });
    const rim = new THREE.MeshLambertMaterial({ color: '#45535d', flatShading: true });
    const spoke = new THREE.MeshLambertMaterial({ color: '#98a4a9', flatShading: true });
    const spokeShade = new THREE.MeshLambertMaterial({ color: '#65747d', flatShading: true });
    const core = new THREE.MeshLambertMaterial({ color: '#263742', flatShading: true });
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(CAR_WHEEL_RADIUS, CAR_WHEEL_RADIUS, 0.27, 32), rubber);
    tire.rotation.x = Math.PI / 2;
    group.add(tire);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.358, 32), core);
    face.position.z = 0.145;
    group.add(face);
    const rimRing = new THREE.Mesh(new THREE.RingGeometry(0.345, 0.373, 32), rim);
    rimRing.position.z = 0.153;
    group.add(rimRing);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const points = [[0.074, -0.025], [0.335, -0.091], [0.350, 0.010], [0.115, 0.043]];
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(
        x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle),
      )));
      shape.closePath();
      const blade = new THREE.Mesh(new THREE.ShapeGeometry(shape), i % 2 ? spokeShade : spoke);
      blade.position.z = 0.158;
      group.add(blade);
    }
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.095, 16), rim);
    hub.position.z = 0.164;
    group.add(hub);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.060, 16), core);
    cap.position.z = 0.168;
    group.add(cap);
    // The visible wheel face sits just ahead of the white fender plane.
    group.position.z = 1.55;
    return group;
  }

  private roadSection(start: number, end: number, group: THREE.Group): void {
    const shape = new THREE.Shape();
    const samples = Math.max(2, Math.ceil((end - start) / 0.35));
    shape.moveTo(start, roadHeight(start));
    for (let i = 1; i <= samples; i++) {
      const x = start + (end - start) * i / samples;
      shape.lineTo(x, roadHeight(x));
    }
    shape.lineTo(end, -10);
    shape.lineTo(start, -10);
    shape.closePath();
    const road = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false, curveSegments: 1 }), [this.roadMat, this.roadSideMat]);
    road.position.z = -0.75;
    group.add(road);

    const linePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const x = start + (end - start) * i / samples;
      linePoints.push(new THREE.Vector3(x, roadHeight(x) + 0.04, 0.55));
    }
    const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePoints), this.edgeMat);
    group.add(edge);

    for (let x = Math.ceil(start / 3.5) * 3.5; x < end - 0.6; x += 3.5) {
      const marker = box(1.0, 0.045, 0.11, this.stripeMat);
      marker.position.set(x, roadHeight(x) + 0.16, 0.74);
      group.add(marker);
    }
  }

  private makeHazard(kind: HazardKind): THREE.Group {
    const group = new THREE.Group();
    const dark = this.hazardMat;
    const cyan = this.cyanMat;
    const coral = this.coralMat;
    if (kind === 'drone') {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), dark);
      group.add(core);
      for (const direction of [-1, 1]) {
        const arm = box(0.60, 0.07, 0.18, dark);
        arm.position.x = direction * 0.54;
        group.add(arm);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 6, 18), cyan);
        ring.position.x = direction * 0.83;
        group.add(ring);
      }
      const eye = box(0.20, 0.10, 0.06, coral);
      eye.position.set(0, 0, 0.42);
      group.add(eye);
    } else {
      const body = box(1.04, kind === 'pulse' ? 1.26 : 1.03, 0.82, dark);
      group.add(body);
      const stripCount = kind === 'pulse' ? 3 : 2;
      for (let i = 0; i < stripCount; i++) {
        const strip = box(0.85, 0.10, 0.04, kind === 'pulse' ? cyan : coral);
        strip.position.set(0, -0.30 + i * 0.32, 0.44);
        strip.rotation.z = -0.15;
        group.add(strip);
      }
      if (kind === 'pulse') {
        const beacon = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.28, 4), coral);
        beacon.position.y = 0.78;
        group.add(beacon);
      }
    }
    group.position.z = 1.1;
    return group;
  }

  private addChunk(spec: TrackChunk): void {
    const group = new THREE.Group();
    if (spec.gap) {
      this.roadSection(spec.start, spec.gap.start, group);
      this.roadSection(spec.gap.end, spec.end, group);
    } else {
      this.roadSection(spec.start, spec.end, group);
    }

    for (let i = 0; i < 3; i++) {
      const x = spec.start + 5 + i * 9 + hash(spec.index * 31 + i) * 2;
      if (spec.gap && x > spec.gap.start - 1 && x < spec.gap.end + 1) continue;
      const pole = box(0.08, 3.6, 0.08, this.poleMat);
      pole.position.set(x, roadHeight(x) + 1.8, -2.1);
      group.add(pole);
      const arm = box(0.86, 0.07, 0.07, this.poleMat);
      arm.position.set(x + 0.40, roadHeight(x) + 3.55, -2.1);
      group.add(arm);
      const lamp = box(0.36, 0.08, 0.23, this.lampMat);
      lamp.position.set(x + 0.78, roadHeight(x) + 3.49, -2.0);
      group.add(lamp);
    }

    const hazards = new Map<string, THREE.Group>();
    for (const specHazard of spec.hazards) {
      const hazard = this.makeHazard(specHazard.kind);
      hazard.position.set(specHazard.x, specHazard.y + (specHazard.kind === 'drone' ? 3.0 : 0.63), 1.1);
      group.add(hazard);
      hazards.set(specHazard.id, hazard);
    }
    this.worldGroup.add(group);
    this.chunks.set(spec.index, { group, hazards });
  }

  private syncChunks(physics: GamePhysics): void {
    for (const [index, active] of physics.chunks) {
      if (!this.chunks.has(index)) this.addChunk(active.spec);
    }
    for (const [index, view] of this.chunks) {
      if (physics.chunks.has(index)) continue;
      disposeGroup(view.group);
      this.chunks.delete(index);
    }
    for (const hazard of physics.hazardStates) {
      const index = Math.floor(Number(hazard.id.split('-')[0]));
      const mesh = this.chunks.get(index)?.hazards.get(hazard.id);
      if (!mesh) continue;
      mesh.position.x = hazard.x;
      mesh.position.y = hazard.y;
      if (hazard.kind === 'drone') mesh.rotation.z = Math.sin(this.elapsed * 2 + hazard.phase) * 0.13;
      if (hazard.kind === 'pulse') mesh.scale.y = 0.90 + Math.sin(this.elapsed * 2.9 + hazard.phase) * 0.08;
    }
  }

  private updateTheme(distance: number): void {
    const district = getDistrict(distance);
    const index = Math.min(THEMES.length - 1, Math.floor(district));
    const next = Math.min(THEMES.length - 1, index + 1);
    const t = index === next ? 0 : ease(district - index);
    const a = THEMES[index];
    const b = THEMES[next];
    this.renderer.setClearColor(mix(a.sky, b.sky, t));
    this.farMat.color.copy(mix(a.far, b.far, t));
    this.midMat.color.copy(mix(a.middle, b.middle, t));
    this.nearMat.color.copy(mix(a.near, b.near, t));
    this.roadMat.color.copy(mix(a.road, b.road, t));
    this.roadSideMat.color.copy(mix(a.roadSide, b.roadSide, t));
    this.stripeMat.color.copy(mix(a.stripe, b.stripe, t));
    this.windowMat.color.copy(mix(a.light, b.light, t));
    const night = index === 2 ? 1 : next === 2 ? t : 0;
    this.starMat.opacity = night * 0.9;
    this.moonMat.opacity = night * 0.95;
    this.sunMat.opacity = 1 - night;
  }

  private updateBackdrop(): void {
    const span = 150;
    for (const building of this.buildings) {
      const factor = [0.82, 0.61, 0.37][building.depth];
      const center = this.cameraX * factor;
      let x = building.baseX + center;
      while (x < this.cameraX - 77) x += span;
      while (x > this.cameraX + 80) x -= span;
      building.mesh.position.x = x;
    }
    for (const vehicle of this.traffic) {
      let x = vehicle.baseX + this.cameraX * 0.42 + this.elapsed * vehicle.speed;
      while (x < this.cameraX - 82) x += span;
      while (x > this.cameraX + 82) x -= span;
      vehicle.mesh.position.x = x;
      vehicle.mesh.position.y = 2.8 + (Math.round(vehicle.phase / 1.7) % 3) * 1.05 + Math.sin(this.elapsed * 1.8 + vehicle.phase) * 0.10;
    }
    for (const sign of this.signs) {
      let x = sign.baseX + this.cameraX * 0.51;
      while (x < this.cameraX - 80) x += span;
      while (x > this.cameraX + 80) x -= span;
      sign.mesh.position.x = x;
      sign.mesh.position.y = 4.0 + (Math.round(sign.phase / 2.2) % 3) * 0.8 + Math.sin(this.elapsed * 1.3 + sign.phase) * 0.14;
      sign.mesh.rotation.z = Math.sin(this.elapsed * 0.8 + sign.phase) * 0.04;
    }
    this.sun.position.set(this.cameraX + 11, this.cameraY + 5.3, -29);
    this.moon.position.set(this.cameraX + 11, this.cameraY + 5.3, -28);
    this.stars.position.set(this.cameraX, this.cameraY, 0);
  }

  render(snapshot: GameSnapshot, physics: GamePhysics, delta: number, running = true): void {
    this.elapsed += delta;
    this.syncChunks(physics);
    this.updateTheme(snapshot.distance);
    this.carGroup.position.set(snapshot.car.x, snapshot.car.y + snapshot.suspensionOffset, 1.15);
    this.carGroup.rotation.z = snapshot.car.angle + snapshot.suspensionPitch;
    snapshot.wheels.forEach((pose, index) => {
      const wheel = this.wheelGroups[index];
      wheel.position.set(pose.x, pose.y, 1.55);
      wheel.rotation.z = pose.angle;
    });
    this.fanGlow.visible = snapshot.suctionActive;
    this.smoke.update(snapshot, delta, running);

    const width = this.camera.right - this.camera.left;
    const targetX = snapshot.car.x + width * 0.19;
    const targetY = roadHeight(snapshot.car.x + 8) + 2.0;
    const smoothing = 1 - Math.exp(-delta * 4.2);
    this.cameraX += (targetX - this.cameraX) * smoothing;
    this.cameraY += (targetY - this.cameraY) * smoothing;
    this.camera.position.set(this.cameraX, this.cameraY, 36);
    this.camera.lookAt(this.cameraX, this.cameraY, 0);
    this.updateBackdrop();
    this.renderer.render(this.scene, this.camera);

    if (delta > 1 / 42) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (!this.qualityReduced && this.slowFrames > 100) {
      this.qualityReduced = true;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
      this.resize();
    }
  }

  readonly resize = (): void => {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    const halfHeight = 9;
    const halfWidth = halfHeight * width / height;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    for (const view of this.chunks.values()) disposeGroup(view.group);
    this.smoke.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
