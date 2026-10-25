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
    constructor(x,loadout){this.weapon=new VehicleWeapon('machine-gun',loadout?.upgrades);if(loadout)this.weapon.equip(loadout.id,loadout.xp);Object.assign(globalThis.snapshot,{distance:0,health:100,impactSerial:0,invincibilityRemaining:0,crashed:false,wrecked:false,loopCompletions:0,obstaclesDestroyed:0,policeDestroyed:0,runXp:0,weapon:this.weapon.snapshot()});globalThis.dead=false}
    get impactSerial(){return globalThis.snapshot.impactSerial}
    get explosionSerial(){return this.weapon.destructionSerial}
    stepWreck(){globalThis.wreckSteps++}
    get hazardStates(){return []} get chunks(){return new Map()} get distance(){return globalThis.snapshot.distance}
    get crashed(){return globalThis.dead} snapshot(alpha){globalThis.lastAlpha=alpha;globalThis.snapshot.weapon=this.weapon.snapshot();return globalThis.snapshot} dispose(){}
    equipWeapon(id,xp){return this.weapon.equip(id,xp)} weaponAmmo(id){return this.weapon.ammoFor(id)}
    upgradeWeapon(id,level){this.weapon.setUpgradeLevel(id,level)}
    step(controls){globalThis.steps++;globalThis.lastControls=controls;const s=globalThis.snapshot;
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

const weaponIds = ['machine-gun','twin-gun','gatling-gun','cannon','rocket-launcher','missile-launcher','laser-gun','plasma-cannon'];
const progressSave = (coins = 0, ownedWeapons = ['machine-gun'], record = { distance: 0, name: '', needsName: false }, weaponUpgrades = {}) =>
  JSON.stringify({ version: 1, coins, ownedWeapons, weaponUpgrades, record, playerName: record.name });

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
    querySelectorAll(selector) {
      if (this.attrs.id === 'touch-controls' && selector === 'button') return ['fire', 'suction', 'aim', 'boost', 'jump'].map(id => ids.get(`touch-${id}`));
      if (this.attrs.id === 'touch-layout-editor' && selector === 'select, input, button') return ['control', 'size', 'reset', 'cancel', 'save'].map(id => ids.get(`touch-layout-${id}`));
      return document.querySelectorAll(selector);
    }
    getBoundingClientRect() {
      const width = context.window.innerWidth - 56;
      const height = context.window.innerHeight - 152;
      if (this.attrs.id === 'touch-controls') return { left: 28, top: 134, width, height };
      const id = this.attrs.id?.replace(/^touch-/, '');
      const sizes = { jump: 76, fire: 54, boost: 60, aim: 44, suction: 60 };
      if (!(id in sizes)) return { left: 0, top: 0, width: 0, height: 0 };
      const size = Number.parseFloat(this.style.width) || sizes[id];
      const left = this.classes.has('is-positioned') ? Number.parseFloat(this.style.left)
        : id === 'jump' ? width - size : id === 'boost' ? width - 90 - size : id === 'aim' ? 69 : 0;
      const top = this.classes.has('is-positioned') ? Number.parseFloat(this.style.top)
        : height - size - (id === 'fire' ? 69 : id === 'aim' ? 8 : 0);
      return { left: 28 + left, top: 134 + top, width: size, height: size };
    }
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
    document, HTMLElement: Element, window: { innerWidth: 844, innerHeight: 390, matchMedia: () => ({ matches: reducedMotion }), addEventListener(event, handler) {
      if (!windowEvents.has(event)) windowEvents.set(event, []); windowEvents.get(event).push(handler);
    } }, navigator: { language },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    performance: { now: () => context.now }, requestAnimationFrame: callback => { context.frame = callback; },
    console, Intl, now: 0, steps: 0, wreckSteps: 0, sounds: [], dead: false, impactNext: false, explosionNext: false,
    snapshot: { car: { x: 7, y: 1, angle: 0 }, wheels: [], distance: 0, speed: 60 / 3.6, boost: 1,
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
    pointer(id, event, fields = {}) { ids.get(id).dispatch(event, fields); },
    resize(width, height) {
      context.window.innerWidth = width; context.window.innerHeight = height;
      for (const handler of windowEvents.get('resize') ?? []) handler({});
    },
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
  const p = await page('en-US', { 'roadster-xp': '100', 'roadster-progress': progressSave(0, ['machine-gun', 'twin-gun']) });
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

test('fatal damage opens a blurred menu immediately while the wreck keeps moving at one-eighth speed', async () => {
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
  assert.ok(Math.abs(p.context.wreckSteps - wreckAt - 7.5) <= 1, '0.5 seconds should advance 0.0625 seconds of wreck physics');
  assert.ok(Math.abs(p.context.lastRender.dt - 1 / 480) < 1e-9, 'wreck effects must use the same one-eighth-speed time scale');
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
  assert.equal(p.ids.get('primary-button').disabled, false, 'the lock uses wall time, not slowed wreck time');
  assert.equal(p.ids.get('primary-label').textContent, 'دوباره بران');
  assert.match(p.ids.get('overlay-foot').innerHTML, />Space<\/bdi>/);
  p.key('Space', 'keydown', { repeat: true });
  assert.equal(p.context.snapshot.health, 0, 'holding a key across unlock must not queue a restart');
  p.key('Space', 'keyup'); p.key('Space');
  assert.equal(p.context.snapshot.health, 100);
  p.advance(3034);
  assert.equal(p.context.snapshot.jumpSerial, 0, 'a restart press must not carry a jump into the new run');
});

test('weapon destruction keeps moving while easing down for 200 ms and recovering for 1000 ms', async () => {
  const p = await page();
  await p.click('primary-button');
  p.context.explosionNext = true; p.advance(17);
  const stepsAtExplosion = p.context.steps;
  assert.equal(p.context.lastRender.frozen, false);
  assert.equal(p.context.snapshot.health, 100);
  assert.equal(p.ids.get('impact-flash').style.opacity, '0');
  assert.equal(p.ids.get('challenge-hint').hidden, true);
  let previous = .02;
  let simulationTime = 0;
  for (let i = 1; i <= 10; i++) {
    p.advance(17 + i * 20);
    const dt = p.context.lastRender.dt;
    assert.equal(p.context.lastRender.frozen, false);
    assert.ok(dt > 0 && dt < previous, `slowdown delta=${dt}`);
    previous = dt;
    simulationTime += dt;
  }
  assert.ok(p.context.steps > stepsAtExplosion, 'physics stopped during the explosion');
  previous = 0;
  for (let i = 1; i <= 20; i++) {
    p.advance(217 + i * 50);
    const dt = p.context.lastRender.dt;
    assert.equal(p.context.lastRender.frozen, false);
    assert.ok(dt > previous && dt < .05, `recovery delta=${dt}`);
    previous = dt;
    simulationTime += dt;
  }
  assert.ok(Math.abs((p.context.steps - stepsAtExplosion) / 120 - simulationTime) < 1 / 120,
    'physics and effects used different time scales');
  p.advance(1267);
  assert.ok(Math.abs(p.context.lastRender.dt - .05) < 1e-9);
  assert.equal(p.context.sounds.filter(event => event === 'explosion').length, 1);
});

test('physics and visual effects share a smooth 800 ms recovery after collision hit stop', async () => {
  const p = await page();
  await p.click('primary-button');
  p.context.impactNext = true; p.advance(17);
  const stoppedAt = p.context.steps;
  p.advance(517);
  let previousDelta = 0;
  for (let i = 1; i <= 20; i++) {
    p.advance(517 + i * 40);
    assert.equal(p.context.lastRender.frozen, false);
    assert.ok(p.context.lastRender.dt > previousDelta);
    assert.ok(p.context.lastRender.dt < .04);
    previousDelta = p.context.lastRender.dt;
  }
  assert.ok(Math.abs(p.context.steps - stoppedAt - 48) <= 1);
  p.advance(1357);
  assert.ok(Math.abs(p.context.lastRender.dt - .04) < 1e-9);
});

test('manually pausing during recovery preserves its speed ramp', async () => {
  const p = await page();
  await p.click('primary-button');
  p.context.explosionNext = true; p.advance(17); p.advance(217);
  p.advance(252); p.advance(287);
  const previous = p.context.lastRender.dt;
  const stoppedAt = p.context.steps;
  await p.click('pause-button'); p.advance(10287);
  assert.equal(p.context.steps, stoppedAt);
  await p.click('primary-button'); p.advance(10322);
  assert.ok(p.context.lastRender.dt > previous && p.context.lastRender.dt < .02);
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
  const p = await page('fa-IR', { 'roadster-xp':'250', 'roadster-progress': progressSave(2000) });
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

test('G toggles the armory, clears held controls, and preserves ready, running, and paused states', async () => {
  const p = await page();
  p.key('KeyG');
  assert.equal(p.ids.get('armory').hidden, false);
  p.key('KeyG', 'keydown', { repeat: true });
  assert.equal(p.ids.get('armory').hidden, false);
  p.key('KeyG');
  assert.equal(p.ids.get('armory').hidden, true);
  assert.equal(p.ids.get('overlay').classList.contains('is-visible'), true);
  await p.click('primary-button');
  p.key('KeyF'); p.advance(17);
  const ammo = p.context.snapshot.weapon.ammo;
  p.key('KeyG'); p.advance(100);
  assert.equal(p.context.audioRunning, false);
  assert.equal(p.context.snapshot.weapon.ammo, ammo);
  await p.click('armory-button'); // Opening an already-open armory must preserve auto-resume.
  p.key('KeyG'); p.advance(117);
  assert.equal(p.context.audioRunning, true);
  assert.equal(p.context.lastControls.fire, false);
  p.key('KeyP'); p.key('KeyG'); p.key('Escape'); p.advance(134);
  assert.equal(p.context.audioRunning, false);
  p.key('KeyG', 'keydown', { target: p.ids.get('touch-layout-control') });
  assert.equal(p.ids.get('armory').hidden, true, 'typing in a form must not open the armory');
});

test('touch layout edits every control independently, pauses input, persists, and resumes cleanly', async () => {
  const p = await page('fa-IR');
  await p.click('primary-button');
  p.pointer('touch-fire', 'pointerdown'); p.advance(17);
  await p.click('touch-layout-button');
  p.advance(100);
  const stoppedAt = p.context.steps;
  assert.equal(p.context.audioRunning, false);
  assert.equal(p.ids.get('touch-layout-editor').hidden, false);
  assert.equal(p.ids.get('touch-layout-title').textContent, 'چیدمان دکمه‌ها');
  assert.equal(p.ids.get('touch-layout-size-value').textContent, '۷۶ پیکسل');
  p.ids.get('touch-layout-save').focus(); p.key('Tab');
  assert.equal(p.context.document.activeElement, p.ids.get('touch-fire'));
  p.key('Tab', 'keydown', { shiftKey: true });
  assert.equal(p.context.document.activeElement, p.ids.get('touch-layout-save'));
  const sizes = { jump: 98, fire: 87, boost: 103, aim: 63, suction: 72 };
  for (const [id, size] of Object.entries(sizes)) {
    const button = p.ids.get(`touch-${id}`);
    const before = button.getBoundingClientRect();
    p.pointer(`touch-${id}`, 'pointerdown', { clientX: before.left + 10, clientY: before.top + 10 });
    assert.equal(p.ids.get('touch-layout-control').value, id);
    p.pointer(`touch-${id}`, 'pointermove', { clientX: 300, clientY: 210 });
    p.pointer(`touch-${id}`, 'pointerup');
    p.ids.get('touch-layout-size').value = String(size);
    p.ids.get('touch-layout-size').dispatch('input');
    assert.equal(button.style.width, `${size}px`);
    assert.equal(button.classList.contains('is-pressed'), false);
  }
  await p.click('touch-aim');
  p.key('KeyG'); p.key('Space'); p.key('Digit8'); p.advance(200);
  assert.equal(p.context.steps, stoppedAt);
  assert.equal(p.ids.get('armory').hidden, true);
  assert.equal(p.storage.has('roadster-touch-layout'), false, 'draft edits must not save early');
  await p.click('touch-layout-save'); p.advance(217);
  assert.equal(p.context.audioRunning, true);
  assert.equal(p.context.lastControls.jumpHeld, false);
  assert.equal(p.context.lastControls.jumpPressed, false);
  assert.equal(p.context.lastControls.fire, false);
  assert.equal(p.context.lastControls.boost, false);
  assert.equal(p.context.lastControls.aim, 1, 'editing the aim button must not turn the gun');
  const saved = p.storage.get('roadster-touch-layout');
  const restored = await page('en-US', { 'roadster-touch-layout': saved });
  for (const [id, size] of Object.entries(sizes)) {
    assert.equal(restored.ids.get(`touch-${id}`).style.width, `${size}px`);
    assert.equal(restored.ids.get(`touch-${id}`).style.left, p.ids.get(`touch-${id}`).style.left);
    assert.equal(restored.ids.get(`touch-${id}`).style.top, p.ids.get(`touch-${id}`).style.top);
  }
});

test('touch layout cancel and Escape discard edits; reset restores defaults and keeps a paused run paused', async () => {
  const saved = JSON.stringify({ version: 1, buttons: { jump: { x: .4, y: .6, size: 100 } } });
  const p = await page('en-US', { 'roadster-touch-layout': saved });
  const jump = p.ids.get('touch-jump');
  for (const cancel of ['touch-layout-cancel', 'Escape']) {
    await p.click('touch-layout-button');
    p.ids.get('touch-layout-size').value = '120'; p.ids.get('touch-layout-size').dispatch('input');
    if (cancel === 'Escape') p.key('Escape'); else await p.click(cancel);
    assert.equal(jump.style.width, '100px');
    assert.equal(p.storage.get('roadster-touch-layout'), saved);
    assert.equal(p.ids.get('overlay').classList.contains('is-visible'), true);
  }
  await p.click('primary-button'); p.key('KeyP');
  await p.click('touch-layout-button');
  await p.click('touch-layout-reset');
  assert.equal(jump.style.width, '76px');
  await p.click('touch-layout-save'); p.advance(17);
  assert.equal(p.context.audioRunning, false);
  assert.equal(JSON.parse(p.storage.get('roadster-touch-layout')).buttons.jump.size, 76);
});

test('touch placement stays within resized bounds, clamps saved values, and tolerates unavailable storage', async () => {
  const saved = JSON.stringify({ version: 1, buttons: {
    jump: { x: 10, y: -2, size: 999 }, fire: { x: 0, y: 1, size: 1 },
    aim: { x: 'bad', y: 1, size: 70 },
  } });
  const p = await page('en-US', { 'roadster-touch-layout': saved });
  const jump = p.ids.get('touch-jump');
  assert.equal(jump.style.width, '128px');
  assert.equal(jump.style.left, '660px');
  assert.equal(jump.style.top, '0px');
  assert.equal(p.ids.get('touch-fire').style.width, '44px');
  assert.equal(p.ids.get('touch-aim').style.width, '');
  p.resize(600, 280);
  assert.equal(jump.style.width, '128px');
  assert.equal(jump.style.left, '416px');
  await p.click('touch-layout-button');
  p.pointer('touch-jump', 'pointerdown', { clientX: 454, clientY: 144 });
  p.pointer('touch-jump', 'pointermove', { clientX: -1000, clientY: 2000 });
  assert.equal(jump.style.left, '0px');
  assert.equal(jump.style.top, '0px', 'a button as tall as the area cannot move outside it');
  p.pointer('touch-jump', 'pointercancel');
  p.resize(844, 390);
  assert.equal(jump.style.top, '110px');
  p.context.localStorage.setItem = () => { throw new Error('Storage disabled'); };
  await p.click('touch-layout-save');
  assert.equal(p.ids.get('touch-layout-editor').hidden, true);
  for (const corrupt of ['{', 'null', '{"version":2,"buttons":{}}']) {
    const restored = await page('en-US', { 'roadster-touch-layout': corrupt });
    assert.equal(restored.ids.get('touch-jump').style.width, '');
  }
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

test('earned loop XP allows a coin purchase, and the purchased weapon survives a reload', async () => {
  const p=await page('fa-IR', { 'roadster-progress': progressSave(1000) });
  assert.equal(p.ids.get('equip-twin-gun').disabled,true);
  await p.click('primary-button');
  p.context.snapshot.loopCompletions=1;p.advance(17);
  await p.click('armory-button');
  assert.equal(p.ids.get('equip-twin-gun').disabled,true,'25 XP must not unlock the twin gun');
  await p.click('armory-close');
  p.context.snapshot.loopCompletions=2;p.advance(77);
  await p.click('armory-button');
  assert.equal(p.ids.get('equip-twin-gun').disabled,true,'the doubled requirement is 100 XP');
  await p.click('armory-close');
  p.context.snapshot.loopCompletions=4;p.advance(137);
  await p.click('armory-button');
  assert.equal(p.ids.get('equip-twin-gun').disabled,false);
  await p.click('equip-twin-gun');
  assert.equal(p.storage.get('roadster-xp'),'100','buying must not spend XP');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,20,'four loops earned 20 coins before the 1000-coin purchase');
  assert.equal(p.context.snapshot.weapon.id,'twin-gun');
  const reloaded=await page('fa-IR',Object.fromEntries(p.storage));
  assert.equal(reloaded.context.snapshot.weapon.id,'twin-gun');
  assert.equal(reloaded.context.snapshot.weapon.ammo,100);
  assert.equal(reloaded.ids.get('equip-twin-gun').getAttribute('aria-pressed'),'true');
});

test('combat XP shows its source, persists, and never pays twice on restart', async () => {
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
  assert.equal(p.ids.get('equip-twin-gun').disabled,true,'50 XP is below the new requirement');
  await p.click('armory-close');
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
  const p = await page('fa-IR', { 'roadster-xp': '1900', 'roadster-progress': progressSave(0, weaponIds) });
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
  const locked = await page('en-US', { 'roadster-xp': '100', 'roadster-progress': progressSave(0, ['machine-gun','twin-gun']) });
  locked.key('Digit8');
  assert.equal(locked.context.snapshot.weapon.id, 'machine-gun');
  locked.key('Numpad2');
  assert.equal(locked.context.snapshot.weapon.id, 'twin-gun');
  const translated = await page('fa-IR', { 'roadster-xp': '1900', 'roadster-progress': progressSave(0, weaponIds) });
  translated.key('Unidentified', 'keydown', { key: '۸' });
  assert.equal(translated.context.snapshot.weapon.id, 'plasma-cannon');
  translated.key('Unidentified', 'keydown', { key: '٢' });
  assert.equal(translated.context.snapshot.weapon.id, 'twin-gun');
  const p = await page('en-US', { 'roadster-xp': '1900', 'roadster-progress': progressSave(0, weaponIds) });
  for (const fields of [{ctrlKey:true},{metaKey:true},{altKey:true},{repeat:true},
    {target:new p.context.HTMLElement('input')},{target:new p.context.HTMLElement('textarea')},
    {target:Object.assign(new p.context.HTMLElement('div'),{isContentEditable:true})}]) {
    p.key('Digit8', 'keydown', fields);
    assert.equal(p.context.snapshot.weapon.id, 'machine-gun');
  }
  p.key('Digit9'); p.key('Digit0');
  assert.equal(p.context.snapshot.weapon.id, 'machine-gun');
});

test('coin HUD awards distance, loops and destroyed police once and ignores obstacle-only XP', async () => {
  const p = await page('fa-IR');
  await p.click('primary-button');
  p.context.snapshot.distance = 199.9; p.advance(17);
  assert.equal(p.ids.get('coin-total').textContent, '۰');
  p.context.snapshot.distance = 200; p.context.snapshot.loopCompletions = 2; p.context.snapshot.policeDestroyed = 1;
  p.advance(77);
  assert.equal(p.ids.get('coin-total').textContent, '۳۰');
  assert.equal(p.ids.get('coin-toast').textContent, '+۳۰ سکه');
  p.context.snapshot.obstaclesDestroyed = 1; p.advance(137);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 30);
  p.context.snapshot.distance = 600; p.advance(197);
  assert.equal(p.ids.get('coin-total').textContent, '۵۰');
  p.advance(257);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 50);
  const reloaded = await page('fa-IR', Object.fromEntries(p.storage));
  assert.equal(reloaded.ids.get('coin-total').textContent, '۵۰');
});

test('armory purchases require XP and coins; number shortcuts only equip already purchased weapons', async () => {
  const p = await page('en-US', { 'roadster-xp': '99', 'roadster-progress': progressSave(1000) });
  assert.equal(p.ids.get('equip-twin-gun').disabled, true);
  assert.equal(p.ids.get('weapon-price-twin-gun').textContent, 'PRICE: 1,000 COINS');
  assert.equal(p.ids.get('weapon-unlock-twin-gun').textContent, 'REQUIRES 100 XP');
  p.key('Digit2');
  assert.equal(p.context.snapshot.weapon.id, 'machine-gun');
  await p.click('primary-button');
  p.context.snapshot.loopCompletions = 1; p.advance(17);
  await p.click('armory-button');
  assert.equal(p.ids.get('equip-twin-gun').disabled, false);
  assert.equal(p.ids.get('armory-coins').textContent, '1,005');
  p.key('Digit2');
  assert.equal(p.context.snapshot.weapon.id, 'machine-gun');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 1005);
  await p.click('equip-twin-gun');
  assert.equal(p.context.snapshot.weapon.id, 'twin-gun');
  assert.equal(p.ids.get('coin-total').textContent, '5');
  assert.equal(p.ids.get('armory-coins').textContent, '5');
  assert.equal(p.storage.get('roadster-xp'), '124');
  p.key('Digit1'); p.key('Digit2'); await p.click('equip-twin-gun');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 5);
  const restored = await page('en-US', Object.fromEntries(p.storage));
  assert.equal(restored.context.snapshot.weapon.id, 'twin-gun');
  assert.equal(restored.ids.get('weapon-price-twin-gun').textContent, 'OWNED');
  const poor = await page('en-US', { 'roadster-xp': '1900', 'roadster-progress': progressSave(999) });
  assert.equal(poor.ids.get('equip-twin-gun').disabled, true);
  assert.equal(poor.ids.get('weapon-unlock-twin-gun').textContent, 'NEED 1 MORE COINS');
  await poor.click('equip-twin-gun');
  assert.equal(poor.context.snapshot.weapon.id, 'machine-gun');
  assert.equal(JSON.parse(poor.storage.get('roadster-progress')).coins, 999);
});

test('new records open a medal form, persist before naming, block gameplay, and retain the name on reload', async () => {
  const p = await page('fa-IR', { 'roadster-best': '900', 'roadster-progress': progressSave(20) });
  assert.match(p.ids.get('best').innerHTML, /۰۹۰۰/);
  await p.click('primary-button');
  p.context.snapshot.distance = 2101; p.context.snapshot.loopCompletions = 1; p.context.snapshot.policeDestroyed = 1;
  p.context.snapshot.health = 25; p.context.impactNext = true; p.advance(17);
  assert.equal(p.ids.get('record-dialog').hidden, false);
  assert.equal(p.context.document.activeElement, p.ids.get('record-name'));
  assert.equal(p.ids.get('record-title').textContent, 'رکورد جدید!');
  assert.equal(p.ids.get('record-distance').textContent, '۲٬۱۰۱ متر');
  assert.equal(p.ids.get('record-bonus').textContent, 'پاداش رکورد: +۲۵ سکه');
  assert.equal(p.ids.get('coin-total').textContent, '۱۶۰');
  assert.equal(p.storage.get('roadster-best'), '2101');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).record.needsName, true);
  p.key('Tab', 'keydown', { shiftKey: true });
  assert.equal(p.context.document.activeElement, p.ids.get('record-save'));
  p.key('Tab');
  assert.equal(p.context.document.activeElement, p.ids.get('record-name'));
  p.key('KeyG'); p.key('Digit8'); p.key('Space'); p.advance(3017); await p.click('primary-button');
  assert.equal(p.ids.get('armory').hidden, true);
  assert.equal(p.context.snapshot.health, 0, 'the run must wait until its record is named');
  p.ids.get('record-name').value = '   '; p.ids.get('record-form').dispatch('submit');
  assert.equal(p.ids.get('record-name-error').hidden, false);
  const pending = await page('fa-IR', Object.fromEntries(p.storage));
  assert.equal(pending.ids.get('record-dialog').hidden, false);
  assert.equal(pending.ids.get('coin-total').textContent, '۱۶۰', 'recovering the pending form must not duplicate its bonus');
  pending.ids.get('record-name').value = '  آبل  '; pending.ids.get('record-form').dispatch('submit');
  assert.equal(pending.ids.get('record-dialog').hidden, true);
  assert.equal(pending.ids.get('best-player').textContent, 'آبل');
  const restored = await page('fa-IR', Object.fromEntries(pending.storage));
  assert.equal(restored.ids.get('record-dialog').hidden, true);
  assert.equal(restored.ids.get('best-player').textContent, 'آبل');
  assert.match(restored.ids.get('best').innerHTML, /۲٬۱۰۱/);
  assert.equal(restored.ids.get('coin-total').textContent, '۱۶۰');
  await restored.click('primary-button');
  restored.context.snapshot.distance = 1800; restored.context.snapshot.health = 25;
  restored.context.impactNext = true; restored.advance(17);
  assert.equal(restored.ids.get('record-dialog').hidden, true, 'a shorter run must not ask for a record name');
  assert.equal(JSON.parse(restored.storage.get('roadster-progress')).coins, 250, 'only nine distance milestones are paid for the shorter run');
});

