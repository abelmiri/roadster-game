import * as THREE from 'three';
import type { GameSnapshot } from './physics';
import { CAR_AXLE_Y, CAR_WHEEL_OFFSET, CAR_WHEEL_RADIUS } from './vehicle';
import { createRoadsterWheel, profileY, roadsterBodyShape } from './roadsterModel';

/** Original black-and-white wedge patrol, matching the roadster reference. */
export class PoliceVisual {
  readonly group = new THREE.Group();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures: THREE.Texture[] = [];
  private readonly beacons: THREE.MeshBasicMaterial[] = [];
  private readonly halos: THREE.ShaderMaterial[] = [];
  private readonly wheels: THREE.Group[] = [];
  private previousX: number | null = null;
  private wheelAngle = 0;

  constructor() {
    const white = new THREE.MeshLambertMaterial({ color: '#f5f6f2', flatShading: true });
    const black = new THREE.MeshLambertMaterial({ color: '#172532', flatShading: true });
    const darkSide = new THREE.MeshLambertMaterial({ color: '#101c27', flatShading: true });
    const pale = new THREE.MeshLambertMaterial({ color: '#c8d2d7', flatShading: true });
    const glass = new THREE.MeshBasicMaterial({ color: '#08151e' });
    const reflection = new THREE.MeshBasicMaterial({ color: '#304453' });
    const headlight = new THREE.MeshBasicMaterial({ color: '#eaffff' });
    const tail = new THREE.MeshBasicMaterial({ color: '#ff4a53' });
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(roadsterBodyShape(), {
      depth: 1.02, bevelEnabled: false, curveSegments: 12,
    }), [black, darkSide]);
    body.position.z = -0.51;
    this.group.add(body);

