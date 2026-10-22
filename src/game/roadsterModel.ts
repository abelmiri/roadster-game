import * as THREE from 'three';
import { CAR_ARCH_RADIUS, CAR_AXLE_Y, CAR_WHEEL_OFFSET, CAR_WHEEL_RADIUS } from './vehicle';

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
