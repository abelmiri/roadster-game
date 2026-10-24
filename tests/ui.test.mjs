import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { build } from 'esbuild';

let application;
let developmentApplication;
const stubs = {
  physics: `import {VehicleWeapon} from ${JSON.stringify(path.resolve('src/game/weapons.ts'))};
  export const FIXED_STEP=1/120; export class GamePhysics {
    weapon=new VehicleWeapon();
    constructor(x,loadout){if(loadout)this.weapon.equip(loadout.id,loadout.xp);Object.assign(globalThis.snapshot,{health:100,impactSerial:0,invincibilityRemaining:0,crashed:false,wrecked:false,loopCompletions:0,obstaclesDestroyed:0,policeDestroyed:0,runXp:0,weapon:this.weapon.snapshot()});globalThis.dead=false}
    get impactSerial(){return globalThis.snapshot.impactSerial}
    get explosionSerial(){return this.weapon.destructionSerial}
    stepWreck(){globalThis.wreckSteps++}
    get hazardStates(){return []} get chunks(){return new Map()} get distance(){return globalThis.snapshot.distance}
    get crashed(){return globalThis.dead} snapshot(alpha){globalThis.lastAlpha=alpha;globalThis.snapshot.weapon=this.weapon.snapshot();return globalThis.snapshot} dispose(){}
    equipWeapon(id,xp){return this.weapon.equip(id,xp)} weaponAmmo(id){return this.weapon.ammoFor(id)}
    step(controls){globalThis.steps++;const s=globalThis.snapshot;
      this.weapon.step(1/120,controls,{...s.car,vx:14,vy:0},[],()=>{});
      if(globalThis.explosionNext){globalThis.explosionNext=false;this.weapon.destroySerial++}
      if(globalThis.impactNext){globalThis.impactNext=false;s.health-=25;s.impactSerial++;s.invincibilityRemaining=1.5;if(s.health===0)globalThis.dead=s.crashed=s.wrecked=true}
      else s.invincibilityRemaining=Math.max(0,s.invincibilityRemaining-1/120);
    }
  }`,
  visuals: `export class GameVisuals {render(s,p,dt,running,frozen,wallDelta){globalThis.lastRender={dt,running,frozen,wallDelta,health:s.health}}}`,
  audio: `export class GameAudio {muted=false;unlock(){return Promise.resolve()} toggleMuted(){return this.muted=!this.muted}
    play(event){globalThis.sounds.push(event)} update(s,r){globalThis.audioRunning=r} suspend(){} reset(){} }`,
  rapier: 'export default {init:()=>Promise.resolve()}',
  css: '',
};
before(async () => {
  const results = await Promise.all([false, true].map(development => build({ entryPoints: [path.resolve('src/main.ts')], bundle: true, write: false,
    define: { 'import.meta.env.DEV': String(development) },
    format: 'iife', platform: 'browser', plugins: [{ name: 'headless-ui', setup(builder) {
      builder.onResolve({ filter: /game\/(physics|visuals|audio)$/ }, ({ path: name }) => ({ path: name.split('/').at(-1), namespace: 'stub' }));
      builder.onResolve({ filter: /^@dimforge\/rapier2d-compat$/ }, () => ({ path: 'rapier', namespace: 'stub' }));
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path: name }) => ({ contents: stubs[name], loader: 'js', resolveDir: path.resolve() }));
    } }] })));
  [application, developmentApplication] = results.map(result => result.outputFiles[0].text);
});

