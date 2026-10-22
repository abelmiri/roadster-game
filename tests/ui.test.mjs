import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { build } from 'esbuild';

let application;
const stubs = {
  physics: `import {VehicleWeapon} from ${JSON.stringify(path.resolve('src/game/weapons.ts'))};
  export const FIXED_STEP=1/120; export class GamePhysics {
    weapon=new VehicleWeapon();
    constructor(x,loadout){if(loadout)this.weapon.equip(loadout.id,loadout.xp);Object.assign(globalThis.snapshot,{health:100,impactSerial:0,invincibilityRemaining:0,crashed:false,loopCompletions:0,obstaclesDestroyed:0,policeDestroyed:0,runXp:0,weapon:this.weapon.snapshot()});globalThis.dead=false}
    get hazardStates(){return []} get chunks(){return new Map()} get distance(){return globalThis.snapshot.distance}
    get crashed(){return globalThis.dead} snapshot(){globalThis.snapshot.weapon=this.weapon.snapshot();return globalThis.snapshot} dispose(){}
    equipWeapon(id,xp){return this.weapon.equip(id,xp)} weaponAmmo(id){return this.weapon.ammoFor(id)}
    step(controls){globalThis.steps++;const s=globalThis.snapshot;
      this.weapon.step(1/120,controls,{...s.car,vx:14,vy:0},[],()=>{});
      if(globalThis.impactNext){globalThis.impactNext=false;s.health-=25;s.impactSerial++;s.invincibilityRemaining=1.5;if(s.health===0)globalThis.dead=s.crashed=true}
      else s.invincibilityRemaining=Math.max(0,s.invincibilityRemaining-1/120);
    }
  }`,
  visuals: `export class GameVisuals {render(s,p,dt,running,frozen){globalThis.lastRender={running,frozen,health:s.health}}}`,
  audio: `export class GameAudio {muted=false;unlock(){return Promise.resolve()} toggleMuted(){return this.muted=!this.muted}
    play(event){globalThis.sounds.push(event)} update(s,r){globalThis.audioRunning=r} suspend(){} reset(){} }`,
  rapier: 'export default {init:()=>Promise.resolve()}',
  css: '',
};
before(async () => {
  const result = await build({ entryPoints: [path.resolve('src/main.ts')], bundle: true, write: false,
    format: 'iife', platform: 'browser', plugins: [{ name: 'headless-ui', setup(builder) {
      builder.onResolve({ filter: /game\/(physics|visuals|audio)$/ }, ({ path: name }) => ({ path: name.split('/').at(-1), namespace: 'stub' }));
      builder.onResolve({ filter: /^@dimforge\/rapier2d-compat$/ }, () => ({ path: 'rapier', namespace: 'stub' }));
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path: name }) => ({ contents: stubs[name], loader: 'js', resolveDir: path.resolve() }));
    } }] });
  application = result.outputFiles[0].text;
});

