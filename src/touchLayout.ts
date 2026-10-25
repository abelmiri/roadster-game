import { formatNumber, t } from './i18n';

const CONTROL_IDS = ['jump', 'fire', 'boost', 'aim', 'suction', 'front-jet', 'rear-jet'] as const;
type ControlId = typeof CONTROL_IDS[number];
type Placement = { x: number; y: number; size: number; hidden?: boolean };
type Layout = Partial<Record<ControlId, Placement>>;
const STORAGE_KEY = 'roadster-touch-layout';
const MIN_SIZE = 44;
const MAX_SIZE = 128;
const defaultHidden = (id: ControlId): boolean => id === 'rear-jet';
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function readLayout(storage?: Storage): Layout {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (saved?.version !== 1 || !saved.buttons || typeof saved.buttons !== 'object') return {};
    const layout: Layout = {};
    for (const id of CONTROL_IDS) {
      const value = saved.buttons[id];
      if (!value || ![value.x, value.y, value.size].every(number => typeof number === 'number' && Number.isFinite(number))) continue;
      layout[id] = { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1), size: clamp(value.size, MIN_SIZE, MAX_SIZE),
        hidden: typeof value.hidden === 'boolean' ? value.hidden : defaultHidden(id) };
    }
    return layout;
  } catch { return {}; }
}

/** Positions are fractions of the available travel, keeping the whole button on screen. */
export class TouchLayoutEditor {
  editing = false;
  private saved: Layout;
  private draft: Layout = {};
  private selected: ControlId = 'jump';
  private drag?: { id: ControlId; pointer: number; offsetX: number; offsetY: number };
  private readonly buttons: Record<ControlId, HTMLButtonElement>;
  private readonly panel = document.getElementById('touch-layout-editor')!;
  private readonly selector = document.getElementById('touch-layout-control') as HTMLSelectElement;
  private readonly sizeInput = document.getElementById('touch-layout-size') as HTMLInputElement;
  private readonly sizeOutput = document.getElementById('touch-layout-size-value')!;
  private readonly visibilityButton = document.getElementById('touch-layout-visibility') as HTMLButtonElement;
  private readonly visibilityStatus = document.getElementById('touch-layout-visibility-status')!;

