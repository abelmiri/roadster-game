import * as THREE from 'three';
import { CAR_ARCH_RADIUS, CAR_AXLE_Y, CAR_WHEEL_OFFSET, CAR_WHEEL_RADIUS } from './vehicle';
import { AIR_JET_X, AIR_JET_Y } from './airJets';

export const profileY = (y: number): number => y > 0.30 ? 0.30 + (y - 0.30) * 0.62 : y;

/** Shared wedge outline and open fenders for both roadsters. */
export function roadsterBodyShape(): THREE.Shape {
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
  return bodyShape;
}

export function createRoadsterWheel(): THREE.Group {
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

export function createRoadsterBody(): THREE.Group {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: '#f3f4ee', flatShading: true });
  const top = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  const pale = new THREE.MeshLambertMaterial({ color: '#d3d8d9', flatShading: true });
  const shade = new THREE.MeshLambertMaterial({ color: '#b3bdc5', flatShading: true });
  const glass = new THREE.MeshBasicMaterial({ color: '#101c26' });
  const glassReflection = new THREE.MeshBasicMaterial({ color: '#354851' });
  const trim = new THREE.MeshLambertMaterial({ color: '#1b2832', flatShading: true });
  const seam = new THREE.LineBasicMaterial({ color: '#65717a' });

  const bodyShape = roadsterBodyShape();
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(bodyShape, {
    depth: 1.02, bevelEnabled: false, curveSegments: 12,
  }), [white, pale]);
  body.position.z = -0.51;
  group.add(body);

  const panel = (points: [number, number][], material: THREE.Material, z = 0.516): THREE.Mesh => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, profileY(y))));
    shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
    mesh.position.z = z;
    group.add(mesh);
    return mesh;
  };
  const line = (points: [number, number][], z = 0.531): void => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => new THREE.Vector3(x, profileY(y), z)));
    group.add(new THREE.Line(geometry, seam));
  };

  // Keep the facets between the fenders so they cannot cover the tire gaps.
  panel([[-0.59, 0.31], [0.59, 0.21], [0.55, -0.35], [-0.59, -0.31]], pale);
  panel([[-0.59, -0.31], [0.55, -0.35], [0.59, -0.43], [-0.59, -0.43]], shade);
  panel([[1.95, -0.30], [2.03, -0.30], [2.03, -0.43], [1.95, -0.43]], pale);
  panel([[-2.04, -0.04], [-1.95, -0.13], [-1.95, -0.40], [-2.04, -0.43]], trim, 0.519);

  // A continuous black canopy, thin white roof and sloping windshield keep
  // the cabin long and low instead of the upright shape of the old model.
  panel([[-1.08, 0.43], [-0.41, 0.63], [0.43, 0.65], [1.00, 0.34], [0.24, 0.29]], glass, 0.522);
  panel([[-0.95, 0.44], [-0.40, 0.61], [0.36, 0.63], [0.24, 0.59], [-0.41, 0.56]], glassReflection, 0.523);
  panel([[-0.48, 0.64], [-0.43, 0.69], [0.44, 0.72], [0.50, 0.68]], top, 0.525);
  panel([[-0.44, 0.63], [-0.39, 0.64], [-0.22, 0.30], [-0.27, 0.30]], pale, 0.526);
  panel([[0.44, 0.65], [0.50, 0.68], [1.10, 0.35], [1.00, 0.34]], white, 0.526);
  panel([[0.52, 0.19], [0.82, 0.17], [0.71, 0.12], [0.51, 0.14]], glass, 0.527);
  line([[-0.58, 0.31], [-0.58, -0.29], [-0.45, -0.34], [0.53, -0.36], [0.58, 0.17]]);

  const rocker = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.075, 1.055), trim);
  rocker.position.set(0, -0.425, 0.004);
  group.add(rocker);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.065, 1.07), trim);
  splitter.position.set(1.965, -0.43, 0.004);
  group.add(splitter);
  const headlight = new THREE.MeshBasicMaterial({ color: '#e9faff' });
  const tailLight = new THREE.MeshBasicMaterial({ color: '#ff6c66' });
  panel([[1.82, 0.055], [2.04, -0.06], [2.04, -0.11], [1.84, 0.015]], headlight, 0.529);
  panel([[-2.045, 0.13], [-1.85, 0.20], [-1.86, 0.15], [-2.045, 0.09]], tailLight, 0.530);
  // Rear air-boost ports and two downward jump nozzles share the smoke emitters.
  for (const z of [-0.33, 0.38]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.17, 12), trim);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(-2.055, -0.25, z);
    group.add(nozzle);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.017, 5, 12), shade);
    rim.rotation.y = Math.PI / 2;
    rim.position.set(-2.145, -0.25, z);
    group.add(rim);
  }
  for (const x of [-0.46, 0.46]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.075, 0.13, 12), trim);
    nozzle.position.set(x, -0.49, 0.38);
    group.add(nozzle);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.017, 5, 12), shade);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, -0.555, 0.38);
    group.add(rim);
  }
  const jetGlow = new THREE.MeshBasicMaterial({ color: '#a6f4ef' });
  for (const direction of [-1, 1]) {
    const jet = new THREE.Group();
    jet.name = direction > 0 ? 'front-air-nozzle' : 'rear-air-nozzle';
    jet.position.set(direction * AIR_JET_X, AIR_JET_Y, 0.56);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.095, 0.18, 12), trim);
    housing.position.y = 0.09;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.025, 6, 12), shade);
    rim.rotation.x = Math.PI / 2;
    const outlet = new THREE.Mesh(new THREE.CircleGeometry(0.072, 12), jetGlow);
    outlet.rotation.x = Math.PI / 2;
    outlet.position.y = -0.005;
    jet.add(housing, rim, outlet);
    group.add(jet);
  }
  group.position.z = 1.15;
  return group;
}