async function page(language = 'en-US', saved = {}, development = false, reducedMotion = false) {
  const nodes = [];
  const ids = new Map();
  const storage = new Map(Object.entries(saved));
  const windowEvents = new Map();
  class Element {
    constructor(tag, attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.dataset = {}; this.style = {}; this.events = new Map();
      this.classes = new Set((attrs.class ?? '').split(/\s+/)); this.textContent = ''; this.hidden = false; this.animations = [];
      this.classList = {
        add: value => this.classes.add(value), remove: value => this.classes.delete(value),
        contains: value => this.classes.has(value),
        toggle: (value, on = !this.classes.has(value)) => on ? this.classes.add(value) : this.classes.delete(value),
      };
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
      if (attrs.id) ids.set(attrs.id, this);
      nodes.push(this);
    }
    get tagName() { return this.tag.toUpperCase(); }
    set innerHTML(value) {
      this.markup = value;
      if (this.attrs.id !== 'app') return;
      for (const match of value.matchAll(/<([\w-]+)([^>]*?)>/g)) {
        const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
        new Element(match[1], attrs);
      }
    }
    get innerHTML() { return this.markup; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key]; }
    addEventListener(event, handler) {
      if (!this.events.has(event)) this.events.set(event, []);
      this.events.get(event).push(handler);
    }
    dispatch(event, fields = {}) { for (const handler of this.events.get(event) ?? []) handler({preventDefault(){},pointerId:1,...fields}); }
    animate(frames, options) {
      const animation = { frames, options, cancel() { this.canceled = true; } };
      this.animations.push(animation); return animation;
    }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = null; } remove() {} appendChild() {} setPointerCapture() {}
    querySelector(selector) { return document.querySelector(selector); }
  }
  new Element('div', { id: 'app' });
  const matches = (node, selector) => selector[0] === '#' ? node.attrs.id === selector.slice(1)
    : selector[0] === '.' ? node.classes.has(selector.slice(1))
      : selector.startsWith('[data-') ? selector.slice(6, -1) in node.dataset : node.tag === selector;
  const document = {
    body: new Element('body'), documentElement: new Element('html'), hidden: false,
    getElementById: id => ids.get(id), querySelector: selector => nodes.find(node => matches(node, selector)),
    querySelectorAll: selector => nodes.filter(node => matches(node, selector)), addEventListener() {},
  };
  const context = {
    document, HTMLElement: Element, window: { matchMedia: () => ({ matches: reducedMotion }), addEventListener(event, handler) {
      if (!windowEvents.has(event)) windowEvents.set(event, []); windowEvents.get(event).push(handler);
    } }, navigator: { language },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    performance: { now: () => context.now }, requestAnimationFrame: callback => { context.frame = callback; },
    console, Intl, now: 0, steps: 0, wreckSteps: 0, sounds: [], dead: false, impactNext: false, explosionNext: false,
    snapshot: { car: { x: 7, y: 1, angle: 0 }, wheels: [], distance: 0, speed: 14, boost: 1,
      grounded: true, suctionActive: false, boostActive: false, crashed: false, jumpSerial: 0, jumpsUsed: 0,
      landingSerial: 0, landingImpact: 0, loop: null, loopCompletions: 0, obstaclesDestroyed: 0, policeDestroyed: 0, runXp: 0, crashReason: 'road',
      police: { x: -23, y: 1, angle: 0, visibility: 0, pressure: 0, gap: 30 } },
  };
  vm.createContext(context);
  vm.runInContext(development ? developmentApplication : application, context);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  await settle();
  return {
    context, ids, storage,
    async click(id) { ids.get(id).dispatch('click'); await settle(); },
    key(code, event = 'keydown', fields = {}) { for (const handler of windowEvents.get(event) ?? []) handler({ code, repeat:false, preventDefault(){}, ...fields }); },
    pointer(id, event) { ids.get(id).dispatch(event); },
    advance(now) { context.now = now; context.frame(now); },
  };
}

test('FPS counter exists only in development and samples actual frame timing twice per second', async () => {
  assert.equal((await page()).ids.has('fps-counter'), false);
  const p = await page('fa-IR', {}, true);
  const counter = p.ids.get('fps-counter');
  assert.equal(counter.getAttribute('dir'), 'ltr');
  const initial = counter.textContent;
  p.advance(0);
  for (let now = 20; now < 500; now += 20) p.advance(now);
  assert.equal(counter.textContent, initial);
  p.advance(500);
  assert.equal(counter.textContent, '50 FPS');
  for (let now = 600; now <= 1000; now += 100) p.advance(now);
  assert.equal(counter.textContent, '10 FPS', 'uses uncapped frame time instead of physics delta');
  p.advance(6000);
  for (let now = 6025; now <= 6500; now += 25) p.advance(now);
  assert.equal(counter.textContent, '40 FPS', 'ignores a suspended tab interval');
});

