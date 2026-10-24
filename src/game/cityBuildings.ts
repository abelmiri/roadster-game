import * as THREE from 'three';
import { hash } from './track';

interface Part { x: number; y: number; z: number; w: number; h: number; d: number; building: number }
interface Building { baseX: number; shift: number; slots: { mesh: THREE.InstancedMesh; index: number; x: number }[] }
interface Layer { group: THREE.Group; factor: number; buildings: Building[] }

/** Five batches replace the individual skyline bodies, roofs and windows.
 * Parallax moves each layer; instance buffers change only when buildings wrap.
 */
export class CityBuildings {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly layers: Layer[] = [];
  private readonly meshes: THREE.InstancedMesh[] = [];

  constructor(far: THREE.Material, middle: THREE.Material, near: THREE.Material, windows: THREE.Material) {
    const specs = [
      { count: 37, depth: -18, material: far, base: -1.5, min: 3, max: 8, width: 2.5, factor: 0.82 },
      { count: 33, depth: -12, material: middle, base: -2.6, min: 3.8, max: 9.5, width: 3.2, factor: 0.61 },
      { count: 28, depth: -6.3, material: near, base: -3.9, min: 3.8, max: 10.5, width: 3.9, factor: 0.37 },
    ];
    const transform = new THREE.Object3D();
    for (const [layerIndex, spec] of specs.entries()) {
      const layer: Layer = { group: new THREE.Group(), factor: spec.factor, buildings: [] };
      layer.group.position.z = spec.depth;
      const solids: Part[] = [];
      const lights: Part[] = [];
      for (let i = 0; i < spec.count; i++) {
        const width = spec.width * (0.7 + hash(i * 5 + layerIndex) * 0.62);
        const height = spec.min + hash(i * 11 + layerIndex * 60) * (spec.max - spec.min);
        layer.buildings.push({ baseX: -60 + i * (150 / spec.count) + hash(i + layerIndex * 80) * 2, shift: 0, slots: [] });
        solids.push({ x: 0, y: spec.base + height / 2, z: 0, w: width, h: height, d: 0.9 + layerIndex * 0.2, building: i });
        if (i % 3 === 0) solids.push({ x: 0, y: spec.base + height + 0.08, z: 0, w: width * 0.73, h: 0.18, d: 1.4, building: i });
        if (i % 7 === 0) solids.push({ x: width * 0.2, y: spec.base + height + 0.52, z: 0, w: 0.055, h: 0.9, d: 0.055, building: i });
        if (layerIndex > 0 && i % 2 === 0) {
          const cols = Math.max(1, Math.floor(width / 0.65));
          const rows = Math.max(1, Math.floor(height / 1.05) - 1);
          for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
            if (hash(i * 73 + row * 17 + col * 31) < 0.46) continue;
            lights.push({ x: (col - (cols - 1) / 2) * 0.57, y: spec.base + 0.72 + row * 0.83,
              z: 0.73 + layerIndex * 0.12, w: 0.18, h: 0.25, d: 0.02, building: i });
          }
        }
      }
      for (const [parts, material] of [[solids, spec.material], [lights, windows]] as const) {
        if (!parts.length) continue;
        const mesh = new THREE.InstancedMesh(this.geometry, material, parts.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        for (const [index, part] of parts.entries()) {
          const building = layer.buildings[part.building];
          transform.position.set(building.baseX + part.x, part.y, part.z);
          transform.scale.set(part.w, part.h, part.d);
          transform.updateMatrix();
          mesh.setMatrixAt(index, transform.matrix);
          building.slots.push({ mesh, index, x: building.baseX + part.x });
        }
        this.meshes.push(mesh);
        layer.group.add(mesh);
      }
      this.layers.push(layer);
      this.group.add(layer.group);
    }
  }

  update(cameraX: number): void {
    for (const layer of this.layers) {
      const center = cameraX * layer.factor;
      layer.group.position.x = center;
      for (const building of layer.buildings) {
        let shift = building.shift;
        let x = building.baseX + center + shift;
        while (x < cameraX - 77) { shift += 150; x += 150; }
        while (x > cameraX + 80) { shift -= 150; x -= 150; }
        if (shift === building.shift) continue;
        building.shift = shift;
        for (const slot of building.slots) {
          slot.mesh.instanceMatrix.array[slot.index * 16 + 12] = slot.x + shift;
          slot.mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of this.meshes) mesh.dispose();
    this.geometry.dispose();
  }
}
