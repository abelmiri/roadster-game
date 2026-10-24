import * as THREE from 'three';
import { roadHeight, START_APRON_X } from './track';
import { GROUND_FLOOR_Y } from './terrain';

interface Part { x: number; y: number; z: number; w: number; h: number; d: number; angle: number }

/** A cutaway launch garage turns the start boundary into an authored place.
 * Repeated plates, beams and lights share a handful of static instance batches. */
export class StartDepot {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly batches = new Map<THREE.Material, Part[]>();
  private readonly materials = new Set<THREE.Material>();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly pulse = new THREE.MeshBasicMaterial({ color: '#8cefd8', transparent: true, opacity: .8 });
  private readonly labelTexture: THREE.CanvasTexture;

  constructor() {
    const floor = roadHeight(0);
    const concrete = new THREE.MeshLambertMaterial({ color: '#293e51', flatShading: true });
    const steel = new THREE.MeshLambertMaterial({ color: '#526777', flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: '#142332', flatShading: true });
    const asphalt = new THREE.MeshLambertMaterial({ color: '#253447' });
    const black = new THREE.MeshBasicMaterial({ color: '#08131e' });
    const amber = new THREE.MeshBasicMaterial({ color: '#d9ad69' });
    const cyan = new THREE.MeshBasicMaterial({ color: '#8cefd8' });
    const box = (x: number, y: number, z: number, w: number, h: number, d: number,
      material: THREE.Material, angle = 0): void => {
      if (!this.batches.has(material)) this.batches.set(material, []);
      this.batches.get(material)!.push({ x, y, z, w, h, d, angle });
    };

    // Continuous concrete below the launch lane hides the raw vertical cut.
    box(START_APRON_X / 2, (floor + GROUND_FLOOR_Y) / 2, -.15,
      -START_APRON_X, floor - GROUND_FLOOR_Y, 1.2, concrete);
    box(START_APRON_X / 2, floor - .11, .48, -START_APRON_X, .22, .04, asphalt);
    box(START_APRON_X / 2, floor - .52, .52, -START_APRON_X, .35, .1, steel);
    box(.12, (floor + GROUND_FLOOR_Y) / 2, .55, .28, floor - GROUND_FLOOR_Y, .18, dark);
    for (let x = -60; x < 0; x += 6) {
      box(x, floor - 5.7, .51, .32, 10.4, .12, steel);
      box(x - 2.75, floor - 4.4, .52, .18, 8, .14, dark, -.58);
      box(x - 2.8, floor - 9.7, .52, 5.4, .2, .12, steel);
      // Recessed service vents and a quiet amber status lamp.
      box(x + 2, floor - 2.35, .53, 2.5, 1.25, .1, dark);
      for (let row = 0; row < 4; row++) box(x + 2, floor - 2.72 + row * .25, .6, 2.15, .065, .03, steel);
      box(x + 3.08, floor - 1.52, .62, .12, .09, .03, amber);
    }
    for (let y = floor - 1; y > floor - 15; y -= 1.4) {
      box(.13, y, .66, .1, .12, .03, steel);
      box(-.7, y, .6, .12, 1.2, .08, dark);
    }

    // A low, broad hangar recedes to the left of a chamfered tunnel mouth.
    box(-35.4, floor + 2.5, -.2, 57.2, 5, 1.1, concrete);
    box(-31.5, floor + 4.58, .06, 65, .28, 1.35, dark);
    box(-31.5, floor + 4.72, .19, 65.2, .08, .08, steel);
    for (let x = -60; x < -7; x += 4.2) {
      box(x, floor + 2.25, .4, .11, 4.5, .07, dark);
      box(x + 1.7, floor + 2.65, .4, 2.4, 1.05, .08, black);
      box(x + 1.7, floor + 3.22, .46, 2.5, .035, .04, cyan);
    }

    const outline = (inset: number): THREE.Vector2[] => [
      [-6.6 + inset, 0], [-6.6 + inset, 3.18 - inset * .3],
      [-5.55 + inset * .4, 4.25 - inset], [-.85 - inset * .4, 4.25 - inset],
      [.2 - inset, 3.18 - inset * .3], [.2 - inset, 0],
    ].map(([x, y]) => new THREE.Vector2(x, floor + y));
    const outer = new THREE.Shape(outline(0)); outer.closePath();
    const inner = new THREE.Path(outline(.38)); inner.closePath(); outer.holes.push(inner);
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: .5, bevelEnabled: false }), steel);
    frame.position.z = .02; this.group.add(frame);
    const opening = new THREE.Shape(outline(.38)); opening.closePath();
    const tunnel = new THREE.Mesh(new THREE.ShapeGeometry(opening), black);
    tunnel.position.z = -.24; this.group.add(tunnel);
    const lightPoints = outline(.49).map(p => new THREE.Vector3(p.x, p.y, .54));
    this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lightPoints),
      new THREE.LineBasicMaterial({ color: '#8cefd8' })));
    // Successive ribs give depth to the dark tunnel instead of a flat black door.
    for (let i = 0; i < 4; i++) {
      const rib = outline(.75 + i * .24).map(p => new THREE.Vector3(p.x - i * .1, p.y - i * .11, -.18 + i * .02));
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rib),
        new THREE.LineBasicMaterial({ color: i < 2 ? '#314954' : '#1a2d39' })));
    }
    for (let i = 0; i < 7; i++) {
      box(-6.4, floor + .45 + i * .37, .58, .16, .28, .04, i % 2 ? dark : amber, -.45);
      box(.01, floor + .45 + i * .37, .58, .16, .28, .04, i % 2 ? dark : amber, -.45);
    }
    for (let i = 0; i < 3; i++) {
      const x = -4.5 + i * 1.12;
      box(x, floor + 1.31, -.05, .65, .08, .04, this.pulse, -.7);
      box(x, floor + .9, -.05, .65, .08, .04, this.pulse, .7);
    }
    box(-3.2, floor + 3.25, -.04, 1.85, .48, .04, dark);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#b9e7db'; context.font = '700 66px sans-serif';
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('SECTOR 01', 256, 68);
    }
    this.labelTexture = new THREE.CanvasTexture(canvas); this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.68, .4),
      new THREE.MeshBasicMaterial({ map: this.labelTexture, transparent: true, depthWrite: false }));
    label.position.set(-3.2, floor + 3.25, .01); this.group.add(label);

    for (let x = START_APRON_X + 2; x < 0; x += 3.5) box(x, floor + .04, .56, .9, .035, .04, cyan);
    const transform = new THREE.Object3D();
    for (const [material, parts] of this.batches) {
      const mesh = new THREE.InstancedMesh(this.geometry, material, parts.length);
      parts.forEach((part, index) => {
        transform.position.set(part.x, part.y, part.z); transform.rotation.z = part.angle;
        transform.scale.set(part.w, part.h, part.d); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix);
      });
      mesh.computeBoundingSphere(); this.meshes.push(mesh); this.group.add(mesh);
    }
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) this.materials.add(material);
    });
  }

  update(cameraX: number, halfWidth: number, time: number): void {
    this.group.visible = cameraX - halfWidth < 1.5 && cameraX + halfWidth > START_APRON_X;
    if (this.group.visible) this.pulse.opacity = .66 + Math.sin(time * 2.2) * .16;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse(object => {
      if ((object instanceof THREE.Mesh || object instanceof THREE.Line) && object.geometry !== this.geometry) object.geometry.dispose();
    });
    for (const mesh of this.meshes) mesh.dispose();
    this.geometry.dispose(); this.labelTexture.dispose();
    for (const material of this.materials) material.dispose();
  }
}