test('health HUD localizes; an impact freezes physics for 500 ms, plays once, then shows protection', async () => {
  const p = await page('fa-IR');
  assert.equal(p.ids.get('health-value').textContent, '۱۰۰٪');
  assert.equal(p.ids.get('health-meter').getAttribute('aria-label'), 'سلامت خودرو');
  await p.click('primary-button');
  p.context.impactNext = true;
  p.advance(17);
  const stoppedAt = p.context.steps;
  assert.equal(p.ids.get('health-value').textContent, '۷۵٪');
  assert.equal(p.ids.get('health-meter').getAttribute('aria-valuenow'), '75');
  assert.equal(p.context.lastRender.frozen, true);
  assert.equal(p.context.audioRunning, false);
  assert.equal(p.ids.get('overlay').classList.contains('is-visible'), false);
  p.advance(117); p.advance(516.9);
  assert.ok(p.context.lastRender.wallDelta>.3,'camera time must advance while the physics scene is frozen');
  assert.equal(p.context.steps, stoppedAt);
  assert.equal(p.context.snapshot.invincibilityRemaining, 1.5);
  assert.equal(p.context.sounds.filter(event => event === 'impact').length, 1);
  p.advance(534);
  assert.equal(p.context.steps, stoppedAt, 'the first recovery frame should start gently');
  assert.equal(p.context.lastAlpha, 1, 'slow recovery must not interpolate backward from the impact pose');
  assert.ok(p.context.lastRender.dt > 0 && p.context.lastRender.dt < .001);
  for (let i = 1; i <= 12; i++) p.advance(534 + i * 17);
  assert.ok(p.context.steps > stoppedAt);
  assert.equal(p.context.lastRender.frozen, false);
  assert.match(p.ids.get('challenge-hint').textContent, /محافظت موقت/);
});

test('health loss animates once, trails the lost segment, and keeps actual accessible values immediate', async () => {
  const p = await page('fa-IR');
  const value = p.ids.get('health-value');
  assert.equal(value.animations.length, 0, 'loading must not look like damage');
  await p.click('primary-button');
  p.context.impactNext = true; p.advance(17);
  assert.equal(value.textContent, '۷۵٪');
  assert.equal(p.ids.get('health-meter').getAttribute('aria-valuenow'), '75');
  assert.equal(p.ids.get('health-fill').style.transform, 'scaleX(0.75)');
  assert.equal(p.ids.get('health-trail').style.transform, 'scaleX(0.75)');
  assert.equal(value.animations.length, 1);
  assert.ok(value.animations[0].frames.some(frame => frame.color === '#ff8c9d'));
  p.advance(117); await p.click('language-button');
  assert.equal(value.animations.length, 1, 'steady values and translation must not replay damage');
  p.context.snapshot.health = 100; p.advance(134);
  assert.equal(p.ids.get('health-panel').classList.contains('is-restoring'), true);
  assert.equal(value.animations.length, 2);
});

test('XP rewards celebrate level changes and fill through the boundary instead of draining backward', async () => {
  const p = await page('en-US', { 'roadster-xp': '95' });
  await p.click('primary-button');
  p.context.snapshot.obstaclesDestroyed = 1; p.advance(17);
  assert.equal(p.ids.get('xp-total').textContent, '105 XP');
  assert.equal(p.ids.get('xp-fill').style.transform, 'scaleX(0.05)');
  assert.equal(p.ids.get('xp-meter').getAttribute('aria-valuenow'), '5');
  assert.equal(p.ids.get('xp-level').animations.length, 1);
  const fill = p.ids.get('xp-fill').animations[0];
  assert.ok(fill.frames.some(frame => frame.transform === 'scaleX(1)'));
  assert.ok(fill.frames.some(frame => frame.transform === 'scaleX(0)'));
  p.advance(34);
  assert.equal(p.ids.get('xp-total').animations.length, 1, 'a reward must not flash every frame');
});

