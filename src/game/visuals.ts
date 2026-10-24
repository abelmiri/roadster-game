import * as THREE from 'three';
import type { GamePhysics, GameSnapshot } from './physics';
import { getDistrict, hash, roadHeight, loopsBetween, loopGeometry, type LoopSpec, type HazardKind, type TrackChunk } from './track';
import { sprungBodyPose } from './vehicle';
import { createRoadsterBody, createRoadsterWheel } from './roadsterModel';
import { CarSmoke } from './smoke';
import { CarBodyDamage } from './carBodyDamage';
import { CityBuildings } from './cityBuildings';
import { ObstacleDebris } from './obstacleDebris';
import { ImpactSparks } from './impactSparks';
import { ImpactCamera, VIEW_HALF_HEIGHT } from './impactCamera';
import { createTerrainMaterial, createTerrainGeometry, createRoadCapGeometry } from './terrain';
import { StartDepot } from './startDepot';
import { BackdropBlur } from './backdropBlur';
import { PoliceVisual } from './policeVisual';
import { carVisibleDuringProtection } from './damage';
import { CombatVisual, WeaponVisual } from './weaponVisual';

interface Theme {
  sky: string; haze: string; far: string; middle: string; near: string;
  road: string; roadSide: string; stripe: string; light: string;
}

const THEMES: Theme[] = [
  { sky: '#f8d5bc', haze: '#f7bda9', far: '#bdafba', middle: '#798ba1', near: '#465a76', road: '#263447', roadSide: '#192637', stripe: '#f8c7a0', light: '#fff0c4' },
  { sky: '#a8d7cf', haze: '#80c8bf', far: '#80b5ba', middle: '#4f8499', near: '#2d5c74', road: '#203749', roadSide: '#122b3b', stripe: '#c8eee0', light: '#e1fff7' },
  { sky: '#18233f', haze: '#34416b', far: '#374368', middle: '#253755', near: '#172841', road: '#172338', roadSide: '#101a2b', stripe: '#65ddda', light: '#ffb790' },
];

const ease = (t: number): number => t * t * (3 - 2 * t);
const THEME_COLORS = THEMES.map(theme => Object.fromEntries(Object.entries(theme).map(([key, value]) =>
  [key, new THREE.Color(value)])) as Record<keyof Theme, THREE.Color>);