  constructor(private readonly root: HTMLElement, private readonly storage?: Storage) {
    this.saved = readLayout(storage);
    this.buttons = Object.fromEntries(CONTROL_IDS.map(id => [id, document.getElementById(`touch-${id}`)!])) as Record<ControlId, HTMLButtonElement>;
    this.panel.hidden = true;
    this.sizeInput.min = String(MIN_SIZE);
    this.sizeInput.max = String(MAX_SIZE);
    this.selector.addEventListener('change', () => {
      if (CONTROL_IDS.includes(this.selector.value as ControlId)) this.select(this.selector.value as ControlId);
    });
    this.sizeInput.addEventListener('input', () => {
      const placement = this.draft[this.selected];
      if (!this.editing || !placement) return;
      placement.size = clamp(Number(this.sizeInput.value) || MIN_SIZE, MIN_SIZE, MAX_SIZE);
      this.render();
      this.updateLanguage();
    });
    this.visibilityButton.addEventListener('click', () => {
      const placement = this.draft[this.selected];
      if (!this.editing || !placement) return;
      placement.hidden = !this.isHidden(this.selected);
      this.render();
      this.updateLanguage();
    });
    for (const id of CONTROL_IDS) {
      const button = this.buttons[id];
      button.addEventListener('pointerdown', event => {
        if (!this.editing) return;
        event.preventDefault();
        if (this.drag) return;
        this.select(id);
        const rect = button.getBoundingClientRect();
        this.drag = { id, pointer: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener('pointermove', event => {
        if (!this.editing || this.drag?.pointer !== event.pointerId || this.drag.id !== id) return;
        event.preventDefault();
        const rect = this.root.getBoundingClientRect();
        const placement = this.draft[id]!;
        const size = this.visibleSize(placement.size, rect);
        placement.x = clamp((event.clientX - rect.left - this.drag.offsetX) / Math.max(1, rect.width - size), 0, 1);
        placement.y = clamp((event.clientY - rect.top - this.drag.offsetY) / Math.max(1, rect.height - size), 0, 1);
        this.render();
      });
      const release = (event: PointerEvent): void => {
        if (this.drag?.pointer === event.pointerId) this.drag = undefined;
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
      button.addEventListener('click', () => { if (this.editing) this.select(id); });
      button.addEventListener('keydown', event => {
        if (!this.editing || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return;
        event.preventDefault();
        const rect = this.root.getBoundingClientRect();
        const placement = this.draft[id]!;
        const size = this.visibleSize(placement.size, rect);
        const step = event.shiftKey ? 1 : 8;
        placement.x = clamp(placement.x + (event.code === 'ArrowRight' ? step : event.code === 'ArrowLeft' ? -step : 0) / Math.max(1, rect.width - size), 0, 1);
        placement.y = clamp(placement.y + (event.code === 'ArrowDown' ? step : event.code === 'ArrowUp' ? -step : 0) / Math.max(1, rect.height - size), 0, 1);
        this.select(id);
        this.render();
      });
    }
    window.addEventListener('resize', () => { this.drag = undefined; this.render(); });
    this.render();
  }

  begin(): void {
    this.editing = true;
    // Reveal hidden controls before measuring, so their positions and sizes
    // survive an edit. They stay available as ghost buttons in the editor.
    this.draft = { ...this.saved };
    this.render();
    this.draft = this.capture();
    this.panel.hidden = false;
    this.render();
    this.select('jump');
    this.selector.focus();
  }

  finish(save: boolean): void {
    this.drag = undefined;
    if (save) {
      this.saved = this.draft;
      try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, buttons: this.saved })); } catch { /* The layout still works for this session. */ }
    }
    this.editing = false;
    this.panel.hidden = true;
    this.render();
  }

  reset(): void {
    if (!this.editing) return;
    this.drag = undefined;
    this.draft = {};
    this.render();
    this.draft = this.capture();
    this.render();
    this.select(this.selected);
  }

  updateLanguage(): void {
    if (!this.editing) return;
    const size = this.draft[this.selected]?.size ?? MIN_SIZE;
    this.sizeInput.value = String(size);
    this.sizeOutput.textContent = t('touchSizeValue', { size: formatNumber(size) });
    this.sizeInput.setAttribute('aria-valuetext', this.sizeOutput.textContent);
    this.visibilityButton.setAttribute('aria-label', t('touchVisibility'));
    this.visibilityButton.title = t('touchVisibility');
    this.visibilityButton.setAttribute('aria-controls', `touch-${this.selected}`);
    this.visibilityButton.setAttribute('aria-pressed', String(!this.isHidden(this.selected)));
    this.visibilityStatus.textContent = t(this.isHidden(this.selected) ? 'touchHidden' : 'touchVisible');
  }

  private select(id: ControlId): void {
    this.selected = id;
    this.selector.value = id;
    for (const key of CONTROL_IDS) this.buttons[key].classList.toggle('is-selected', this.editing && id === key);
    this.updateLanguage();
  }

  private capture(): Layout {
    const rect = this.root.getBoundingClientRect();
    return Object.fromEntries(CONTROL_IDS.map(id => {
      const button = this.buttons[id].getBoundingClientRect();
      return [id, { x: clamp((button.left - rect.left) / Math.max(1, rect.width - button.width), 0, 1),
        y: clamp((button.top - rect.top) / Math.max(1, rect.height - button.height), 0, 1),
        size: clamp(button.width, MIN_SIZE, MAX_SIZE), hidden: this.isHidden(id) }];
    }));
  }

  private visibleSize(size: number, rect: DOMRect): number {
    return Math.min(size, rect.width, rect.height);
  }

  private isHidden(id: ControlId): boolean {
    return (this.editing ? this.draft : this.saved)[id]?.hidden ?? defaultHidden(id);
  }

  private render(): void {
    const rect = this.root.getBoundingClientRect();
    const layout = this.editing ? this.draft : this.saved;
    for (const id of CONTROL_IDS) {
      const button = this.buttons[id];
      const hidden = this.isHidden(id);
      button.hidden = hidden && !this.editing;
      button.classList.toggle('is-layout-hidden', hidden);
      if (rect.width <= 0 || rect.height <= 0) continue;
      const placement = layout[id];
      button.classList.toggle('is-positioned', Boolean(placement));
      button.classList.toggle('is-selected', this.editing && id === this.selected);
      const size = placement ? this.visibleSize(placement.size, rect) : 0;
      button.style.left = placement ? `${placement.x * (rect.width - size)}px` : '';
      button.style.top = placement ? `${placement.y * (rect.height - size)}px` : '';
      button.style.width = placement ? `${size}px` : '';
      button.style.height = placement ? `${size}px` : '';
    }
  }
}