test('air use and refill have different feedback; speed eases and ammunition reacts to firing', async () => {
  const p = await page('en-US', { 'roadster-xp': '50' });
  await p.click('primary-button');
  p.context.snapshot.boost = .82; p.context.snapshot.speed = 25;
  p.key('KeyF'); p.advance(17); p.key('KeyF', 'keyup');
  assert.equal(p.ids.get('boost-panel').classList.contains('is-draining'), true);
  assert.equal(p.ids.get('boost-meter').getAttribute('aria-valuenow'), '82');
  assert.equal(p.ids.get('boost-fill').style.transform, 'scaleX(0.82)');
  assert.ok(Number(p.ids.get('speed').textContent) > 50 && Number(p.ids.get('speed').textContent) < 90);
  assert.equal(p.ids.get('weapon-ammo').animations.length, 1);
  p.key('Digit2');
  assert.equal(p.ids.get('weapon-ammo').animations.length, 1, 'switching weapons must not look like firing');
  p.advance(200);
  assert.equal(p.ids.get('boost-panel').classList.contains('is-draining'), false, 'stationary reserves must not keep animating');
  p.context.snapshot.boost = .95; p.advance(400);
  assert.equal(p.ids.get('boost-panel').classList.contains('is-refilling'), true);
  assert.equal(p.ids.get('boost-value').animations.length, 2);
  assert.ok(p.ids.get('boost-value').animations[1].frames.some(frame => frame.color === '#a5ffe4'));
});

test('reduced-motion mode shows exact values without animated HUD pulses', async () => {
  const p = await page('en-US', {}, false, true);
  await p.click('primary-button');
  p.context.impactNext = true; p.context.snapshot.speed = 25;
  p.context.snapshot.obstaclesDestroyed = 1; p.advance(17);
  assert.equal(p.ids.get('health-value').textContent, '75%');
  assert.equal(p.ids.get('speed').textContent, '90');
  for (const id of ['health-value', 'speed', 'xp-total', 'xp-fill']) assert.equal(p.ids.get(id).animations.length, 0);
});

test('manual pause preserves the remaining impact freeze without catch-up on resume', async () => {
  const p = await page();
  await p.click('primary-button');
  p.context.impactNext = true; p.advance(17); p.advance(117);
  const stoppedAt = p.context.steps;
  await p.click('pause-button'); p.advance(10117);
  assert.equal(p.context.steps, stoppedAt);
  assert.equal(p.context.lastRender.wallDelta,0,'manual pause must hold the camera during a hit stop');
  await p.click('primary-button'); p.advance(10417);
  assert.equal(p.context.steps, stoppedAt);
  assert.equal(p.context.lastRender.frozen, true);
  p.advance(10534);
  assert.equal(p.context.steps, stoppedAt);
  for (let i = 1; i <= 12; i++) p.advance(10534 + i * 17);
  assert.ok(p.context.steps > stoppedAt && p.context.steps - stoppedAt <= 3);
});