test('five armory upgrades debit once, affect active ammo immediately, persist, and survive restarting', async () => {
  const p = await page('fa-IR', { 'roadster-xp':'100', 'roadster-weapon':'twin-gun',
    'roadster-progress':progressSave(50000, ['machine-gun','twin-gun']) });
  assert.equal(p.ids.get('weapon-upgrades-twin-gun').hidden, false);
  assert.equal(p.ids.get('weapon-upgrades-laser-gun').hidden, true);
  await p.click('primary-button');
  p.key('KeyF'); p.advance(17); p.key('KeyF','keyup');
  assert.equal(p.context.snapshot.weapon.ammo, 98);
  await p.click('armory-button');
  assert.match(p.ids.get('upgrade-twin-gun').textContent, /۱٬۵۰۰/);
  await p.click('upgrade-twin-gun');
  assert.equal(p.context.snapshot.weapon.level, 1);
  assert.equal(p.context.snapshot.weapon.capacity, 120);
  assert.equal(p.context.snapshot.weapon.ammo, 118);
  assert.equal(p.ids.get('weapon-ammo').textContent, '۱۱۸ / ۱۲۰');
  assert.equal(p.ids.get('ammo-meter').getAttribute('aria-valuemax'), '120');
  assert.match(p.ids.get('weapon-stats-twin-gun').textContent, /قدرت ۱٫۲/);
  assert.match(p.ids.get('weapon-upgrade-preview-twin-gun').textContent, /۱۴۰ گلوله/);
  assert.equal(p.ids.get('upgrade-step-twin-gun-0').classList.contains('is-filled'), true);
  assert.equal(p.ids.get('upgrade-step-twin-gun-1').classList.contains('is-filled'), false);
  for (let level=2; level<=5; level++) await p.click('upgrade-twin-gun');
  assert.equal(p.ids.get('weapon-level-twin-gun').textContent, 'ارتقا ۵ از ۵');
  assert.equal(p.ids.get('upgrade-twin-gun').disabled, true);
  assert.equal(p.ids.get('upgrade-twin-gun').textContent, 'ارتقای کامل');
  assert.equal(p.ids.get('weapon-upgrade-preview-twin-gun').hidden, true);
  assert.equal(p.context.snapshot.weapon.capacity, 200);
  assert.equal(p.context.snapshot.weapon.ammo, 198);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 30218);
  await p.click('upgrade-twin-gun');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 30218);
  p.key('Digit1'); p.key('Digit2');
  assert.equal(p.context.snapshot.weapon.ammo, 198);
  const restored = await page('fa-IR', Object.fromEntries(p.storage));
  assert.equal(restored.context.snapshot.weapon.level, 5);
  assert.equal(restored.context.snapshot.weapon.capacity, 200);
  assert.equal(restored.context.snapshot.weapon.ammo, 200);
  assert.equal(restored.ids.get('coin-total').textContent, '۳۰٬۲۱۸');
  await restored.click('primary-button');
  restored.context.snapshot.health=25; restored.context.impactNext=true; restored.advance(17);
  restored.advance(3017); await restored.click('primary-button');
  assert.equal(restored.context.snapshot.weapon.level, 5);
  assert.equal(restored.context.snapshot.weapon.ammo, 200);
});

