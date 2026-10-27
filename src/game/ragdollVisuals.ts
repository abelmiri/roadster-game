import * as THREE from 'three';
import { RAGDOLL_PARTS, type RagdollPartName, type RagdollSnapshot } from './ragdoll';
import { RAGDOLL_OUTFIT_COUNT } from './track';

interface RagdollView {
  group: THREE.Group;
  parts: Record<RagdollPartName, THREE.Mesh>;
  flash: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
}

/** Simple readable mannequin pieces follow the articulated Rapier bodies. */
export class RagdollVisuals {
  readonly group = new THREE.Group();
  private readonly views = new Map<number, RagdollView>();
  private readonly torso = new THREE.CapsuleGeometry(.19, .68, 5, 10);
  private readonly head = new THREE.SphereGeometry(.21, 12, 8);
  private readonly upperArm = new THREE.CapsuleGeometry(.09, .28, 5, 8);
  private readonly forearm = new THREE.CapsuleGeometry(.085, .26, 5, 8);
  private readonly thigh = new THREE.CapsuleGeometry(.105, .26, 5, 8);
  private readonly shin = new THREE.CapsuleGeometry(.105, .28, 5, 8);
  private readonly shirts = ['#e1aa62', '#4f9fc1', '#b45c76', '#8fb65a']
    .map(color => new THREE.MeshStandardMaterial({ color, roughness: .86 }));
  private readonly skin = new THREE.MeshStandardMaterial({ color: '#f3c9a8', roughness: .9 });
  private readonly pants = new THREE.MeshStandardMaterial({ color: '#526a85', roughness: .93 });
  private readonly lowerPants = new THREE.MeshStandardMaterial({ color: '#40566f', roughness: .93 });

  private create(id: number, outfit: number): RagdollView {
    const group = new THREE.Group();
    group.name = `ragdoll-${id}`;
    const parts = {} as Record<RagdollPartName, THREE.Mesh>;
    for (const name of RAGDOLL_PARTS) {
      const geometry = name === 'torso' ? this.torso : name === 'head' ? this.head
        : name.endsWith('UpperArm') ? this.upperArm : name.endsWith('Forearm') ? this.forearm
          : name.endsWith('Thigh') ? this.thigh : this.shin;
      const material = name === 'torso' || name.endsWith('UpperArm')
        ? this.shirts[outfit % RAGDOLL_OUTFIT_COUNT]
        : name.endsWith('Thigh') ? this.pants : name.endsWith('Shin') ? this.lowerPants : this.skin;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.position.z = 1.22;
      group.add(mesh);
      parts[name] = mesh;
    }
    const flash = new THREE.Mesh(new THREE.RingGeometry(.37, .46, 24),
      new THREE.MeshBasicMaterial({ color: '#fff0a7', transparent: true, depthWrite: false }));
    flash.visible = false;
    flash.position.z = 1.5;
    group.add(flash);
    this.group.add(group);
    const view = { group, parts, flash };
    this.views.set(id, view);
    return view;
  }

  update(states: readonly RagdollSnapshot[]): void {
    const visible = new Set<number>();
    for (const state of states) {
      visible.add(state.id);
      const view = this.views.get(state.id) ?? this.create(state.id, state.outfit);
      for (const name of RAGDOLL_PARTS) {
        const pose = state.parts[name];
        const mesh = view.parts[name];
        mesh.position.set(pose.x, pose.y, 1.22);
        mesh.rotation.z = pose.angle;
      }
      const flashAge = state.hit ? state.hitAge : Infinity;
      view.flash.visible = flashAge < .35;
      if (view.flash.visible) {
        const torso = state.parts.torso;
        view.flash.position.set(torso.x, torso.y, 1.5);
        view.flash.scale.setScalar(1 + flashAge * 3);
        view.flash.material.opacity = 1 - flashAge / .35;
      }
    }
    for (const [id, view] of this.views) {
      if (visible.has(id)) continue;
      view.flash.geometry.dispose();
      view.flash.material.dispose();
      view.group.removeFromParent();
      this.views.delete(id);
    }
  }

  dispose(): void {
    this.update([]);
    for (const geometry of [this.torso, this.head, this.upperArm, this.forearm, this.thigh, this.shin]) geometry.dispose();
    for (const material of [...this.shirts, this.skin, this.pants, this.lowerPants]) material.dispose();
    this.group.removeFromParent();
  }
}