test('fatal damage opens a blurred menu immediately while the wreck keeps moving at quarter speed', async () => {
  const p = await page();
  await p.click('primary-button');
  p.context.snapshot.health = 25; p.context.snapshot.impactSerial = 3;
  p.context.impactNext = true; p.advance(17);
  const stoppedAt = p.context.steps;
  assert.equal(p.ids.get('health-value').textContent, '0%');
  assert.equal(p.ids.get('overlay').classList.contains('is-visible'), true);
  assert.equal(p.ids.get('overlay').classList.contains('is-game-over'), true);
  assert.equal(p.ids.get('primary-button').disabled, true);
  assert.equal(p.ids.get('primary-label').textContent, 'Restart in 3s');
  assert.equal(p.context.lastRender.frozen, false);
  assert.equal(p.context.lastRender.running, true);
  const wreckAt = p.context.wreckSteps;
  for (let i = 1; i <= 30; i++) p.advance(17 + i * 1000 / 60);
  assert.ok(Math.abs(p.context.wreckSteps - wreckAt - 15) <= 1, '0.5 seconds should advance 0.125 seconds of wreck physics');
  assert.ok(Math.abs(p.context.lastRender.dt - 1 / 240) < 1e-9, 'wreck effects must use the same quarter-speed time scale');
  assert.equal(p.context.steps, stoppedAt, 'driving and combat must stop after defeat');
  assert.match(p.ids.get('eyebrow').innerHTML, /CAR DESTROYED/);
  assert.equal(p.context.sounds.filter(event => event === 'impact').length, 1);
  assert.equal(p.context.sounds.filter(event => event === 'crash').length, 0, 'do not duplicate the fatal impact sound');
  await p.click('primary-button');
  assert.equal(p.context.snapshot.health, 0, 'restart clicks must be ignored during the lock');
  p.advance(3017);
  assert.equal(p.ids.get('primary-button').disabled, false);
  assert.equal(p.context.snapshot.health, 0, 'unlocking must wait for fresh input');
  await p.click('primary-button'); p.advance(3035);
  assert.equal(p.ids.get('health-value').textContent, '100%');
  assert.equal(p.context.snapshot.impactSerial, 0);
  assert.equal(p.context.snapshot.invincibilityRemaining, 0);
  assert.equal(p.context.lastRender.frozen, false);
  assert.ok(p.context.steps > stoppedAt);
  assert.equal(p.ids.get('overlay').classList.contains('is-visible'), false);
});

test('restart inputs are locked for three real seconds, and held Space cannot restart automatically', async () => {
  const p = await page('fa-IR');
  await p.click('primary-button');
  p.context.snapshot.health = 25; p.context.impactNext = true; p.advance(17);
  assert.equal(p.ids.get('primary-label').textContent, '۳ ثانیه تا شروع دوباره');
  for (const code of ['Space', 'ArrowUp', 'KeyW']) { p.key(code); p.key(code, 'keyup'); }
  p.pointer('touch-jump', 'pointerdown'); p.pointer('touch-jump', 'pointerup');
  await p.click('primary-button');
  assert.equal(p.context.snapshot.health, 0);
  p.advance(1017);
  assert.equal(p.ids.get('primary-label').textContent, '۲ ثانیه تا شروع دوباره');
  p.advance(2017);
  assert.equal(p.ids.get('primary-label').textContent, '۱ ثانیه تا شروع دوباره');
  p.advance(3016.9);
  p.key('Space'); // Keep this early press held across the unlock boundary.
  assert.equal(p.context.snapshot.health, 0);
  assert.equal(p.ids.get('primary-button').disabled, true);
  p.advance(3017);
  assert.equal(p.ids.get('primary-button').disabled, false, 'the lock uses wall time, not quarter-speed wreck time');
  assert.equal(p.ids.get('primary-label').textContent, 'دوباره بران');
  assert.match(p.ids.get('overlay-foot').innerHTML, />Space<\/bdi>/);
  p.key('Space', 'keydown', { repeat: true });
  assert.equal(p.context.snapshot.health, 0, 'holding a key across unlock must not queue a restart');
  p.key('Space', 'keyup'); p.key('Space');
  assert.equal(p.context.snapshot.health, 100);
  p.advance(3034);
  assert.equal(p.context.snapshot.jumpSerial, 0, 'a restart press must not carry a jump into the new run');
});

test('weapon destruction freezes the scene for 30 ms without showing collision damage feedback', async () => {
  const p = await page();
  await p.click('primary-button');
  p.context.explosionNext = true;
  p.advance(17);
  const stoppedAt = p.context.steps;
  assert.equal(p.context.lastRender.frozen, true);
  assert.equal(p.context.snapshot.health, 100);
  assert.equal(p.ids.get('impact-flash').style.opacity, '0');
  assert.equal(p.ids.get('challenge-hint').hidden, true);
  assert.equal(p.context.sounds.filter(event => event === 'explosion').length, 1);
  p.advance(46.9);
  assert.equal(p.context.steps, stoppedAt);
  assert.equal(p.context.lastRender.frozen, true);
  p.advance(64);
  assert.equal(p.context.steps, stoppedAt, 'explosion recovery should also start gently');
  assert.equal(p.context.lastRender.frozen, false);
  for (let i = 1; i <= 12; i++) p.advance(64 + i * 17);
  assert.ok(p.context.steps > stoppedAt);
  assert.equal(p.context.lastRender.frozen, false);
  assert.equal(p.context.sounds.filter(event => event === 'explosion').length, 1);
});