test('upgrading an unequipped gun preserves the active loadout and requires enough coins and ownership', async () => {
  const p = await page('en-US', { 'roadster-xp':'100', 'roadster-progress':progressSave(1500, ['machine-gun','twin-gun']) });
  await p.click('primary-button');
  p.key('KeyF'); p.advance(17); p.key('KeyF','keyup');
  await p.click('armory-button');
  await p.click('upgrade-twin-gun');
  assert.equal(p.context.snapshot.weapon.id, 'machine-gun');
  assert.equal(p.context.snapshot.weapon.ammo, 79);
  assert.equal(p.ids.get('upgrade-twin-gun').disabled, true);
  assert.equal(p.ids.get('upgrade-machine-gun').disabled, true);
  assert.equal(p.ids.get('upgrade-cannon').disabled, true);
  assert.equal(p.ids.get('weapon-upgrades-cannon').hidden, true);
  await p.click('upgrade-twin-gun'); await p.click('upgrade-cannon');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 0);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).weaponUpgrades['twin-gun'], 1);
  p.key('Digit2');
  assert.equal(p.context.snapshot.weapon.level, 1);
  assert.equal(p.context.snapshot.weapon.ammo, 120);
  const starter = await page('en-US', { 'roadster-progress':progressSave(1500) });
  await starter.click('armory-button'); await starter.click('upgrade-machine-gun');
  assert.equal(starter.context.snapshot.weapon.level, 1);
  assert.equal(starter.ids.get('coin-total').textContent, '0');
  assert.equal(starter.context.snapshot.weapon.ammo, 96);
});
