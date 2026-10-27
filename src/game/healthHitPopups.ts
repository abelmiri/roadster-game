import * as THREE from 'three';
import type { HealthHitEvent } from './physics';

interface PopupView {
  id: string | null;
  serial: number;
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
}

const POOL_SIZE = 24;
const POPUP_SECONDS = 1.15;

/** Brief health labels shown at the hit location of crates and drones. */
export class HealthHitPopups {
  readonly group = new THREE.Group();
  private readonly views: PopupView[] = [];
  private readonly byId = new Map<string, PopupView>();
  private lastSerial = 0;

  constructor() {
    this.group.name = 'health-hit-popups';
    for (let index = 0; index < POOL_SIZE; index++) {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D is unavailable for health popups');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true,
        depthTest: false, depthWrite: false, toneMapped: false });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(1.05, .42, 1);
      sprite.renderOrder = 8;
      sprite.visible = false;
      this.group.add(sprite);
      this.views.push({ id: null, serial: 0, sprite, canvas, context, texture, material });
    }
  }

  private draw(view: PopupView, health: number): void {
    const { context, canvas, texture } = view;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.beginPath();
    context.roundRect(5, 5, canvas.width - 10, canvas.height - 10, 18);
    context.fillStyle = 'rgba(12, 27, 43, 0.92)';
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(155, 244, 220, 0.95)';
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = 'bold 32px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`HP ${Math.max(0, Math.ceil(health))}`, canvas.width / 2, canvas.height / 2 + 1);
    texture.needsUpdate = true;
  }

  update(events: readonly HealthHitEvent[], serial: number): void {
    if (serial < this.lastSerial) {
      this.byId.clear();
      for (const view of this.views) { view.id = null; view.sprite.visible = false; }
    }
    this.lastSerial = serial;
    const visible = new Set<string>();
    for (const event of events) {
      visible.add(event.id);
      let view = this.byId.get(event.id);
      if (!view) {
        view = this.views.find(candidate => candidate.id === null);
        if (!view) continue;
        view.id = event.id;
        this.byId.set(event.id, view);
      }
      if (view.serial !== event.serial) {
        view.serial = event.serial;
        this.draw(view, event.health);
      }
      const progress = Math.min(1, Math.max(0, event.age / POPUP_SECONDS));
      view.sprite.visible = progress < 1;
      view.sprite.position.set(event.x, event.y + (event.kind === 'drone' ? .82 : 1.15) + progress * .25, 2.8);
      view.material.opacity = progress > .78 ? (1 - progress) / .22 : 1;
    }
    for (const [id, view] of this.byId) {
      if (visible.has(id)) continue;
      view.id = null;
      view.sprite.visible = false;
      this.byId.delete(id);
    }
  }

  dispose(): void {
    for (const view of this.views) { view.texture.dispose(); view.material.dispose(); }
    this.group.removeFromParent();
  }
}