test('physics and visual effects share a smooth 800 ms recovery after either kind of hit stop', async () => {
  for (const [trigger, freeze] of [['impactNext', 500], ['explosionNext', 30]]) {
    const p = await page();
    await p.click('primary-button');
    p.context[trigger] = true; p.advance(17);
    const stoppedAt = p.context.steps;
    p.advance(17 + freeze);
    let previousDelta = 0;
    for (let i = 1; i <= 20; i++) {
      p.advance(17 + freeze + i * 40);
      assert.equal(p.context.lastRender.frozen, false);
      assert.ok(p.context.lastRender.dt > previousDelta);
      assert.ok(p.context.lastRender.dt < .04);
      previousDelta = p.context.lastRender.dt;
    }
    assert.ok(Math.abs(p.context.steps - stoppedAt - 48) <= 1);
    p.advance(17 + freeze + 840);
    assert.ok(Math.abs(p.context.lastRender.dt - .04) < 1e-9);
  }
});

test('manually pausing during recovery preserves its speed ramp', async () => {
  const p = await page();
  await p.click('primary-button');
  p.context.explosionNext = true; p.advance(17); p.advance(47);
  p.advance(82); p.advance(117);
  const previous = p.context.lastRender.dt;
  const stoppedAt = p.context.steps;
  await p.click('pause-button'); p.advance(10117);
  assert.equal(p.context.steps, stoppedAt);
  await p.click('primary-button'); p.advance(10152);
  assert.ok(p.context.lastRender.dt > previous && p.context.lastRender.dt < .01);
});

test('police warnings and edge lights follow the patrol ahead of or behind the player', async () => {
  const p = await page();
  await p.click('primary-button');
  Object.assign(p.context.snapshot.police, { gap: -8, visibility: 1, pressure: .8 });
  p.advance(17);
  assert.match(p.ids.get('challenge-hint').textContent, /POLICE AHEAD/);
  assert.equal(p.ids.get('pursuit-glow').classList.contains('is-ahead'), true);
  p.context.snapshot.police.gap = 8;
  p.advance(34);
  assert.match(p.ids.get('challenge-hint').textContent, /CLOSING IN/);
  assert.equal(p.ids.get('pursuit-glow').classList.contains('is-ahead'), false);
});

test('Farsi keeps physical key names in English across ready, pause, and restart', async () => {
  const p = await page('fa-IR');
  const keys = p.context.document.querySelectorAll('kbd');
  const space = keys.find(key => key.dataset.i18n === 'spaceKey');
  const shift = keys.find(key => key.dataset.i18n === 'shiftKey');
  assert.equal(space.textContent, 'SPACE');
  assert.equal(shift.textContent, 'SHIFT');
  for (const key of keys) {
    assert.equal(key.getAttribute('lang'), 'en');
    assert.equal(key.getAttribute('dir'), 'ltr');
  }
  assert.match(p.ids.get('overlay-foot').innerHTML, />Space<\/bdi>/);
  await p.click('primary-button');
  await p.click('pause-button');
  assert.match(p.ids.get('overlay-foot').innerHTML, />Space<\/bdi>/);
  assert.match(p.ids.get('pause-button').title, /P \/ Space/);
  await p.click('primary-button');
  p.context.snapshot.health = 25; p.context.impactNext = true;
  p.advance(17); p.advance(518);
  assert.equal(p.ids.get('primary-label').textContent, '۳ ثانیه تا شروع دوباره');
  p.advance(3017);
  assert.match(p.ids.get('overlay-foot').innerHTML, />Space<\/bdi>/);
  await p.click('language-button');
  assert.equal(space.textContent, 'SPACE');
  assert.equal(shift.textContent, 'SHIFT');
});

