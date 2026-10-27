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
const POPUP_SECONDS = 2.4;

/** Brief health bars shown above crates and destructible hazards after a hit. */
export class HealthHitPopups {
  readonly group = new THREE.Group();
  private readonly views: PopupView[] = [];
  private readonly byId = new Map<string, PopupView>();
  private lastSerial = 0;

  constructor() {
    this.group.name = 'health-hit-popups';
    for (let index = 0; index < POOL_SIZE; index++) {
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 48;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D is unavailable for health popups');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true,
        depthTest: false, depthWrite: false, toneMapped: false });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(1.5, .32, 1);
      sprite.renderOrder = 8;
      sprite.visible = false;
      this.group.add(sprite);
      this.views.push({ id: null, serial: 0, sprite, canvas, context, texture, material });
    }
  }

  private draw(view: PopupView, health: number, maxHealth: number): void {
    const { context, canvas, texture } = view;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const ratio = Math.max(0, Math.min(1, health / Math.max(1, maxHealth)));
    const red = Math.round(244 - ratio * 171);
    const green = Math.round(67 + ratio * 166);
    const blue = Math.round(75 + ratio * 46);
    const color = `rgb(${red}, ${green}, ${blue})`;
    const left = 8, top = 9, outerWidth = canvas.width - 16, outerHeight = canvas.height - 18;
    const innerLeft = 13, innerTop = 14, innerWidth = canvas.width - 26, innerHeight = canvas.height - 28;
    context.beginPath();
    context.roundRect(left, top, outerWidth, outerHeight, 14);
    context.fillStyle = 'rgba(8, 19, 31, 0.9)';
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = color;
    context.stroke();
    context.beginPath();
    context.roundRect(innerLeft, innerTop, innerWidth, innerHeight, 9);
    context.fillStyle = 'rgba(255, 255, 255, 0.14)';
    context.fill();
    if (ratio > 0) {
      context.beginPath();
      context.roundRect(innerLeft, innerTop, Math.max(innerHeight, innerWidth * ratio), innerHeight, 9);
      context.fillStyle = color;
      context.fill();
    }
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
        this.draw(view, event.health, event.maxHealth);
      }
      const progress = Math.min(1, Math.max(0, event.age / POPUP_SECONDS));
      view.sprite.visible = progress < 1;
      view.sprite.position.set(event.x, event.y + (event.kind === 'drone' ? .95 : 1.3) + progress * .2, 2.8);
      view.material.opacity = progress > .84 ? (1 - progress) / .16 : 1;
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