interface ChunkView { group: THREE.Group; hazards: Map<string, THREE.Group> }
interface CityMotion { mesh: THREE.Group; baseX: number; altitude: number; speed: number; phase: number }

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
  private readonly traffic: CityMotion[] = [];
  private readonly backgroundDrones: CityMotion[] = [];
  private readonly farMat = new THREE.MeshLambertMaterial({ color: THEMES[0].far, flatShading: true });
  private readonly midMat = new THREE.MeshLambertMaterial({ color: THEMES[0].middle, flatShading: true });
  private readonly nearMat = new THREE.MeshLambertMaterial({ color: THEMES[0].near, flatShading: true });
  private readonly roadMat = new THREE.MeshLambertMaterial({ color: THEMES[0].road, flatShading: true });
  private readonly groundMat = createTerrainMaterial(THEMES[0].road);
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
  private readonly city = new CityBuildings(this.farMat, this.midMat, this.nearMat, this.windowMat);
  private readonly depot = new StartDepot();
  private readonly skyColor = new THREE.Color();
  private readonly hazeColor = new THREE.Color(THEMES[0].haze);
  private aspect = 1;
  private themeDistance = -1;
  private readonly carGroup = createRoadsterBody();
  private readonly bodyDamage = new CarBodyDamage(this.carGroup);
  private readonly wheelGroups: [THREE.Group, THREE.Group];
  private readonly fanGlow: THREE.Mesh;
  private readonly smoke = new CarSmoke();
  private readonly debris = new ObstacleDebris();
  private readonly sparks = new ImpactSparks();
  private readonly blur = new BackdropBlur();
  private readonly police = new PoliceVisual();
  private readonly policeWreck = new PoliceVisual(true);
  private readonly policeSmoke = new CarSmoke();
  private readonly impactCamera = new ImpactCamera();
  private readonly weapon = new WeaponVisual();
  private readonly combat = new CombatVisual();
  private readonly loops = new Map<number, THREE.Group>();
  private viewHeight = VIEW_HALF_HEIGHT;
  private baseViewHeight = VIEW_HALF_HEIGHT;
  private sun!: THREE.Mesh;
  private moon!: THREE.Mesh;
  private stars!: THREE.Points;
  private cameraX = 4;
  private cameraY = 2.3;
  private elapsed = 0;
  private policeTime = 0;
  private qualityReduced = false;
  private slowFrames = 0;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(THEMES[0].sky);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-16, 16, VIEW_HALF_HEIGHT, -VIEW_HALF_HEIGHT, 0.1, 120);
    this.camera.position.set(this.cameraX, this.cameraY, 36);
    this.camera.lookAt(this.cameraX, this.cameraY, 0);
    this.scene.add(this.backdrop, this.worldGroup);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x536177, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(-8, 14, 22);
    this.scene.add(light);

    this.createSky();
    this.backdrop.add(this.city.group);
    this.createCityMotion();
    this.carGroup.add(this.weapon.group);
    this.wheelGroups = [createRoadsterWheel(), createRoadsterWheel()];
    this.worldGroup.add(this.carGroup, ...this.wheelGroups, this.smoke.mesh, this.debris.mesh, this.sparks.mesh,
      this.police.group, this.policeWreck.group, this.policeSmoke.mesh, this.combat.group, this.depot.group);
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

  private createCityMotion(): void {
    // Decorative traffic uses muted colors, separate from the cyan/coral hazards.
    const podMat = new THREE.MeshLambertMaterial({ color: '#777f93', flatShading: true });
    const glassMat = new THREE.MeshBasicMaterial({ color: '#adb4c3' });
    const navigationMat = new THREE.MeshBasicMaterial({ color: '#d9c8aa' });
    for (let i = 0; i < 6; i++) {
      const pod = new THREE.Group();
      pod.add(box(1.1, 0.29, 0.55, podMat));
      const canopy = box(0.47, 0.18, 0.48, glassMat);
      canopy.position.set(0.04, 0.22, 0);
      pod.add(canopy);
      const lamp = box(0.10, 0.06, 0.47, navigationMat);
      lamp.position.set(i % 2 ? -0.57 : 0.57, -0.01, 0.02);
      pod.add(lamp);
      const altitude = 6.2 + (i % 3) * 1.05;
      pod.position.set(0, altitude, -7.2);
      this.backdrop.add(pod);
      this.traffic.push({ mesh: pod, baseX: -57 + i * 25, altitude, speed: i % 2 ? -2.4 : 3.5, phase: i * 1.7 });
    }

    const droneMat = new THREE.MeshLambertMaterial({ color: '#8c7d98', flatShading: true });
    const frameMat = new THREE.MeshLambertMaterial({ color: '#5b5a70', flatShading: true });
    const parcelMat = new THREE.MeshLambertMaterial({ color: '#baa78f', flatShading: true });
    const rotorMat = new THREE.MeshBasicMaterial({
      color: '#aba5b7', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
    });
    for (let i = 0; i < 6; i++) {
      const drone = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), droneMat);
      body.scale.set(0.44, 0.18, 0.27);
      drone.add(body);
      const arms = box(1.3, 0.07, 0.12, frameMat);
      arms.position.y = 0.07;
      drone.add(arms);
      for (const side of [-1, 1]) {
        const motor = box(0.13, 0.16, 0.13, frameMat);
        motor.position.set(side * 0.65, 0.16, 0);
        const rotor = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), rotorMat);
        rotor.rotation.x = Math.PI * 0.38;
        rotor.position.set(side * 0.65, 0.25, 0);
        drone.add(motor, rotor);
        const strut = box(0.055, 0.2, 0.055, frameMat);
        strut.position.set(side * 0.2, -0.2, 0);
        drone.add(strut);
      }
      const parcel = box(0.46, 0.28, 0.36, parcelMat);
      parcel.position.y = -0.35;
      drone.add(parcel);
      const lamp = box(0.10, 0.045, 0.025, navigationMat);
      lamp.position.set(0.20, -0.01, 0.26);
      drone.add(lamp);
      const altitude = 8.5 + (i % 3) * 0.9;
      drone.position.set(0, altitude, -8.2);
      this.backdrop.add(drone);
      this.backgroundDrones.push({ mesh: drone, baseX: -54 + i * 26, altitude, speed: i % 2 ? -1.1 : 1.4, phase: i * 2.2 });
    }
  }



  private roadSection(start: number, end: number, group: THREE.Group): void {
    const samples = Math.max(2, Math.ceil((end - start) / 0.35));
    const road = new THREE.Mesh(createTerrainGeometry(start, end), [this.groundMat, this.roadSideMat]);
    road.position.z = -0.75;
    group.add(road);
    group.add(new THREE.Mesh(createRoadCapGeometry(start, end), this.roadMat));

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
    for (const view of this.chunks.values()) for (const mesh of view.hazards.values()) mesh.visible = false;
    for (const hazard of physics.hazardStates) {
      const index = Math.floor(Number(hazard.id.split('-')[0]));
      const mesh = this.chunks.get(index)?.hazards.get(hazard.id);
      if (!mesh) continue;
      mesh.visible = true;
      mesh.position.x = hazard.x;
      mesh.position.y = hazard.y;
      if (hazard.kind === 'drone') mesh.rotation.z = Math.sin(this.elapsed * 2 + hazard.phase) * 0.13;
      if (hazard.kind === 'pulse') mesh.scale.y = 0.90 + Math.sin(this.elapsed * 2.9 + hazard.phase) * 0.08;
    }
  }

  private makeLoop(spec: LoopSpec): THREE.Group {
    const group = new THREE.Group();
    const center = loopGeometry(spec);
    const shape = new THREE.Shape();
    shape.absarc(0, 0, spec.radius + 0.38, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, spec.radius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const road = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false, curveSegments: 80 }), this.roadMat);
    road.position.z = -0.8; group.add(road);
    for (const radius of [spec.radius + 0.03, spec.radius + 0.34]) {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.025, 5, 120), this.cyanMat);
      stripe.position.z = 0.14; group.add(stripe);
    }
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      const marker = box(0.14, 0.045, 0.025, this.stripeMat);
      marker.position.set(Math.cos(a) * (spec.radius + 0.19), Math.sin(a) * (spec.radius + 0.19), 0.16);
      marker.rotation.z = a + Math.PI / 2; group.add(marker);
    }
    group.position.set(center.x, center.y, 0);
    this.worldGroup.add(group);
    return group;
  }

  private syncLoops(x: number): void {
    const nearby = loopsBetween(x - 35, x + 90);
    for (const spec of nearby) if (!this.loops.has(spec.id)) this.loops.set(spec.id, this.makeLoop(spec));
    for (const [id, group] of this.loops) {
      if (nearby.some((spec) => spec.id === id)) continue;
      disposeGroup(group); this.loops.delete(id);
    }
  }

  private updateTheme(distance: number): void {
    if (distance === this.themeDistance) return;
    this.themeDistance = distance;
    const district = getDistrict(distance);
    const index = Math.min(THEMES.length - 1, Math.floor(district));
    const next = Math.min(THEMES.length - 1, index + 1);
    const t = index === next ? 0 : ease(district - index);
    const a = THEME_COLORS[index];
    const b = THEME_COLORS[next];
    this.renderer.setClearColor(this.skyColor.lerpColors(a.sky, b.sky, t));
    this.farMat.color.lerpColors(a.far, b.far, t);
    this.midMat.color.lerpColors(a.middle, b.middle, t);
    this.nearMat.color.lerpColors(a.near, b.near, t);
    this.roadMat.color.lerpColors(a.road, b.road, t);
    this.groundMat.color.lerpColors(a.road, b.road, t);
    this.roadSideMat.color.lerpColors(a.roadSide, b.roadSide, t);
    this.hazeColor.lerpColors(a.haze, b.haze, t);
    this.stripeMat.color.lerpColors(a.stripe, b.stripe, t);
    this.windowMat.color.lerpColors(a.light, b.light, t);
    const night = index === 2 ? 1 : next === 2 ? t : 0;
    this.starMat.opacity = night * 0.9;
    this.moonMat.opacity = night * 0.95;
    this.sunMat.opacity = 1 - night;
  }

  private updateBackdrop(): void {
    const span = 150;
    this.city.update(this.cameraX);
    for (const vehicle of this.traffic) {
      let x = vehicle.baseX + this.cameraX * 0.42 + this.elapsed * vehicle.speed;
      while (x < this.cameraX - 82) x += span;
      while (x > this.cameraX + 82) x -= span;
      vehicle.mesh.position.x = x;
      vehicle.mesh.position.y = vehicle.altitude + Math.sin(this.elapsed * 1.8 + vehicle.phase) * 0.10;
    }
    for (const drone of this.backgroundDrones) {
      let x = drone.baseX + this.cameraX * 0.51 + this.elapsed * drone.speed;
      while (x < this.cameraX - 80) x += span;
      while (x > this.cameraX + 80) x -= span;
      drone.mesh.position.x = x;
      drone.mesh.position.y = drone.altitude + Math.sin(this.elapsed * 1.3 + drone.phase) * 0.10;
      drone.mesh.rotation.z = Math.sin(this.elapsed * 0.8 + drone.phase) * 0.025;
    }
    this.sun.position.set(this.cameraX + 11, this.cameraY + 5.3, -29);
    this.moon.position.set(this.cameraX + 11, this.cameraY + 5.3, -28);
    this.stars.position.set(this.cameraX, this.cameraY, 0);
  }

  render(snapshot: GameSnapshot, physics: GamePhysics, delta: number, running = true, impactFrozen = false, wallDelta = delta): void {
    const sceneDelta = impactFrozen ? 0 : delta;
    this.elapsed += sceneDelta;
    if (running) this.policeTime += delta;
    this.syncChunks(physics);
    this.syncLoops(snapshot.car.x);
    this.updateTheme(snapshot.distance);
    const body = sprungBodyPose(snapshot.car, snapshot.suspensionOffset, snapshot.suspensionPitch);
    this.carGroup.position.set(body.x, body.y, 1.15);
    this.carGroup.rotation.z = body.angle;
    this.bodyDamage.update(snapshot.wrecked ? 0 : snapshot.health);
    const carVisible = carVisibleDuringProtection(snapshot.invincibilityRemaining, impactFrozen || !running || snapshot.crashed);
    this.carGroup.visible = carVisible;
    snapshot.wheels.forEach((pose, index) => {
      const wheel = this.wheelGroups[index];
      wheel.position.set(pose.x, pose.y, 1.55);
      wheel.rotation.z = pose.angle;
      wheel.visible = carVisible;
    });
    this.fanGlow.visible = snapshot.suctionActive;
    this.smoke.update(snapshot, delta, running);
    this.debris.update(snapshot.breakEvents, snapshot.breakSerial, delta, running, physics.generator);
    this.sparks.update(snapshot.sparkEvents, snapshot.sparkSerial, delta, running, physics.generator);
    this.police.update(snapshot.police, this.policeTime);
    if (snapshot.policeWreck) {
      this.policeWreck.updateWreck(snapshot.policeWreck);
      this.policeSmoke.updateWreck(snapshot.policeWreck.body, snapshot.policeWreck.speed, snapshot.policeWreck.age, delta, running);
    } else {
      this.policeWreck.group.visible = false;
      if (this.policeSmoke.activeCount) this.policeSmoke.clear();
    }
    this.weapon.update(snapshot.weapon);
    this.combat.update(snapshot.weapon);

    const upcoming = loopsBetween(snapshot.car.x - 12, snapshot.car.x + 25)[0];
    const center = snapshot.loop ? { x: snapshot.loop.centerX, y: snapshot.loop.centerY } : upcoming ? loopGeometry(upcoming) : null;
    const loopView = snapshot.loop ? 1 : upcoming ? Math.max(0, 1 - Math.abs(upcoming.entryX - snapshot.car.x) / 25) : 0;
    const smoothing = 1 - Math.exp(-sceneDelta * 4.2);
    this.impactCamera.update(snapshot.sparkEvents, snapshot.sparkSerial, snapshot.crashed, wallDelta, running || impactFrozen);
    this.baseViewHeight += (VIEW_HALF_HEIGHT + loopView * 1.7 - this.baseViewHeight) * smoothing;
    const nextHeight = this.baseViewHeight / this.impactCamera.zoom;
    if (Math.abs(nextHeight - this.viewHeight) > 0.00001) {
      this.viewHeight = nextHeight;
      this.camera.left = -this.viewHeight * this.aspect; this.camera.right = this.viewHeight * this.aspect;
      this.camera.top = this.viewHeight; this.camera.bottom = -this.viewHeight;
      this.camera.updateProjectionMatrix();
    }
    const width = this.baseViewHeight * this.aspect * 2;
    let targetX = snapshot.loop && center ? center.x + width * 0.08 : snapshot.car.x + width * 0.27;
    const roadY = roadHeight(snapshot.car.x + 8) + 2.0;
    let targetY = center ? roadY + (center.y - roadY) * loopView : roadY;
    const focus = this.impactCamera.focus(snapshot.car);
    const amount = this.impactCamera.amount;
    targetX += (focus.x - targetX) * amount;
    targetY += (focus.y - targetY) * amount;
    const cameraDelta = sceneDelta + Math.max(0, wallDelta - sceneDelta) * amount;
    const tracking = 1 - Math.exp(-cameraDelta * (4.2 + amount * 10));
    this.cameraX += (targetX - this.cameraX) * tracking;
    this.cameraY += (targetY - this.cameraY) * tracking;
    this.camera.position.set(this.cameraX, this.cameraY, 36);
    this.depot.update(this.cameraX, this.viewHeight * this.aspect, this.elapsed);
    this.updateBackdrop();
    this.blur.render(this.renderer, this.scene, this.camera, this.backdrop, this.worldGroup, this.hazeColor, this.elapsed);

    if (running && wallDelta > 1 / 50) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (!this.qualityReduced && this.slowFrames > 80) {
      this.qualityReduced = true;
      this.resize();
    }
  }

  readonly resize = (): void => {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.aspect = width / height;
    const pixelBudget = this.qualityReduced ? 1_800_000 : 3_000_000;
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(window.devicePixelRatio || 1,
      this.qualityReduced ? 1 : 1.5, Math.sqrt(pixelBudget / (width * height)))));
    this.renderer.setSize(width, height, false);
    this.blur.resize(this.renderer);
    const halfHeight = this.viewHeight;
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
    this.bodyDamage.dispose();
    this.smoke.dispose();
    this.debris.dispose();
    this.sparks.dispose();
    this.city.dispose();
    this.depot.dispose();
    for (const group of this.loops.values()) disposeGroup(group);
    this.police.dispose();
    this.policeWreck.dispose();
    this.policeSmoke.dispose();
    this.weapon.dispose();
    this.combat.dispose();
    this.blur.dispose();
    this.groundMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