test('armory respects XP locks, remembers equipment, pauses combat, and switching cannot refill ammo', async () => {
  const p = await page('fa-IR', { 'roadster-xp':'125' });
  assert.equal(p.ids.get('equip-gatling-gun').disabled, false);
  assert.equal(p.ids.get('equip-cannon').disabled, true);
  await p.click('armory-button');
  assert.equal(p.ids.get('armory').hidden, false);
  await p.click('equip-gatling-gun');
  assert.equal(p.storage.get('roadster-weapon'), 'gatling-gun');
  assert.equal(p.context.snapshot.weapon.id, 'gatling-gun');
  await p.click('armory-close');
  await p.click('primary-button');
  p.key('KeyF'); p.advance(17); p.advance(77); p.key('KeyF','keyup');
  const remaining = p.context.snapshot.weapon.ammo;
  assert.ok(remaining < 150);
  await p.click('armory-button');
  const steps = p.context.steps;
  p.key('KeyF'); p.advance(137);
  assert.equal(p.context.steps, steps);
  assert.equal(p.context.snapshot.weapon.ammo, remaining);
  await p.click('equip-machine-gun'); await p.click('equip-gatling-gun');
  assert.equal(p.context.snapshot.weapon.ammo, remaining);
  p.key('Escape');
  assert.equal(p.ids.get('armory').hidden, true);
  p.advance(197);
  assert.ok(p.context.steps > steps);
  assert.equal(p.context.snapshot.weapon.ammo, remaining, 'opening the armory must clear held fire');
});

test('touch fire and aim share keyboard rotation limits; impact freeze preserves shots and ammunition', async () => {
  const p = await page();
  await p.click('primary-button');
  await p.click('touch-aim');
  p.pointer('touch-fire','pointerdown'); p.advance(17);
  assert.ok(p.context.snapshot.weapon.turnRemaining > .5);
  assert.equal(p.context.snapshot.weapon.ammo,80);
  for (let now=77;now<=677;now+=60) p.advance(now);
  assert.equal(p.context.snapshot.weapon.direction,-1);
  assert.ok(p.context.snapshot.weapon.ammo < 80);
  p.context.impactNext = true; p.advance(737);
  const weapon = JSON.stringify(p.context.snapshot.weapon);
  p.advance(937); p.advance(1137);
  assert.equal(JSON.stringify(p.context.snapshot.weapon),weapon);
  p.pointer('touch-fire','pointerup');
});

test('earned loop XP unlocks an upgrade immediately, and the selected weapon survives a reload', async () => {
  const p=await page('fa-IR');
  assert.equal(p.ids.get('equip-twin-gun').disabled,true);
  await p.click('primary-button');
  p.context.snapshot.loopCompletions=1;p.advance(17);
  await p.click('armory-button');
  assert.equal(p.ids.get('equip-twin-gun').disabled,true,'25 XP must not unlock the twin gun');
  await p.click('armory-close');
  p.context.snapshot.loopCompletions=2;p.advance(77);
  await p.click('armory-button');
  assert.equal(p.ids.get('equip-twin-gun').disabled,false);
  await p.click('equip-twin-gun');
  assert.equal(p.storage.get('roadster-xp'),'50','equipping must not spend XP');
  assert.equal(p.context.snapshot.weapon.id,'twin-gun');
  const reloaded=await page('fa-IR',Object.fromEntries(p.storage));
  assert.equal(reloaded.context.snapshot.weapon.id,'twin-gun');
  assert.equal(reloaded.context.snapshot.weapon.ammo,100);
  assert.equal(reloaded.ids.get('equip-twin-gun').getAttribute('aria-pressed'),'true');
});

