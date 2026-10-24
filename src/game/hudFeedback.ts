export interface HudValues {
  health: number; boost: number; speed: number;
  xp: number; level: number; progress: number; distance: number; best: number;
  ammo: number; capacity: number; weapon: string;
}

interface HudNodes {
  health: HTMLElement; healthPanel: HTMLElement; air: HTMLElement; airPanel: HTMLElement;
  speed: HTMLElement; xp: HTMLElement; level: HTMLElement; xpFill: HTMLElement;
  distance: HTMLElement; best: HTMLElement; ammo: HTMLElement; weaponPanel: HTMLElement;
}

/** Event-driven feedback; rapidly changing gauges are throttled, and each
 * element owns at most one animation. Displayed speed eases without delaying
 * health, ammunition, scores, or accessible meter values. */
export class HudFeedback {
  private previous?: HudValues;
  private time = 0;
  private displaySpeed = 0;
  private speedAnchor = 0;
  private airAnchor = 100;
  private airDirection = 0;
  private airMovingUntil = 0;
  private readonly lastPulse = new Map<string, number>();
  private readonly animations = new Map<HTMLElement, Animation>();
  private readonly motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  constructor(private readonly nodes: HudNodes) {}

  private toggle(node: HTMLElement, name: string, on: boolean): void {
    if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
  }

  private play(node: HTMLElement, frames: Keyframe[], duration: number, easing = 'cubic-bezier(.2,.8,.2,1)'): void {
    if (this.motion?.matches || typeof node.animate !== 'function') return;
    this.animations.get(node)?.cancel();
    const animation = node.animate(frames, { duration, easing });
    this.animations.set(node, animation);
    animation.onfinish = () => { if (this.animations.get(node) === animation) this.animations.delete(node); };
  }

  private pulse(node: HTMLElement, color: string, duration = 420, scale = 1.12): void {
    this.play(node, [
      { transform: 'scale(1)', textShadow: '0 0 0 transparent' },
      { transform: `scale(${scale})`, textShadow: `0 0 16px ${color}`, color, offset: .27 },
      { transform: 'scale(1)', textShadow: '0 0 0 transparent' },
    ], duration);
  }

  private ready(key: string, now: number, cooldown: number): boolean {
    if (now - (this.lastPulse.get(key) ?? -Infinity) < cooldown) return false;
    this.lastPulse.set(key, now);
    return true;
  }

  update(value: HudValues, now: number, active: boolean): number {
    const previous = this.previous;
    const animate = active && !this.motion?.matches;
    const dt = Math.min(.1, Math.max(0, (now - this.time) / 1000));
    this.time = now;
    this.previous = value;
    if (previous && value.boost !== previous.boost) {
      this.airDirection = Math.sign(value.boost - previous.boost);
      this.airMovingUntil = now + 160;
    }
    const airMoving = active && now < this.airMovingUntil;
    this.toggle(this.nodes.airPanel, 'is-draining', airMoving && this.airDirection < 0 && value.boost > 0);
    this.toggle(this.nodes.airPanel, 'is-refilling', airMoving && this.airDirection > 0 && value.boost < 100);
    this.toggle(this.nodes.airPanel, 'is-depleted', value.boost <= 10);
    this.toggle(this.nodes.weaponPanel, 'is-low-ammo', value.ammo <= value.capacity * .15);

    if (!previous || !animate) {
      for (const animation of this.animations.values()) animation.cancel();
      this.animations.clear();
      this.displaySpeed = this.speedAnchor = value.speed;
      this.airAnchor = value.boost;
      return Math.round(value.speed);
    }
    this.displaySpeed += (value.speed - this.displaySpeed) * (1 - Math.exp(-dt * 12));

    if (value.health !== previous.health) {
      const restoring = value.health > previous.health;
      this.toggle(this.nodes.healthPanel, 'is-restoring', restoring);
      if (restoring) this.pulse(this.nodes.health, '#b7ffe3', 550, 1.16);
      else this.play(this.nodes.health, [
        { transform: 'translateX(0) scale(1)' },
        { transform: 'translateX(-3px) scale(1.18)', color: '#ff8c9d', textShadow: '0 0 18px #ff667d', offset: .2 },
        { transform: 'translateX(2px) scale(1.08)', offset: .48 },
        { transform: 'translateX(0) scale(1)' },
      ], 480);
    }
    if (Math.abs(value.boost - this.airAnchor) >= 10 && this.ready('air', now, 350)) {
      this.pulse(this.nodes.air, value.boost < this.airAnchor ? '#ffd194' : '#a5ffe4', 380, 1.1);
      this.airAnchor = value.boost;
    }
    if (Math.abs(value.speed - this.speedAnchor) >= 4 && this.ready('speed', now, 320)) {
      this.pulse(this.nodes.speed, value.speed > this.speedAnchor ? '#b8ffed' : '#ffcb97', 300, 1.08);
      this.speedAnchor = value.speed;
    }
    if (value.xp > previous.xp) {
      const levelUp = value.level > previous.level;
      this.pulse(this.nodes.xp, levelUp ? '#ffe3a0' : '#b6ffe6', 600, 1.17);
      if (levelUp) this.pulse(this.nodes.level, '#ffe3a0', 750, 1.18);
      const from = `scaleX(${previous.progress})`; const to = `scaleX(${value.progress})`;
      this.play(this.nodes.xpFill, levelUp ? [
        { transform: from }, { transform: 'scaleX(1)', offset: .3 },
        { transform: 'scaleX(1)', offset: .45 }, { transform: 'scaleX(0)', offset: .46 }, { transform: to },
      ] : [{ transform: from }, { transform: to }], levelUp ? 700 : 350, 'linear');
    }
    if (value.distance > previous.distance && Math.floor(value.distance / 50) > Math.floor(previous.distance / 50)) {
      this.pulse(this.nodes.distance, '#c2f9ff', 400, 1.09);
    }
    if (value.best > previous.best) this.pulse(this.nodes.best, '#ffe3a0', 750, 1.16);
    if (value.weapon === previous.weapon && value.ammo !== previous.ammo && this.ready('ammo', now, 110)) {
      this.pulse(this.nodes.ammo, value.ammo < previous.ammo ? '#ffe0a2' : '#b7ffe3', 180, 1.1);
    }
    return Math.round(this.displaySpeed);
  }
}
