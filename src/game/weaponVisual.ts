import * as THREE from 'three';
import { WEAPON_MOUNT, weaponSpec, type WeaponId, type WeaponSnapshot } from './weapons';

function dispose(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) material.dispose();
  root.removeFromParent();
}

/** Eight original geometry models, with the reference's dark receiver and pale band. */
export class WeaponVisual {
  readonly group = new THREE.Group();
  private model = new THREE.Group();
  private yaw = new THREE.Group();
  private pitch = new THREE.Group();
  private barrel = new THREE.Group();
  private spinner = new THREE.Group();
  private flash!: THREE.Mesh;
  private id: WeaponId | null = null;

  constructor() { this.group.position.set(WEAPON_MOUNT.x, WEAPON_MOUNT.y, .10); }

  private build(id: WeaponId): void {
    dispose(this.model);
    this.id = id;
    this.model = new THREE.Group(); this.yaw = new THREE.Group();
    this.pitch = new THREE.Group(); this.barrel = new THREE.Group(); this.spinner = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: '#24333f', flatShading: true });
    const shade = new THREE.MeshLambertMaterial({ color: '#14212c', flatShading: true });
    const steel = new THREE.MeshLambertMaterial({ color: '#82939d', flatShading: true });
    const pale = new THREE.MeshLambertMaterial({ color: '#e1e8e7', flatShading: true });
    const gold = new THREE.MeshBasicMaterial({ color: '#e9aa44' });
    const red = new THREE.MeshBasicMaterial({ color: '#e55944' });
    const glow = new THREE.MeshBasicMaterial({ color: weaponSpec(id).color });
    const box = (parent: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    const tube = (parent: THREE.Group, x: number, y: number, z: number, length: number, radius: number, material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
      mesh.rotation.z = -Math.PI / 2; mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    const ring = (parent: THREE.Group, x: number, radius: number, thickness: number, material: THREE.Material): void => {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 6, 16), material);
      mesh.rotation.y = Math.PI / 2; mesh.position.x = x; parent.add(mesh);
    };
    const shape = new THREE.Shape([new THREE.Vector2(-.50, 0), new THREE.Vector2(.50, 0), new THREE.Vector2(.35, .13), new THREE.Vector2(-.35, .13)]);
    const mount = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .60, bevelEnabled: false }), dark);
    mount.position.z = -.30; this.model.add(mount);
    box(this.model, .30, .16, .30, 0, .19, 0, shade);
    this.yaw.position.y = WEAPON_MOUNT.pivotY;
    this.model.add(this.yaw); this.yaw.add(this.pitch); this.pitch.add(this.barrel);
    box(this.pitch, .69, .38, .45, -.10, .03, 0, dark);
    box(this.pitch, .16, .41, .48, .12, .03, 0, id === 'gatling-gun' || id === 'cannon' ? gold : pale);
    box(this.pitch, .21, .15, .02, -.29, .09, .235, steel);
    if (id === 'machine-gun' || id === 'twin-gun') {
      for (const y of id === 'twin-gun' ? [-.10, .10] : [0]) {
        tube(this.barrel, .84, y, 0, 1.04, .055, steel);
        tube(this.barrel, .86, y, 0, .88, .036, shade);
        box(this.barrel, .27, .15, .18, 1.365, y, 0, dark);
        for (let i = 0; i < 3; i++) box(this.barrel, .035, .075, .012, 1.285 + i * .07, y, .097, shade);
      }
    } else if (id === 'gatling-gun') {
      this.barrel.add(this.spinner);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        tube(this.spinner, .90, Math.cos(a) * .15, Math.sin(a) * .15, 1.22, .048, steel);
        tube(this.spinner, 1.515, Math.cos(a) * .15, Math.sin(a) * .15, .025, .033, shade);
      }
      ring(this.barrel, .50, .20, .055, dark); ring(this.barrel, 1.35, .20, .055, dark);
    } else if (id === 'cannon') {
      tube(this.barrel, .88, 0, 0, 1.02, .16, steel);
      tube(this.barrel, 1.43, 0, 0, .12, .19, dark);
      tube(this.barrel, 1.496, 0, 0, .012, .13, shade);
    } else if (id === 'rocket-launcher') {
      box(this.barrel, .78, .60, .62, .50, .03, 0, pale);
      box(this.barrel, .65, .49, .64, .48, .03, 0, dark);
      for (const y of [-.13, .16]) for (const z of [-.16, .16]) {
        tube(this.barrel, .89, y, z, .20, .105, shade);
        tube(this.barrel, 1.00, y, z, .035, .077, red);
      }
      box(this.barrel, .055, .40, .02, .62, .03, .333, red);
    } else if (id === 'missile-launcher') {
      box(this.barrel, .94, .10, .43, .55, -.15, 0, shade);
      tube(this.barrel, .62, .02, 0, .85, .13, pale);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(.13, .34, 10), red);
      nose.rotation.z = -Math.PI / 2; nose.position.set(1.11, .02, 0); this.barrel.add(nose);
      box(this.barrel, .22, .40, .045, .38, .02, 0, steel);
      box(this.barrel, .22, .045, .40, .38, .02, 0, steel);
    } else if (id === 'laser-gun') {
      box(this.barrel, .98, .36, .42, .74, .02, 0, dark);
      box(this.barrel, .65, .075, .025, .74, .02, .226, glow);
      box(this.barrel, .08, .24, .47, 1.25, .02, 0, pale);
      box(this.barrel, .015, .12, .25, 1.295, .02, 0, glow);
    } else {
      tube(this.barrel, .95, 0, 0, 1.08, .105, shade);
      for (const x of [.52, .79, 1.06, 1.36]) ring(this.barrel, x, .18, .035, glow);
      box(this.pitch, .32, .08, .025, -.17, .08, .246, glow);
      tube(this.barrel, 1.48, 0, 0, .19, .24, dark);
      const core = new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 8), glow);
      core.position.x = 1.58; this.barrel.add(core);
    }
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({
      color: weaponSpec(id).color, transparent: true, opacity: .85, depthWrite: false,
    }));
    this.flash.position.x = weaponSpec(id).muzzle + .05;
    this.flash.scale.set(.29, .12, .12); this.barrel.add(this.flash);
    this.group.add(this.model);
  }

  update(state: WeaponSnapshot): void {
    if (this.id !== state.id) this.build(state.id);
    this.yaw.rotation.y = state.yaw;
    this.pitch.rotation.z = state.pitch;
    this.barrel.position.x = -state.recoil * .075;
    this.flash.visible = state.recoil > .6;
    this.spinner.rotation.x = state.shotSerial * .9 - state.cooldown * 10;
  }
  dispose(): void { dispose(this.model); }
}