    const panel = (points: [number, number][], material: THREE.Material, z = 0.519): void => {
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, profileY(y))));
      shape.closePath();
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
      mesh.position.z = z; this.group.add(mesh);
    };
    const box = (w: number, h: number, d: number, x: number, y: number, material: THREE.Material, z = 0): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z); this.group.add(mesh);
    };

    // The white door stays between the open fenders; front and rear remain black.
    panel([[-0.65, 0.31], [0.78, 0.24], [0.58, -0.39], [-0.59, -0.39]], white);
    panel([[-0.59, -0.35], [0.58, -0.37], [0.58, -0.42], [-0.59, -0.42]], pale, 0.521);
    panel([[-1.08, 0.43], [-0.41, 0.63], [0.43, 0.65], [1.00, 0.34], [0.24, 0.29]], glass, 0.522);
    panel([[-0.96, 0.44], [-0.40, 0.61], [0.36, 0.63], [0.22, 0.59], [-0.41, 0.56]], reflection, 0.523);
    panel([[-1.10, 0.46], [-0.45, 0.69], [0.44, 0.72], [0.50, 0.68], [-0.43, 0.64], [-0.98, 0.41]], white, 0.525);
    panel([[-0.44, 0.63], [-0.39, 0.64], [-0.22, 0.30], [-0.27, 0.30]], pale, 0.526);
    panel([[0.44, 0.65], [0.50, 0.68], [1.10, 0.35], [1.00, 0.34]], white, 0.526);
    panel([[0.50, 0.19], [0.78, 0.17], [0.70, 0.12], [0.49, 0.14]], glass, 0.527);
    panel([[-0.55, 0.22], [-0.39, 0.20], [-0.39, 0.17], [-0.55, 0.19]], black, 0.529);
    panel([[1.65, 0.20], [2.04, -0.05], [2.04, -0.14], [1.86, -0.07]], headlight, 0.528);
    panel([[-2.04, 0.13], [-1.83, 0.20], [-1.85, 0.15], [-2.04, 0.08]], tail, 0.530);
    box(1.16, 0.075, 1.055, 0, -0.425, darkSide);
    box(0.16, 0.16, 0.93, -2.08, -0.25, black);
    box(0.045, 0.14, 0.99, -2.17, -0.25, pale);
    box(0.065, 0.46, 0.10, 2.105, -0.17, black, 0.40);
    box(0.10, 0.07, 1.02, 2.07, -0.36, darkSide);
    this.createDoorMarkings(black, white);

    for (const x of [-CAR_WHEEL_OFFSET, CAR_WHEEL_OFFSET]) {
      const wheel = createRoadsterWheel();
      wheel.position.set(x, CAR_AXLE_Y, 0.40);
      this.group.add(wheel); this.wheels.push(wheel);
    }

    box(0.88, 0.08, 0.62, -0.06, 0.59, darkSide);
    for (const [index, tint] of ['#165dff', '#ff443b'].entries()) {
      const material = new THREE.MeshBasicMaterial({ color: tint });
      this.beacons.push(material);
      box(0.35, 0.16, 0.52, -0.31 + index * 0.49, 0.70, material);
      box(0.35, 0.025, 0.54, -0.31 + index * 0.49, 0.786, pale);
      const halo = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, uniforms: { tint: { value: new THREE.Color(tint) }, strength: { value: 0 } },
        vertexShader: 'varying vec2 p;void main(){p=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: 'varying vec2 p;uniform vec3 tint;uniform float strength;void main(){float a=exp(-4.*dot(p,p))*(1.-smoothstep(.5,1.,length(p)));gl_FragColor=vec4(tint,a*strength);}' });
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6), halo);
      glow.position.set(-0.31 + index * 0.49, 0.70, 0.76);
      this.group.add(glow); this.halos.push(halo);
    }
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (this.halos.includes(material as THREE.ShaderMaterial)) continue;
        material.transparent = true;
        this.materials.add(material);
      }
    });
  }

  private createDoorMarkings(ink: THREE.Material, white: THREE.Material): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#172532';
      context.font = 'italic 900 110px Arial, sans-serif';
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText('POLICE', 256, 68, 500);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.push(texture);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.28), material);
      label.position.set(-0.15, -0.065, 0.538); this.group.add(label);
    }
    const shield = new THREE.Shape();
    shield.moveTo(-0.12, 0.13); shield.lineTo(-0.05, 0.15); shield.lineTo(0, 0.19);
    shield.lineTo(0.05, 0.15); shield.lineTo(0.12, 0.13); shield.lineTo(0.105, -0.07);
    shield.quadraticCurveTo(0.075, -0.14, 0, -0.18);
    shield.quadraticCurveTo(-0.075, -0.14, -0.105, -0.07); shield.closePath();
    const badge = new THREE.Mesh(new THREE.ShapeGeometry(shield), ink);
    badge.position.set(0.49, -0.05, 0.536); this.group.add(badge);
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const angle = Math.PI / 2 + i * Math.PI / 5;
      const radius = i % 2 ? 0.043 : 0.093;
      const x = Math.cos(angle) * radius; const y = Math.sin(angle) * radius;
      if (i === 0) star.moveTo(x, y); else star.lineTo(x, y);
    }
    star.closePath();
    const emblem = new THREE.Mesh(new THREE.ShapeGeometry(star), white);
    emblem.position.set(0.49, -0.03, 0.54); this.group.add(emblem);
  }

  update(state: GameSnapshot['police'], time: number): void {
    this.group.visible = state.visibility > 0.01;
    this.group.position.set(state.x, state.y, 1.05);
    this.group.rotation.z = state.angle;
    if (this.previousX !== null && Math.abs(state.x - this.previousX) < 10) {
      this.wheelAngle -= (state.x - this.previousX) / CAR_WHEEL_RADIUS;
    }
    this.previousX = state.x;
    for (const wheel of this.wheels) wheel.rotation.z = this.wheelAngle;
    for (const material of this.materials) material.opacity = state.visibility;
    this.beacons.forEach((material, index) => {
      const flash = Math.sin(time * 11 + index * Math.PI) > 0 ? 1 : 0.16;
      material.opacity = state.visibility * flash;
      this.halos[index].uniforms.strength.value = state.visibility * flash * 0.8;
    });
  }

  dispose(): void {
    this.group.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    [...this.materials, ...this.halos].forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.group.removeFromParent();
  }
}