test('combat XP shows its source, unlocks equipment, persists, and never pays twice on restart', async () => {
  const p=await page('fa-IR');
  await p.click('primary-button');
  p.context.snapshot.obstaclesDestroyed=1;p.context.snapshot.runXp=10;p.advance(17);
  assert.equal(p.storage.get('roadster-xp'),'10');
  assert.match(p.ids.get('xp-toast').textContent,/نابودی مانع.*۱۰ XP/);
  p.context.snapshot.policeDestroyed=1;p.context.snapshot.runXp=30;p.advance(77);
  assert.equal(p.storage.get('roadster-xp'),'30');
  assert.match(p.ids.get('xp-toast').textContent,/نابودی پلیس.*۲۰ XP/);
  p.advance(137);
  assert.equal(p.storage.get('roadster-xp'),'30');
  p.context.snapshot.obstaclesDestroyed=3;p.context.snapshot.runXp=50;p.advance(197);
  assert.equal(p.storage.get('roadster-xp'),'50');
  await p.click('armory-button');
  assert.equal(p.ids.get('equip-twin-gun').disabled,false);
  await p.click('equip-twin-gun');await p.click('armory-close');
  p.context.snapshot.health=25;p.context.impactNext=true;p.advance(257);p.advance(758);
  assert.match(p.ids.get('overlay-description').textContent,/۵۰ XP/);
  p.advance(3257);
  await p.click('primary-button');p.advance(3317);
  assert.equal(p.context.snapshot.obstaclesDestroyed,0);
  assert.equal(p.context.snapshot.policeDestroyed,0);
  assert.equal(p.storage.get('roadster-xp'),'50');
  p.context.snapshot.obstaclesDestroyed=1;p.advance(3377);
  assert.equal(p.storage.get('roadster-xp'),'60','a new run may earn rewards from new targets');
});


test('number row and numpad select all eight weapons without opening armory or refilling ammunition', async () => {
  const p = await page('fa-IR', { 'roadster-xp': '950' });
  await p.click('primary-button');
  p.key('KeyF'); p.advance(100); p.key('KeyF', 'keyup');
  const spent = p.context.snapshot.weapon.ammo;
  assert.ok(spent < 80);
  const ids = ['machine-gun','twin-gun','gatling-gun','cannon','rocket-launcher','missile-launcher','laser-gun','plasma-cannon'];
  for (const prefix of ['Digit','Numpad']) for (let i = 1; i <= 8; i++) {
    p.key(`${prefix}${i}`);
    assert.equal(p.context.snapshot.weapon.id, ids[i - 1]);
    assert.equal(p.storage.get('roadster-weapon'), ids[i - 1]);
    assert.equal(p.ids.get('armory').hidden, true);
    assert.equal(p.ids.get('overlay').classList.contains('is-visible'), false);
  }
  p.key('Digit1');
  assert.equal(p.context.snapshot.weapon.ammo, spent);
  await p.click('armory-button');
  p.key('Digit8');
  assert.equal(p.context.snapshot.weapon.id, 'plasma-cannon');
  assert.equal(p.ids.get('armory').hidden, false);
  assert.equal(p.ids.get('equip-plasma-cannon').getAttribute('aria-keyshortcuts'), '8');
});

test('weapon hotkeys respect XP locks, editable fields, repeats and browser modifier shortcuts', async () => {
  const locked = await page('en-US', { 'roadster-xp': '50' });
  locked.key('Digit8');
  assert.equal(locked.context.snapshot.weapon.id, 'machine-gun');
  locked.key('Numpad2');
  assert.equal(locked.context.snapshot.weapon.id, 'twin-gun');
  const translated = await page('fa-IR', { 'roadster-xp': '950' });
  translated.key('Unidentified', 'keydown', { key: '۸' });
  assert.equal(translated.context.snapshot.weapon.id, 'plasma-cannon');
  translated.key('Unidentified', 'keydown', { key: '٢' });
  assert.equal(translated.context.snapshot.weapon.id, 'twin-gun');
  const p = await page('en-US', { 'roadster-xp': '950' });
  for (const fields of [{ctrlKey:true},{metaKey:true},{altKey:true},{repeat:true},
    {target:new p.context.HTMLElement('input')},{target:new p.context.HTMLElement('textarea')},
    {target:Object.assign(new p.context.HTMLElement('div'),{isContentEditable:true})}]) {
    p.key('Digit8', 'keydown', fields);
    assert.equal(p.context.snapshot.weapon.id, 'machine-gun');
  }
  p.key('Digit9'); p.key('Digit0');
  assert.equal(p.context.snapshot.weapon.id, 'machine-gun');
});
