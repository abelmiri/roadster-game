import * as THREE from 'three';
import { RAMP_BOOSTER_LENGTH, roadHeight, roadSlope, type RampSpec } from './track';

/** A luminous strip and forward chevrons follow the same road as tire contacts. */
export function createRampBooster(ramp: RampSpec, base: THREE.Material, light: THREE.Material, arrow: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = `ramp-booster-${ramp.id}`;
  const start = ramp.boosterX - RAMP_BOOSTER_LENGTH / 2;
  const segments = 12;
  for (let i = 0; i < segments; i++) {
    const x0 = start + RAMP_BOOSTER_LENGTH * i / segments;
    const x1 = start + RAMP_BOOSTER_LENGTH * (i + 1) / segments;
    const y0 = roadHeight(x0), y1 = roadHeight(x1);
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const length = Math.hypot(x1 - x0, y1 - y0);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(length + .015, .16, 1.3), base);
    plate.position.set((x0 + x1) / 2, (y0 + y1) / 2 + .08, .12);
    plate.rotation.z = angle;
    group.add(plate);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(length + .015, .055, .07), light);
    rail.position.set((x0 + x1) / 2, (y0 + y1) / 2 + .13, .82);
    rail.rotation.z = angle;
    group.add(rail);
  }
  for (let i = 0; i < 4; i++) {
    const x = start + .7 + i * 1.1;
    const chevron = new THREE.Group();
    chevron.position.set(x, roadHeight(x) + .32, .85);
    chevron.rotation.z = Math.atan(roadSlope(x));
    for (const sign of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.48, .075, .08), arrow);
      arm.position.set(0, sign * .13, 0);
      arm.rotation.z = -sign * .6;
      chevron.add(arm);
    }
    group.add(chevron);
  }
  return group;
}