/** Fixed pools keep bullets and impact flashes cheap on mobile. */
export class CombatVisual {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({ color: '#fff0ba' });
  private readonly geometry = new THREE.SphereGeometry(1, 8, 6);
  private readonly effectGeometry = new THREE.IcosahedronGeometry(1, 0);
  private readonly shots: THREE.Mesh[] = [];
  private readonly effects: THREE.Mesh[] = [];
  constructor() {
    for (let i = 0; i < 64; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material.clone()); mesh.visible = false;
      this.shots.push(mesh); this.group.add(mesh);
    }
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(this.effectGeometry, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      mesh.visible = false; this.effects.push(mesh); this.group.add(mesh);
    }
  }
  update(state: WeaponSnapshot): void {
    this.shots.forEach((mesh, index) => {
      const shot = state.projectiles[index]; mesh.visible = Boolean(shot); if (!shot) return;
      const spec = weaponSpec(shot.weapon);
      (mesh.material as THREE.MeshBasicMaterial).color.set(spec.color);
      if (shot.beamEndX !== undefined && shot.beamEndY !== undefined) {
        const dx = shot.beamEndX - shot.x; const dy = shot.beamEndY - shot.y;
        mesh.position.set(shot.x + dx / 2, shot.y + dy / 2, 1.9);
        mesh.rotation.z = Math.atan2(dy, dx); mesh.scale.set(Math.hypot(dx, dy) / 2, .035, .035);
      } else {
        mesh.position.set(shot.x, shot.y, 1.9); mesh.rotation.z = Math.atan2(shot.vy, shot.vx);
        const explosive = spec.splash > 0;
        mesh.scale.set(explosive ? spec.radius * 1.8 : .22, spec.radius, spec.radius);
      }
    });
    this.effects.forEach((mesh, index) => {
      const effect = state.effects[index]; mesh.visible = Boolean(effect); if (!effect) return;
      const progress = Math.min(1, effect.age / (effect.destroyed ? .55 : .24));
      mesh.position.set(effect.x, effect.y, 2.0); mesh.rotation.z = progress * 1.8;
      mesh.scale.setScalar(effect.size * (.25 + progress * .85));
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.set(effect.color); material.opacity = (1 - progress) * .85;
    });
  }
  dispose(): void {
    this.geometry.dispose(); this.effectGeometry.dispose(); this.material.dispose();
    for (const mesh of [...this.shots, ...this.effects]) (mesh.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
