import * as THREE from 'three';
import { ARMOR_PARTS } from './armorParts';
import type { GameSnapshot } from './physics';
import { roadHeight } from './track';
import { sprungBodyPose } from './vehicle';

type ArmorSnapshot = Pick<GameSnapshot, 'car' | 'armorMask' | 'wrecked' | 'distance' | 'impactSerial' | 'speed' | 'suspensionOffset' | 'suspensionPitch'>;

function armorPiece(index: number): THREE.Group {
  const part = ARMOR_PARTS[index];
  const group = new THREE.Group();
  group.name = `armor-${part.name}`;
  group.position.set(...part.center, part.z);
  const shape = new THREE.Shape(part.points.map(([x,y]) => new THREE.Vector2(x-part.center[0], y-part.center[1])));
  shape.closePath();
  const steel = new THREE.MeshLambertMaterial({ color:'#73818a', flatShading:true });
  const edge = new THREE.MeshLambertMaterial({ color:'#424f59', flatShading:true });
  group.add(new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth:part.depth, bevelEnabled:true,
    bevelSize:.022, bevelThickness:.018, bevelSegments:1, steps:1 }), [steel, edge]));
  const boltMaterial = new THREE.MeshLambertMaterial({ color:'#b5c2c7', flatShading:true });
  const boltGeometry = new THREE.CylinderGeometry(.025,.025,.025,6);
  for (const [x,y] of part.bolts) {
    const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
    bolt.rotation.x = Math.PI/2;
    bolt.position.set(x-part.center[0],y-part.center[1],part.depth+.025);
    group.add(bolt);
  }
  return group;
}

/** Four pooled matching plates detach into cosmetic gravity and road bounces. */
export class CarArmorVisual {
  readonly attached = new THREE.Group();
  readonly debris = new THREE.Group();
  private readonly parts = ARMOR_PARTS.map((_,index) => armorPiece(index));
  private readonly loose = this.parts.map(part => ({ mesh:part.clone(true), age:6, vx:0, vy:0, spin:0 }));
  private mask = 0;
  private initialized = false;
  private previousDistance = 0;
  private previousImpact = 0;
  private wasWrecked = false;

  constructor() {
    this.attached.add(...this.parts);
    this.debris.add(...this.loose.map(part=>part.mesh));
    for (const part of [...this.parts,...this.loose.map(part=>part.mesh)]) part.visible=false;
  }

  update(snapshot: ArmorSnapshot, delta: number, running = true, road?: { hasRoad(x:number):boolean }): void {
    const mask = snapshot.wrecked ? 0 : snapshot.armorMask;
    const reset = snapshot.distance < this.previousDistance-1 || snapshot.impactSerial < this.previousImpact || (this.wasWrecked && !snapshot.wrecked);
    if (reset || !this.initialized) {
      for (const part of this.loose) { part.age=6; part.mesh.visible=false; }
      this.mask=mask;
      this.initialized=true;
    }
    const lost = this.mask & ~mask;
    const body = sprungBodyPose(snapshot.car, snapshot.suspensionOffset, snapshot.suspensionPitch);
    for (let index=0; index<this.parts.length; index++) {
      this.parts[index].visible=Boolean(mask & (1<<index));
      const piece=this.loose[index];
      if (lost & (1<<index)) {
        const [x,y]=ARMOR_PARTS[index].center;
        const c=Math.cos(body.angle); const s=Math.sin(body.angle);
        piece.mesh.position.set(body.x+x*c-y*s,body.y+x*s+y*c,1.15+ARMOR_PARTS[index].z);
        piece.mesh.rotation.set(0,0,body.angle);
        piece.mesh.scale.setScalar(1);
        piece.age=0; piece.vx=snapshot.speed*.55+(index%2?-.8:1.1); piece.vy=2+index*.3; piece.spin=(index%2?-1:1)*3;
      }
      const dt=running ? Math.min(.06,Math.max(0,delta)) : 0;
      if (piece.age<6) {
        piece.age+=dt;
        piece.vy-=18*dt;
        piece.mesh.position.x+=piece.vx*dt; piece.mesh.position.y+=piece.vy*dt;
        piece.mesh.rotation.z+=piece.spin*dt;
        const angle=piece.mesh.rotation.z;
        const [centerX,centerY]=ARMOR_PARTS[index].center;
        let bottom=Infinity;
        for(const [x,y] of ARMOR_PARTS[index].points) bottom=Math.min(bottom,(x-centerX)*Math.sin(angle)+(y-centerY)*Math.cos(angle));
        const floor=roadHeight(piece.mesh.position.x)-bottom+.02;
        if (piece.vy<0 && (road?.hasRoad(piece.mesh.position.x) ?? true) && piece.mesh.position.y<floor) {
          piece.mesh.position.y=floor; piece.vy*=-.2; piece.vx*=.65; piece.spin*=.5;
        }
        piece.mesh.scale.setScalar(Math.max(0,Math.min(1,(6-piece.age)/.4)));
      }
      piece.mesh.visible=piece.age<6;
    }
    this.mask=mask; this.previousDistance=snapshot.distance; this.previousImpact=snapshot.impactSerial; this.wasWrecked=snapshot.wrecked;
  }

  dispose(): void {
    const geometries=new Set<THREE.BufferGeometry>(); const materials=new Set<THREE.Material>();
    this.attached.traverse(object=>{
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)?object.material:[object.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.attached.removeFromParent(); this.debris.removeFromParent();
  }
}
