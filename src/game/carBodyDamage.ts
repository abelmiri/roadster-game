import * as THREE from 'three';
import { vehicleDamageStage } from './damage';
import { profileY } from './roadsterModel';

interface Surface {
  object: THREE.Mesh | THREE.Line;
  rest: Float32Array;
  inverse: THREE.Matrix4;
  overlay: boolean;
}

const CRUMPLE = [0, 0.055, 0.14, 0.29, 0.47];
const point = new THREE.Vector3();
const smooth = (lo: number, hi: number, x: number): number => THREE.MathUtils.smoothstep(x, lo, hi);

/** Only updates geometry on a health transition. All four damage layers use
 * the same deformation as the shell, so seams and cracks follow bent panels. */
export class CarBodyDamage {
  readonly group = new THREE.Group();
  private readonly surfaces: Surface[] = [];
  private readonly layers: THREE.Group[] = [];
  private readonly paints = new Map<THREE.MeshLambertMaterial, THREE.Color>();
  private stage = -1;

  constructor(body: THREE.Group) {
    const scratch = new THREE.LineBasicMaterial({ color: '#45515b', transparent: true, opacity: 0.76 });
    const fracture = new THREE.LineBasicMaterial({ color: '#80949f', transparent: true, opacity: 0.83 });
    const dent = new THREE.MeshLambertMaterial({ color: '#8e999e', flatShading: true, side: THREE.DoubleSide });
    const torn = new THREE.MeshLambertMaterial({ color: '#25303a', flatShading: true, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) { const layer = new THREE.Group(); this.layers.push(layer); this.group.add(layer); }
    const line = (layer: number, points: number[][], glass = false): void => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => new THREE.Vector3(x, profileY(y), 0.546)));
      this.layers[layer - 1].add(new THREE.Line(geometry, glass ? fracture : scratch));
    };
    const facet = (layer: number, points: number[][], dark = false): void => {
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, profileY(y))));
      shape.closePath();
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), dark ? torn : dent);
      mesh.position.z = 0.536;
      this.layers[layer - 1].add(mesh);
    };

    // 25%: light scratches and a bent leading edge.
    line(1, [[-.34,.04],[-.12,-.02],[-.29,-.03],[.02,-.10]]);
    line(1, [[1.73,.22],[1.85,.16],[1.97,.15]]);
    line(1, [[-1.91,.22],[-1.78,.27],[-1.66,.24]]);
    // 50%: creased door skin, torn paint and small cracks.
    facet(2, [[-.48,.16],[-.20,.04],[.15,-.05],[-.12,-.16],[-.42,-.13]]);
    facet(2, [[1.61,.27],[1.77,.32],[1.97,.15],[1.82,.20]]);
    line(2, [[.12,.23],[.07,.10],[.19,.01],[.11,-.12],[.28,-.31]]);
    line(2, [[.19,.01],[.37,-.05],[.44,-.18]]);
    line(2, [[-.45,-.23],[-.19,-.20],[.04,-.29],[.30,-.25]]);
    // 75%: branching fractures, lifted hood and crushed rear quarter.
    facet(3, [[1.60,.28],[1.77,.43],[2.03,.13],[1.84,.23]], true);
    facet(3, [[-.50,-.10],[-.29,-.22],[.21,-.31],[.43,-.22],[.14,-.36]]);
    line(3, [[-.40,.31],[-.24,.17],[-.33,.08],[-.20,-.02],[-.27,-.18],[-.39,-.29]]);
    line(3, [[-.33,.08],[-.48,.03],[-.53,-.07]]);
    line(3, [[.18,.61],[.09,.49],[.24,.43],[.12,.30]], true);
    line(3, [[.24,.43],[.49,.44],[.68,.39]], true);
    line(3, [[-1.94,.21],[-1.80,.30],[-1.65,.26],[-1.52,.28]]);
    // 100%: dark exposed metal, a collapsed hood and shattered canopy.
    facet(4, [[1.72,.30],[1.79,.49],[2.05,.05],[1.91,.11]], true);
    facet(4, [[-.51,.08],[-.32,-.02],[-.47,-.25],[-.55,-.19]], true);
    line(4, [[.70,.52],[.57,.47],[.60,.37],[.42,.32]], true);
    line(4, [[.57,.47],[.32,.55],[.08,.52],[-.06,.62]], true);
    line(4, [[.57,.47],[.79,.42],[.92,.33]], true);
    line(4, [[-.62,.46],[-.49,.50],[-.33,.41],[-.14,.43]], true);
    line(4, [[.40,.16],[.32,.03],[.41,-.09],[.31,-.22],[.48,-.33]]);
    body.add(this.group);
    body.updateMatrixWorld(true);
    const toBody = body.matrixWorld.clone().invert();
    body.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      object.updateMatrixWorld(true);
      this.surfaces.push({ object, rest: new Float32Array(object.geometry.getAttribute('position').array),
        inverse: toBody.clone().multiply(object.matrixWorld).invert(), overlay: this.group.getObjectById(object.id) !== undefined });
      if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof THREE.MeshLambertMaterial && material.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.45) {
          this.paints.set(material, material.color.clone());
        }
      }
    });
    this.update(100);
  }

  update(health: number): void {
    const stage = vehicleDamageStage(health);
    if (stage === this.stage) return;
    this.stage = stage;
    const crumple = CRUMPLE[stage];
    for (const { object, rest, inverse, overlay } of this.surfaces) {
      const positions = object.geometry.getAttribute('position');
      // Saved matrices are relative to the original body, independent of its
      // current driving pose. Convert through that rest transform both ways.
      const matrix = inverse.clone().invert();
      for (let i = 0; i < positions.count; i++) {
        point.fromArray(rest, i * 3).applyMatrix4(matrix);
        const front = smooth(1.05, 2.08, point.x);
        const rear = smooth(1.45, 2.08, -point.x);
        const cabin = Math.max(0, point.y - 0.28);
        const crease = Math.exp(-(((point.x - 0.12) / 0.65) ** 2 + ((point.y + 0.03) / 0.3) ** 2));
        point.x -= crumple * (front - rear * 0.36);
        point.y += crumple * (front * (0.28 + Math.sin(point.x * 19) * 0.16) - rear * 0.16 - cabin * 0.7);
        // Fine crack paths sit above the coarse triangulated door skin;
        // pushing their inner vertices into a dent would hide the cracks.
        if (!overlay) point.z -= crumple * crease * smooth(0, 0.45, point.z) * 0.45;
        point.applyMatrix4(inverse);
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      positions.needsUpdate = true;
      if (object instanceof THREE.Mesh) object.geometry.computeVertexNormals();
      object.geometry.computeBoundingSphere();
    }
    this.layers.forEach((layer, index) => { layer.visible = stage > index; });
    for (const [material, color] of this.paints) {
      material.color.copy(color).lerp(new THREE.Color('#55616b'), stage * 0.085).multiplyScalar(1 - stage * 0.13);
    }
  }

  dispose(): void {
    const materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const material of materials) material.dispose();
    this.group.removeFromParent();
  }
}