async function page(language = 'en-US', saved = {}) {
  const nodes = [];
  const ids = new Map();
  const storage = new Map(Object.entries(saved));
  const windowEvents = new Map();
  class Element {
    constructor(tag, attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.dataset = {}; this.style = {}; this.events = new Map();
      this.classes = new Set((attrs.class ?? '').split(/\s+/)); this.textContent = ''; this.hidden = false;
      this.classList = {
        add: value => this.classes.add(value), remove: value => this.classes.delete(value),
        contains: value => this.classes.has(value),
        toggle: (value, on = !this.classes.has(value)) => on ? this.classes.add(value) : this.classes.delete(value),
      };
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
      if (attrs.id) ids.set(attrs.id, this);
      nodes.push(this);
    }
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
    document, HTMLElement: Element, window: { addEventListener(event, handler) {
      if (!windowEvents.has(event)) windowEvents.set(event, []); windowEvents.get(event).push(handler);
    } }, navigator: { language },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    performance: { now: () => context.now }, requestAnimationFrame: callback => { context.frame = callback; },
    console, Intl, now: 0, steps: 0, sounds: [], dead: false, impactNext: false,
    snapshot: { car: { x: 7, y: 1, angle: 0 }, wheels: [], distance: 0, speed: 14, boost: 1,
      grounded: true, suctionActive: false, boostActive: false, crashed: false, jumpSerial: 0, jumpsUsed: 0,
      landingSerial: 0, landingImpact: 0, loop: null, loopCompletions: 0, obstaclesDestroyed: 0, policeDestroyed: 0, runXp: 0, crashReason: 'road',
      police: { x: -23, y: 1, angle: 0, visibility: 0, pressure: 0, gap: 30 } },
  };
  vm.createContext(context);
  vm.runInContext(application, context);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  await settle();
  return {
    context, ids, storage,
    async click(id) { ids.get(id).dispatch('click'); await settle(); },
    key(code, event = 'keydown') { for (const handler of windowEvents.get(event) ?? []) handler({ code, repeat:false, preventDefault(){} }); },
    pointer(id, event) { ids.get(id).dispatch(event); },
    advance(now) { context.now = now; context.frame(now); },
  };
}

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
  assert.equal(p.context.steps, stoppedAt);
  assert.equal(p.context.snapshot.invincibilityRemaining, 1.5);
  assert.equal(p.context.sounds.filter(event => event === 'impact').length, 1);
  p.advance(534);
  assert.ok(p.context.steps > stoppedAt);
  assert.equal(p.context.lastRender.frozen, false);
  assert.match(p.ids.get('challenge-hint').textContent, /محافظت موقت/);
});

test('manual pause preserves the remaining impact freeze without catch-up on resume', async () => {
  const p = await page();
  await p.click('primary-button');
  p.context.impactNext = true; p.advance(17); p.advance(117);
  const stoppedAt = p.context.steps;
  await p.click('pause-button'); p.advance(10117);
  assert.equal(p.context.steps, stoppedAt);
  await p.click('primary-button'); p.advance(10417);
  assert.equal(p.context.steps, stoppedAt);
  assert.equal(p.context.lastRender.frozen, true);
  p.advance(10534);
  assert.ok(p.context.steps > stoppedAt && p.context.steps - stoppedAt <= 3);
});

test('fourth hit finishes its freeze before game over; restart restores health and clears feedback', async () => {
  const p = await page();
  await p.click('primary-button');
  p.context.snapshot.health = 25; p.context.snapshot.impactSerial = 3;
  p.context.impactNext = true; p.advance(17);
  const stoppedAt = p.context.steps;
  assert.equal(p.ids.get('health-value').textContent, '0%');
  assert.equal(p.ids.get('overlay').classList.contains('is-visible'), false);
  p.advance(516.9);
  assert.equal(p.ids.get('overlay').classList.contains('is-visible'), false);
  p.advance(517.1);
  assert.equal(p.context.steps, stoppedAt);
  assert.equal(p.ids.get('overlay').classList.contains('is-visible'), true);
  assert.match(p.ids.get('eyebrow').innerHTML, /CAR DESTROYED/);
  assert.equal(p.context.sounds.filter(event => event === 'impact').length, 1);
  assert.equal(p.context.sounds.filter(event => event === 'crash').length, 0, 'do not duplicate the fatal impact sound');
  await p.click('primary-button'); p.advance(535);
  assert.equal(p.ids.get('health-value').textContent, '100%');
  assert.equal(p.context.snapshot.impactSerial, 0);
  assert.equal(p.context.snapshot.invincibilityRemaining, 0);
  assert.equal(p.context.lastRender.frozen, false);
  assert.ok(p.context.steps > stoppedAt);
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
  await p.click('primary-button');p.advance(818);
  assert.equal(p.context.snapshot.obstaclesDestroyed,0);
  assert.equal(p.context.snapshot.policeDestroyed,0);
  assert.equal(p.storage.get('roadster-xp'),'50');
  p.context.snapshot.obstaclesDestroyed=1;p.advance(878);
  assert.equal(p.storage.get('roadster-xp'),'60','a new run may earn rewards from new targets');
});
