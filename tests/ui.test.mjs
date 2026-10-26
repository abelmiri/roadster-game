import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { build } from 'esbuild';

let application;
let developmentApplication;
const stubs = {
  physics: `import {VehicleWeapon} from ${JSON.stringify(path.resolve('src/game/weapons.ts'))};
  import {VehicleDamage} from ${JSON.stringify(path.resolve('src/game/damage.ts'))};
  export const FIXED_STEP=1/120; export class GamePhysics {
    weapon=new VehicleWeapon();
    damage=new VehicleDamage();
    constructor(x,loadout){globalThis.physicsVehicle=loadout?.vehicle??'roadster';this.weapon=new VehicleWeapon('machine-gun',loadout?.upgrades);this.damage=new VehicleDamage(loadout?.carUpgrades?.armor??0);if(loadout)this.weapon.equip(loadout.id,loadout.xp);Object.assign(globalThis.snapshot,{distance:0,health:this.damage.health,hullHealth:100,maxHealth:this.damage.maxHealth,armorMask:this.damage.armorMask,carUpgrades:loadout?.carUpgrades??{},impactSerial:0,invincibilityRemaining:0,crashed:false,wrecked:false,loopCompletions:0,obstaclesDestroyed:0,policeDestroyed:0,flipsCompleted:0,flipCoins:0,runXp:0,boxCoins:0,boxXp:0,boxRewardSerial:0,boxRewardEvents:[],shieldRemaining:0,unlimitedBoostRemaining:0,missionStats:undefined,weapon:this.weapon.snapshot()});globalThis.dead=false}
    get impactSerial(){return globalThis.snapshot.impactSerial}
    get explosionSerial(){return this.weapon.destructionSerial}
    stepWreck(){globalThis.wreckSteps++}
    get hazardStates(){return []} get chunks(){return new Map()} get distance(){return globalThis.snapshot.distance}
    get crashed(){return globalThis.dead} snapshot(alpha){globalThis.lastAlpha=alpha;globalThis.snapshot.weapon=this.weapon.snapshot();return globalThis.snapshot} dispose(){}
    selectVehicle(id){globalThis.physicsVehicle=id}
    equipWeapon(id,xp){return this.weapon.equip(id,xp)} weaponAmmo(id){return this.weapon.ammoFor(id)}
    upgradeWeapon(id,level){this.weapon.setUpgradeLevel(id,level)}
    upgradeCar(upgrades){const s=globalThis.snapshot;this.damage.upgradeArmor(upgrades.armor??0);Object.assign(s,{carUpgrades:upgrades,health:this.damage.health,hullHealth:this.damage.hullHealth,maxHealth:this.damage.maxHealth,armorMask:this.damage.armorMask})}
    step(controls){globalThis.steps++;globalThis.lastControls=controls;const s=globalThis.snapshot;
      this.weapon.step(1/120,controls,{...s.car,vx:14,vy:0},[],()=>{});
      if(globalThis.explosionNext){globalThis.explosionNext=false;this.weapon.destroySerial++}
      if(globalThis.impactNext){globalThis.impactNext=false;this.damage.armorMask=s.armorMask??0;this.damage.hullHealth=s.health-(this.damage.health-this.damage.hullHealth);this.damage.invincibilityRemaining=0;this.damage.hit();Object.assign(s,{health:this.damage.health,hullHealth:this.damage.hullHealth,armorMask:this.damage.armorMask});s.impactSerial++;s.invincibilityRemaining=1.5;if(s.health===0)globalThis.dead=s.crashed=s.wrecked=true}
      else s.invincibilityRemaining=Math.max(0,s.invincibilityRemaining-1/120);
    }
  }`,
  visuals: `export class GameVisuals {setVehicle(id){globalThis.vehicle=id} setPaint(id){globalThis.paint=id} render(s,p,dt,running,frozen,wallDelta){globalThis.lastRender={dt,running,frozen,wallDelta,health:s.health}}}`,
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
const progressSave = (coins = 0, ownedWeapons = ['machine-gun'], record = { distance: 0, name: '', needsName: false }, weaponUpgrades = {}, carUpgrades = {}) =>
  JSON.stringify({ version: 1, coins, ownedWeapons, weaponUpgrades, carUpgrades, record, playerName: record.name });

async function page(language = 'en-US', saved = {}, development = false, reducedMotion = false) {
  const nodes = [];
  const ids = new Map();
  const storage = new Map(Object.entries(saved));
  const windowEvents = new Map();
  class Element {
    constructor(tag, attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.dataset = {}; this.style = { setProperty(key,value){this[key]=value} }; this.events = new Map();
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
      if(this.attrs.id==='car-pane'&&selector==='button:not(:disabled)') return [...['roadster','samandster','tibaster','peugester'].map(id=>ids.get(`vehicle-${id}`)),...['white','blue','pink','red','black','purple','yellow','lime','silver','orange','teal','gold','burgundy'].map(id=>ids.get(`paint-${id}`)),...['armor','boost-reserve','boost-power'].map(id=>ids.get(`upgrade-car-${id}`))].filter(button=>button&&!button.disabled);
      if(this.attrs.id==='weapons-pane'&&selector==='button:not(:disabled)') return weaponIds.flatMap(id=>[ids.get(`equip-${id}`),ids.get(`upgrade-${id}`)]).filter(button=>!button.disabled);
      if (this.attrs.id === 'touch-controls' && selector === 'button') return ['fire', 'suction', 'aim', 'boost', 'front-jet', 'rear-jet', 'jump'].map(id => ids.get(`touch-${id}`));
      if (this.attrs.id === 'touch-layout-editor' && selector === 'select, input, button') return ['control', 'size', 'visibility', 'reset', 'cancel', 'save'].map(id => ids.get(`touch-layout-${id}`));
      return document.querySelectorAll(selector);
    }
    getBoundingClientRect() {
      if (this.hidden) return {left:0, top:0, width:0, height:0};
      const width = context.window.innerWidth - 56;
      const height = context.window.innerHeight - 152;
      if (this.attrs.id === 'touch-controls') return { left: 28, top: 134, width, height };
      const id = this.attrs.id?.replace(/^touch-/, '');
      const sizes = { jump: 76, fire: 54, boost: 60, aim: 44, suction: 60, 'front-jet': 48, 'rear-jet': 48 };
      if (!(id in sizes)) return { left: 0, top: 0, width: 0, height: 0 };
      const size = Number.parseFloat(this.style.width) || sizes[id];
      const left = this.classes.has('is-positioned') ? Number.parseFloat(this.style.left)
        : id === 'jump' ? width - size : id === 'boost' ? width - 90 - size : id === 'front-jet' ? width - 10 - size : id === 'rear-jet' ? width - 96 - size : id === 'aim' ? 69 : 0;
      const top = this.classes.has('is-positioned') ? Number.parseFloat(this.style.top)
        : height - size - (id === 'front-jet' ? 92 : id === 'rear-jet' ? 76 : id === 'fire' ? 69 : id === 'aim' ? 8 : 0);
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
    async purchase(id) {
      ids.get(id).dispatch('click'); await settle();
      if (!ids.get('purchase-dialog').hidden) { ids.get('purchase-confirm').dispatch('click'); await settle(); }
    },
    key(code, event = 'keydown', fields = {}) { for (const handler of windowEvents.get(event) ?? []) handler({ code, repeat:false, preventDefault(){}, ...fields }); },
    windowEvent(event) { for(const handler of windowEvents.get(event)??[])handler({}); },
    pointer(id, event, fields = {}) { ids.get(id).dispatch(event, fields); },
    resize(width, height) {
      context.window.innerWidth = width; context.window.innerHeight = height;
      for (const handler of windowEvents.get('resize') ?? []) handler({});
    },
    advance(now) { context.now = now; context.frame(now); },
  };
}

function shopState(p,id,state,badgeId) {
  const node=p.ids.get(id);
  assert.equal(node.getAttribute('data-shop-state'),state,`${id} must expose its current shop state`);
  for(const name of ['locked','available','owned','selected','complete']) {
    assert.equal(node.classList.contains(`is-shop-${name}`),name===state,`${id} must have exactly one shop state class`);
  }
  if(node.tagName==='BUTTON') assert.equal(node.disabled,state==='locked'||state==='complete');
  if(!badgeId) return '';
  assert.equal(p.ids.get(badgeId).getAttribute('data-shop-state'),state);
  const markup=p.ids.get(`${badgeId}-icon`).innerHTML??'';
  assert.match(markup,/<svg\b/,'shop status must include a visual icon');
  const label=p.ids.get(`${badgeId}-label`).textContent.trim();
  assert.ok(label.length>0,'shop status must also have a readable label');
  return label;
}

test('paid purchases show cost and specifications, cancel without payment and confirm exactly once', async () => {
  const p = await page('fa-IR', { 'roadster-progress': progressSave(20000), 'roadster-xp': '5000' });
  await p.click('armory-button'); await p.click('equip-twin-gun');
  assert.equal(p.ids.get('purchase-dialog').hidden, false);
  assert.equal(p.ids.get('armory').inert, true);
  assert.equal(p.context.document.activeElement, p.ids.get('purchase-cancel'));
  assert.equal(p.ids.get('purchase-name').textContent, 'مسلسل دولول');
  assert.match(p.ids.get('purchase-cost').textContent, /۱٬۰۰۰/);
  assert.equal(p.ids.get('purchase-remaining').textContent, '۱۹٬۰۰۰');
  assert.match(p.ids.get('purchase-after').textContent, /۱۰۰/);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 20000);
  p.key('Space'); p.key('KeyG'); p.key('Digit8'); p.advance(500);
  assert.equal(p.context.steps, 0); assert.equal(p.ids.get('purchase-dialog').hidden, false);
  p.ids.get('purchase-confirm').focus(); p.key('Tab');
  assert.equal(p.context.document.activeElement, p.ids.get('purchase-cancel'));
  p.key('Tab','keydown',{shiftKey:true});
  assert.equal(p.context.document.activeElement, p.ids.get('purchase-confirm'));
  await p.click('purchase-cancel');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 20000);
  assert.equal(p.context.document.activeElement, p.ids.get('equip-twin-gun'));
  await p.click('equip-twin-gun'); p.key('Escape');
  assert.equal(p.ids.get('purchase-dialog').hidden, true);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 20000);
  await p.click('equip-twin-gun'); await p.click('purchase-confirm'); await p.click('purchase-confirm');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 19000);
  assert.equal(p.context.snapshot.weapon.id, 'twin-gun');
  await p.click('upgrade-twin-gun');
  assert.match(p.ids.get('purchase-before').textContent, /قدرت ۱/);
  assert.match(p.ids.get('purchase-after').textContent, /قدرت ۱٫۲/);
  assert.equal(p.context.snapshot.weapon.level, 0);
  await p.click('purchase-confirm'); assert.equal(p.context.snapshot.weapon.level, 1);
  await p.click('armory-tab-car'); await p.click('upgrade-car-armor');
  assert.match(p.ids.get('purchase-before').textContent, /۱۰۰ سلامت/);
  assert.match(p.ids.get('purchase-after').textContent, /۱۲۵ سلامت/);
  assert.equal(p.context.snapshot.maxHealth, 100);
  await p.click('purchase-confirm'); assert.equal(p.context.snapshot.maxHealth, 125);
  await p.click('paint-red');
  assert.match(p.ids.get('purchase-cost').textContent, /۵۰/);
  assert.equal(p.context.paint, 'white');
  await p.click('purchase-confirm'); assert.equal(p.context.paint, 'red');
  const coins = JSON.parse(p.storage.get('roadster-progress')).coins;
  await p.click('paint-white'); await p.click('paint-red');
  assert.equal(p.ids.get('purchase-dialog').hidden, true);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, coins);
  assert.equal(p.storage.get('roadster-xp'), '5000');
});

test('shop states distinguish affordable purchases, selected and owned equipment, and update badges after payment and language changes', async () => {
  const p=await page('en-US',{'roadster-progress':progressSave(5000),'roadster-xp':'200'});
  await p.click('armory-button');
  shopState(p,'equip-machine-gun','selected','weapon-shop-machine-gun');
  const availableLabel=shopState(p,'equip-twin-gun','available','weapon-shop-twin-gun');
  const lockedLabel=shopState(p,'equip-gatling-gun','locked','weapon-shop-gatling-gun');
  assert.notEqual(availableLabel,lockedLabel);
  assert.equal(p.ids.get('equip-twin-gun').classList.contains('is-locked'),false,'an affordable unowned weapon must not look locked');
  assert.equal(p.ids.get('equip-gatling-gun').classList.contains('is-locked'),true);
  await p.purchase('equip-twin-gun');
  shopState(p,'equip-twin-gun','selected','weapon-shop-twin-gun');
  shopState(p,'equip-machine-gun','owned','weapon-shop-machine-gun');
  await p.click('equip-machine-gun');
  shopState(p,'equip-machine-gun','selected','weapon-shop-machine-gun');
  shopState(p,'equip-twin-gun','owned','weapon-shop-twin-gun');
  assert.equal(p.ids.get('purchase-dialog').hidden,true,'owned equipment selection must stay free');
  await p.click('armory-tab-car');
  shopState(p,'vehicle-roadster','selected','vehicle-shop-roadster');
  shopState(p,'vehicle-samandster','available','vehicle-shop-samandster');
  await p.click('vehicle-samandster'); await p.click('purchase-cancel');
  shopState(p,'vehicle-samandster','available','vehicle-shop-samandster');
  await p.purchase('vehicle-samandster');
  shopState(p,'vehicle-samandster','selected','vehicle-shop-samandster');
  shopState(p,'vehicle-roadster','owned','vehicle-shop-roadster');
  shopState(p,'paint-white','selected','paint-shop-white');
  shopState(p,'paint-blue','available','paint-shop-blue');
  await p.purchase('paint-blue');
  const selectedLabel=shopState(p,'paint-blue','selected','paint-shop-blue');
  shopState(p,'paint-white','owned','paint-shop-white');
  await p.click('paint-white');
  const ownedLabel=shopState(p,'paint-blue','owned','paint-shop-blue');
  assert.notEqual(ownedLabel,selectedLabel);
  const balance=JSON.parse(p.storage.get('roadster-progress')).coins;
  await p.click('language-button');
  const translated=shopState(p,'paint-blue','owned','paint-shop-blue');
  assert.notEqual(translated,ownedLabel); assert.match(translated,/\p{Script=Arabic}/u);
  shopState(p,'vehicle-samandster','selected','vehicle-shop-samandster');
  shopState(p,'equip-twin-gun','owned','weapon-shop-twin-gun');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,balance);
});

test('coin and level locks keep unavailable shop actions inert without dimming owned selections', async () => {
  const poor=await page('en-US',{'roadster-progress':progressSave(0),'roadster-xp':'5000'});
  await poor.click('armory-button');
  shopState(poor,'equip-machine-gun','selected','weapon-shop-machine-gun');
  shopState(poor,'equip-twin-gun','locked','weapon-shop-twin-gun');
  shopState(poor,'upgrade-machine-gun','locked','weapon-upgrade-shop-machine-gun');
  await poor.click('equip-twin-gun'); await poor.click('upgrade-machine-gun');
  await poor.click('armory-tab-car');
  shopState(poor,'vehicle-roadster','selected','vehicle-shop-roadster');
  shopState(poor,'vehicle-tibaster','locked','vehicle-shop-tibaster');
  shopState(poor,'paint-white','selected','paint-shop-white');
  shopState(poor,'paint-pink','locked','paint-shop-pink');
  shopState(poor,'upgrade-car-armor','locked','car-upgrade-shop-armor');
  for(const id of ['vehicle-tibaster','paint-pink','upgrade-car-armor']) await poor.click(id);
  assert.equal(poor.ids.get('purchase-dialog').hidden,true);
  assert.equal(poor.context.vehicle,'roadster'); assert.equal(poor.context.paint,'white');
  assert.equal(poor.context.snapshot.weapon.id,'machine-gun');
  assert.equal(JSON.parse(poor.storage.get('roadster-progress')).coins,0);
  const early=await page('en-US',{'roadster-progress':progressSave(50000)});
  await early.click('armory-button'); await early.click('armory-tab-car');
  for(const id of ['armor','boost-reserve','boost-power']) {
    shopState(early,`upgrade-car-${id}`,'locked',`car-upgrade-shop-${id}`);
    await early.click(`upgrade-car-${id}`);
  }
  assert.equal(early.ids.get('purchase-dialog').hidden,true);
  assert.equal(JSON.parse(early.storage.get('roadster-progress')).coins,50000);
});

test('owned upgrade stages remain distinct from a locked next stage and completed tracks stay complete with no coins', async () => {
  const save=progressSave(0,['machine-gun','twin-gun'],undefined,{'machine-gun':1,'twin-gun':5},{armor:1,'boost-reserve':4});
  const p=await page('en-US',{'roadster-progress':save,'roadster-xp':'10000'});
  await p.click('armory-button');
  shopState(p,'weapon-upgrades-machine-gun','owned');
  shopState(p,'upgrade-machine-gun','locked','weapon-upgrade-shop-machine-gun');
  assert.equal(p.ids.get('weapon-level-machine-gun').textContent,'OWNED 1 / 5');
  shopState(p,'weapon-upgrades-twin-gun','complete');
  shopState(p,'upgrade-twin-gun','complete','weapon-upgrade-shop-twin-gun');
  await p.click('upgrade-machine-gun'); await p.click('upgrade-twin-gun');
  await p.click('armory-tab-car');
  shopState(p,'car-upgrade-card-armor','owned');
  shopState(p,'upgrade-car-armor','locked','car-upgrade-shop-armor');
  assert.equal(p.ids.get('car-level-armor').textContent,'OWNED 1 / 4');
  shopState(p,'car-upgrade-card-boost-reserve','complete');
  shopState(p,'upgrade-car-boost-reserve','complete','car-upgrade-shop-boost-reserve');
  await p.click('upgrade-car-armor'); await p.click('upgrade-car-boost-reserve');
  assert.equal(p.ids.get('purchase-dialog').hidden,true);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,0);
  const imported=await page('en-US',{'roadster-progress':progressSave(50000,['machine-gun','twin-gun'])});
  await imported.click('armory-button');
  shopState(imported,'upgrade-twin-gun','locked','weapon-upgrade-shop-twin-gun');
  assert.match(imported.ids.get('upgrade-twin-gun').title,/Requires level 3/);
  await imported.click('upgrade-twin-gun');
  assert.equal(imported.ids.get('purchase-dialog').hidden,true);
});

test('unowned weapon cards show required player level before buying and update when XP reaches the threshold', async () => {
  const p=await page('fa-IR',{'roadster-xp':'100','roadster-progress':progressSave(10000)});
  await p.click('armory-button');
  const levels=[['twin-gun',3],['gatling-gun',6],['cannon',10],['rocket-launcher',15],['missile-launcher',21],['laser-gun',29],['plasma-cannon',39]];
  for(const [id,level] of levels) {
    const localized=String(level).replace(/\d/g,digit=>'۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
    const requirement=p.ids.get(`weapon-requirement-${id}`);
    assert.equal(requirement.hidden,false);
    assert.equal(requirement.textContent,`نیاز به سطح ${localized} · سطح تو: ۲`);
    assert.equal(requirement.classList.contains('is-met'),false);
    assert.match(p.ids.get(`equip-${id}`).getAttribute('aria-label'),new RegExp(requirement.textContent));
  }
  assert.equal(p.ids.get('weapon-requirement-machine-gun').hidden,true);
  assert.equal(p.ids.get('equip-twin-gun').disabled,true);
  await p.click('armory-close'); await p.click('primary-button');
  p.context.snapshot.loopCompletions=4; p.advance(17);
  await p.click('armory-button');
  assert.equal(p.ids.get('weapon-requirement-twin-gun').textContent,'نیاز به سطح ۳ · سطح تو: ۳');
  assert.equal(p.ids.get('weapon-requirement-twin-gun').hidden,false);
  assert.equal(p.ids.get('weapon-requirement-twin-gun').classList.contains('is-met'),true);
  assert.equal(p.ids.get('equip-twin-gun').disabled,false);
  await p.purchase('equip-twin-gun');
  assert.equal(p.ids.get('weapon-requirement-twin-gun').hidden,true);
  assert.equal(p.storage.get('roadster-xp'),'200','the level requirement must never spend XP');
  await p.click('language-button');
  assert.equal(p.ids.get('weapon-requirement-cannon').textContent,'Requires level 10 · Your level: 3');
});

test('mission board localizes all 100 goals, pauses gameplay, pays once and preserves history on reload', async () => {
  const p = await page('fa-IR', { 'roadster-best': '20000' });
  await p.click('menu-missions-button');
  assert.equal(p.ids.get('missions-dialog').hidden, false);
  assert.match(p.ids.get('missions-completed-count').textContent, /۰ از ۱۰۰/);
  assert.equal((p.ids.get('mission-catalog').innerHTML.match(/<article/g) ?? []).length, 100);
  await p.click('mission-tab-all'); assert.equal(p.ids.get('mission-pane-all').hidden, false);
  await p.click('missions-close'); await p.click('primary-button');
  p.context.snapshot.missionStats = { distance: 100, jumps: 2, boxesOpened: 0 };
  p.advance(17); p.key('KeyJ');
  const steps = p.context.steps;
  assert.equal(p.ids.get('missions-dialog').hidden, false);
  assert.equal(p.ids.get('mission-progress-1').textContent, '۲ / ۵');
  p.key('Space'); p.key('KeyG'); p.advance(2000);
  assert.equal(p.context.steps, steps, 'mission dialog did not pause driving');
  assert.equal(p.ids.get('armory').hidden, true);
  p.key('KeyJ');
  Object.assign(p.context.snapshot, { distance: 250, missionStats: { distance: 250, jumps: 5, boxesOpened: 1 } });
  p.advance(2017);
  assert.match(p.ids.get('missions-completed-count').textContent, /۳ از ۱۰۰/);
  assert.equal(p.ids.get('coin-total').textContent, '۱۴۵');
  assert.equal(p.ids.get('mission-toast').hidden, false);
  for (let now = 2034; now < 2200; now += 17) p.advance(now);
  assert.equal(p.ids.get('coin-total').textContent, '۱۴۵');
  await p.click('missions-button'); await p.click('mission-tab-history');
  assert.equal((p.ids.get('mission-history').innerHTML.match(/<article/g) ?? []).length, 3);
  const restored = await page('fa-IR', Object.fromEntries(p.storage));
  await restored.click('missions-button');
  assert.match(restored.ids.get('missions-completed-count').textContent, /۳ از ۱۰۰/);
  assert.match(restored.ids.get('missions-score').textContent, /۳۰/);
  assert.equal(restored.ids.get('coin-total').textContent, '۱۴۵');
  assert.equal(restored.ids.get('mission-history-empty').hidden, true);
});

test('the final roof impact awards its mission before finishing the run and a restart cannot repeat it', async () => {
  const save = JSON.parse(progressSave(0));
  save.missions = { active: ['roofHits-1','forwardFlips-1','backflips-1'].map(id => ({ id, progress:0,best:0 })) };
  const p = await page('en-US', { 'roadster-progress': JSON.stringify(save) });
  await p.click('primary-button');
  p.context.snapshot.missionStats = { roofHits: 1, distance: 0, boxesOpened: 0 };
  p.context.dead = p.context.snapshot.crashed = true; p.advance(17);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 35);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).missions.completed[0].id, 'roofHits-1');
  p.advance(3018); await p.click('primary-button'); p.advance(3035);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 35);
  assert.ok(JSON.parse(p.storage.get('roadster-progress')).missions.active.every(item => item.id !== 'roofHits-1'));
});

test('mission keyboard navigation keeps focus inside the board and preserves an underlying garage pause', async () => {
  const p = await page('en-US');
  await p.click('primary-button'); p.advance(17);
  await p.click('armory-button'); await p.click('armory-tab-car');
  await p.click('missions-button');
  assert.equal(p.ids.get('armory').hidden, false);
  assert.equal(p.ids.get('armory').inert, true);
  assert.equal(p.context.document.activeElement, p.ids.get('missions-close'));
  p.key('Tab', 'keydown', { shiftKey:true });
  assert.equal(p.context.document.activeElement, p.ids.get('mission-tab-active'));
  p.ids.get('mission-tab-active').dispatch('keydown', { code:'End' });
  assert.equal(p.ids.get('mission-pane-all').hidden, false);
  assert.equal(p.ids.get('mission-tab-all').getAttribute('aria-selected'), 'true');
  assert.equal(p.context.document.activeElement, p.ids.get('mission-tab-all'));
  p.key('Tab'); assert.equal(p.context.document.activeElement, p.ids.get('missions-close'));
  p.ids.get('mission-tab-all').dispatch('keydown', { code:'ArrowRight' });
  assert.equal(p.ids.get('mission-pane-active').hidden, false);
  p.ids.get('mission-tab-active').dispatch('keydown', { code:'ArrowLeft' });
  assert.equal(p.ids.get('mission-pane-all').hidden, false);
  p.ids.get('mission-tab-all').dispatch('keydown', { code:'Home' });
  assert.equal(p.ids.get('mission-pane-active').hidden, false);
  const steps = p.context.steps;
  p.key('Space'); p.key('KeyF'); p.advance(500);
  assert.equal(p.context.steps, steps);
  p.key('Escape');
  assert.equal(p.ids.get('missions-dialog').hidden, true);
  assert.equal(p.ids.get('armory').hidden, false);
  assert.equal(p.ids.get('armory').inert, false);
  assert.equal(p.context.document.activeElement, p.ids.get('missions-button'));
  p.advance(1000); assert.equal(p.context.steps, steps);
  await p.click('armory-close'); p.advance(1017);
  assert.ok(p.context.steps > steps);
  assert.equal(p.context.lastControls.fire, false, 'closing the board must discard controls pressed behind it');
});

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
  assert.equal(p.ids.get('health-meter').getAttribute('aria-label'), 'سلامت ماشین');
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
  const p = await page('en-US', { 'roadster-xp': '200', 'roadster-progress': progressSave(0, ['machine-gun', 'twin-gun']) });
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
  assert.equal(p.ids.get('primary-label').textContent, 'دوباره بزن بریم!');
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
  const p = await page('fa-IR', { 'roadster-xp':'500', 'roadster-progress': progressSave(2000) });
  assert.equal(p.ids.get('equip-gatling-gun').disabled, false);
  assert.equal(p.ids.get('equip-cannon').disabled, true);
  await p.click('armory-button');
  assert.equal(p.ids.get('armory').hidden, false);
  await p.purchase('equip-gatling-gun');
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
  await p.purchase('equip-machine-gun'); await p.purchase('equip-gatling-gun');
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
  const sizes = { jump: 98, fire: 87, boost: 103, aim: 63, suction: 72, 'front-jet': 65, 'rear-jet': 68 };
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

test('score, record, XP, coins and mobile control positions, sizes and visibility all survive reloading together', async () => {
  const p=await page('fa-IR',{'roadster-xp':'75','roadster-progress':progressSave(1000,['machine-gun'],{distance:2000,name:'آبل',needsName:false})});
  await p.click('primary-button');
  p.context.snapshot.distance=1534.8;
  p.context.snapshot.loopCompletions=1;
  p.advance(17);
  p.context.snapshot.distance=1539.6;
  p.advance(77);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).score,1534,'subsecond distance-only updates are buffered');
  await p.click('touch-layout-button');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).score,1539,'pausing must flush the newest score');
  const fire=p.ids.get('touch-fire').getBoundingClientRect();
  p.pointer('touch-fire','pointerdown',{clientX:fire.left+10,clientY:fire.top+10});
  p.pointer('touch-fire','pointermove',{clientX:350,clientY:230});
  p.pointer('touch-fire','pointerup');
  p.ids.get('touch-layout-size').value='88';p.ids.get('touch-layout-size').dispatch('input');
  p.ids.get('touch-layout-control').value='front-jet';p.ids.get('touch-layout-control').dispatch('change');
  await p.click('touch-layout-visibility');
  await p.click('touch-layout-save');
  const savedLayout=p.storage.get('roadster-touch-layout');
  const reloaded=await page('fa-IR',Object.fromEntries(p.storage));
  assert.match(reloaded.ids.get('distance').innerHTML,/۱٬۵۳۹/);
  assert.equal(reloaded.ids.get('distance-title').textContent,'مسافت دور قبل');
  assert.match(reloaded.ids.get('best').innerHTML,/۲٬۰۰۰/);
  assert.equal(reloaded.ids.get('best-player').textContent,'آبل');
  assert.equal(reloaded.ids.get('xp-total').textContent,'۲۵۰ XP');
  assert.equal(reloaded.ids.get('coin-total').textContent,'۱٬۱۷۵');
  for(const property of ['width','left','top'])assert.equal(reloaded.ids.get('touch-fire').style[property],p.ids.get('touch-fire').style[property]);
  assert.equal(reloaded.ids.get('touch-front-jet').hidden,true);
  reloaded.resize(568,320);
  assert.equal(reloaded.storage.get('roadster-touch-layout'),savedLayout,'orientation and size changes must preserve the saved layout');
  reloaded.advance(17);
  assert.equal(reloaded.storage.get('roadster-xp'),'250','showing the last score must not repay its distance XP');
  await reloaded.click('primary-button');
  assert.match(reloaded.ids.get('distance').innerHTML,/۰۰۰۰/);
  assert.equal(JSON.parse(reloaded.storage.get('roadster-progress')).score,0);
  assert.equal(reloaded.storage.get('roadster-xp'),'250');
  assert.equal(reloaded.storage.get('roadster-touch-layout'),savedLayout);
});

test('leaving the page flushes a score newer than the last rendered checkpoint', async () => {
  const p=await page('en-US');
  await p.click('primary-button');
  p.context.snapshot.distance=10.7;p.advance(17);
  p.context.snapshot.distance=19.5;p.advance(77);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).score,10);
  p.context.snapshot.distance=20.9;
  p.windowEvent('pagehide');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).score,20);
  const reloaded=await page('en-US',Object.fromEntries(p.storage));
  assert.match(reloaded.ids.get('distance').innerHTML,/0020/);
  assert.equal(reloaded.ids.get('distance-title').textContent,'LAST RUN');
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
  assert.equal(p.ids.get('equip-twin-gun').disabled,true,'50 XP is below the 200 XP requirement');
  await p.click('armory-close');
  p.context.snapshot.loopCompletions=4;p.advance(137);
  await p.click('armory-button');
  assert.equal(p.ids.get('equip-twin-gun').disabled,true,'the previous 100 XP threshold must remain locked');
  await p.click('armory-close');
  p.context.snapshot.loopCompletions=8;p.advance(197);
  await p.click('armory-button');
  assert.equal(p.ids.get('equip-twin-gun').disabled,false);
  await p.purchase('equip-twin-gun');
  assert.equal(p.storage.get('roadster-xp'),'200','buying must not spend XP');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,40,'eight loops earned 40 coins before the 1000-coin purchase');
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
  assert.match(p.ids.get('xp-toast').textContent,/مانع را از سر راه برداشتی.*۱۰ XP/);
  p.context.snapshot.policeDestroyed=1;p.context.snapshot.runXp=30;p.advance(77);
  assert.equal(p.storage.get('roadster-xp'),'30');
  assert.match(p.ids.get('xp-toast').textContent,/پلیس را از دور خارج کردی.*۲۰ XP/);
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
  const p = await page('fa-IR', { 'roadster-xp': '3800', 'roadster-progress': progressSave(0, weaponIds) });
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
  const locked = await page('en-US', { 'roadster-xp': '200', 'roadster-progress': progressSave(0, ['machine-gun','twin-gun']) });
  locked.key('Digit8');
  assert.equal(locked.context.snapshot.weapon.id, 'machine-gun');
  locked.key('Numpad2');
  assert.equal(locked.context.snapshot.weapon.id, 'twin-gun');
  const translated = await page('fa-IR', { 'roadster-xp': '3800', 'roadster-progress': progressSave(0, weaponIds) });
  translated.key('Unidentified', 'keydown', { key: '۸' });
  assert.equal(translated.context.snapshot.weapon.id, 'plasma-cannon');
  translated.key('Unidentified', 'keydown', { key: '٢' });
  assert.equal(translated.context.snapshot.weapon.id, 'twin-gun');
  const p = await page('en-US', { 'roadster-xp': '3800', 'roadster-progress': progressSave(0, weaponIds) });
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
  const p = await page('en-US', { 'roadster-xp': '199', 'roadster-progress': progressSave(1000) });
  assert.equal(p.ids.get('equip-twin-gun').disabled, true);
  assert.equal(p.ids.get('weapon-price-twin-gun').textContent, 'PRICE: 1,000 COINS');
  assert.equal(p.ids.get('weapon-unlock-twin-gun').textContent, 'REQUIRES 200 XP');
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
  await p.purchase('equip-twin-gun');
  assert.equal(p.context.snapshot.weapon.id, 'twin-gun');
  assert.equal(p.ids.get('coin-total').textContent, '5');
  assert.equal(p.ids.get('armory-coins').textContent, '5');
  assert.equal(p.storage.get('roadster-xp'), '224');
  p.key('Digit1'); p.key('Digit2'); await p.purchase('equip-twin-gun');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 5);
  const restored = await page('en-US', Object.fromEntries(p.storage));
  assert.equal(restored.context.snapshot.weapon.id, 'twin-gun');
  assert.equal(restored.ids.get('weapon-price-twin-gun').textContent, 'OWNED');
  const poor = await page('en-US', { 'roadster-xp': '3800', 'roadster-progress': progressSave(999) });
  assert.equal(poor.ids.get('equip-twin-gun').disabled, true);
  assert.equal(poor.ids.get('weapon-unlock-twin-gun').textContent, 'NEED 1 MORE COINS');
  await poor.purchase('equip-twin-gun');
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
  assert.equal(p.ids.get('coin-total').textContent, '۲۶۰');
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
  assert.equal(pending.ids.get('coin-total').textContent, '۲۶۰', 'recovering the pending form must not duplicate its bonus');
  pending.ids.get('record-name').value = '  آبل  '; pending.ids.get('record-form').dispatch('submit');
  assert.equal(pending.ids.get('record-dialog').hidden, true);
  assert.equal(pending.ids.get('best-player').textContent, 'آبل');
  const restored = await page('fa-IR', Object.fromEntries(pending.storage));
  assert.equal(restored.ids.get('record-dialog').hidden, true);
  assert.equal(restored.ids.get('best-player').textContent, 'آبل');
  assert.match(restored.ids.get('best').innerHTML, /۲٬۱۰۱/);
  assert.equal(restored.ids.get('coin-total').textContent, '۲۶۰');
  await restored.click('primary-button');
  restored.context.snapshot.distance = 1800; restored.context.snapshot.health = 25;
  restored.context.impactNext = true; restored.advance(17);
  assert.equal(restored.ids.get('record-dialog').hidden, true, 'a shorter run must not ask for a record name');
  assert.equal(JSON.parse(restored.storage.get('roadster-progress')).coins, 450, 'the shorter run earns 90 regular distance coins and its 100-coin milestone');
});

test('five armory upgrades debit once, affect active ammo immediately, persist, and survive restarting', async () => {
  const p = await page('fa-IR', { 'roadster-xp':'200', 'roadster-weapon':'twin-gun',
    'roadster-progress':progressSave(50000, ['machine-gun','twin-gun']) });
  assert.equal(p.ids.get('weapon-upgrades-twin-gun').hidden, false);
  assert.equal(p.ids.get('weapon-upgrades-laser-gun').hidden, true);
  await p.click('primary-button');
  p.key('KeyF'); p.advance(17); p.key('KeyF','keyup');
  assert.equal(p.context.snapshot.weapon.ammo, 98);
  await p.click('armory-button');
  assert.match(p.ids.get('upgrade-label-twin-gun').textContent, /۵۰۰/);
  shopState(p,'upgrade-twin-gun','available','weapon-upgrade-shop-twin-gun');
  shopState(p,'weapon-upgrades-twin-gun','available');
  await p.purchase('upgrade-twin-gun');
  assert.equal(p.context.snapshot.weapon.level, 1);
  assert.equal(p.context.snapshot.weapon.capacity, 120);
  assert.equal(p.context.snapshot.weapon.ammo, 118);
  assert.equal(p.ids.get('weapon-ammo').textContent, '۱۱۸ / ۱۲۰');
  assert.equal(p.ids.get('ammo-meter').getAttribute('aria-valuemax'), '120');
  assert.match(p.ids.get('weapon-stats-twin-gun').textContent, /قدرت ۱٫۲/);
  assert.match(p.ids.get('weapon-upgrade-preview-twin-gun').textContent, /۱۴۰ گلوله/);
  assert.equal(p.ids.get('upgrade-step-twin-gun-0').classList.contains('is-filled'), true);
  assert.equal(p.ids.get('upgrade-step-twin-gun-1').classList.contains('is-filled'), false);
  shopState(p,'weapon-upgrades-twin-gun','owned');
  shopState(p,'upgrade-twin-gun','available','weapon-upgrade-shop-twin-gun');
  for (let level=2; level<=5; level++) await p.purchase('upgrade-twin-gun');
  assert.equal(p.ids.get('weapon-level-twin-gun').textContent, 'خریداری‌شده: ۵ از ۵');
  assert.equal(p.ids.get('upgrade-twin-gun').disabled, true);
  assert.equal(p.ids.get('upgrade-label-twin-gun').textContent, 'ارتقای کامل');
  shopState(p,'weapon-upgrades-twin-gun','complete');
  shopState(p,'upgrade-twin-gun','complete','weapon-upgrade-shop-twin-gun');
  assert.equal(p.ids.get('weapon-upgrade-preview-twin-gun').hidden, true);
  assert.equal(p.context.snapshot.weapon.capacity, 200);
  assert.equal(p.context.snapshot.weapon.ammo, 198);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 45895);
  await p.purchase('upgrade-twin-gun');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 45895);
  p.key('Digit1'); p.key('Digit2');
  assert.equal(p.context.snapshot.weapon.ammo, 198);
  const restored = await page('fa-IR', Object.fromEntries(p.storage));
  assert.equal(restored.context.snapshot.weapon.level, 5);
  assert.equal(restored.context.snapshot.weapon.capacity, 200);
  assert.equal(restored.context.snapshot.weapon.ammo, 200);
  assert.equal(restored.ids.get('coin-total').textContent, '۴۵٬۸۹۵');
  await restored.click('primary-button');
  restored.context.snapshot.health=25; restored.context.impactNext=true; restored.advance(17);
  restored.advance(3017); await restored.click('primary-button');
  assert.equal(restored.context.snapshot.weapon.level, 5);
  assert.equal(restored.context.snapshot.weapon.ammo, 200);
});

test('upgrading an unequipped gun preserves the active loadout and requires enough coins and ownership', async () => {
  const p = await page('en-US', { 'roadster-xp':'200', 'roadster-progress':progressSave(500, ['machine-gun','twin-gun']) });
  await p.click('primary-button');
  p.key('KeyF'); p.advance(17); p.key('KeyF','keyup');
  await p.click('armory-button');
  await p.purchase('upgrade-twin-gun');
  assert.equal(p.context.snapshot.weapon.id, 'machine-gun');
  assert.equal(p.context.snapshot.weapon.ammo, 79);
  assert.equal(p.ids.get('upgrade-twin-gun').disabled, true);
  assert.equal(p.ids.get('upgrade-machine-gun').disabled, true);
  assert.equal(p.ids.get('upgrade-cannon').disabled, true);
  assert.equal(p.ids.get('weapon-upgrades-cannon').hidden, true);
  await p.purchase('upgrade-twin-gun'); await p.purchase('upgrade-cannon');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 0);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).weaponUpgrades['twin-gun'], 1);
  p.key('Digit2');
  assert.equal(p.context.snapshot.weapon.level, 1);
  assert.equal(p.context.snapshot.weapon.ammo, 120);
  const starter = await page('en-US', { 'roadster-progress':progressSave(500) });
  await starter.click('armory-button'); await starter.purchase('upgrade-machine-gun');
  assert.equal(starter.context.snapshot.weapon.level, 1);
  assert.equal(starter.ids.get('coin-total').textContent, '0');
  assert.equal(starter.context.snapshot.weapon.ammo, 96);
});

test('garage tabs charge for all four levels, update the HUD, and persist every upgrade',async()=>{
  const initial=JSON.parse(progressSave(100000));
  initial.ownedVehicles=['roadster','samandster','tibaster','peugester']; initial.ownedPaints=['blue'];
  const p=await page('fa-IR',{'roadster-xp':'19900','roadster-progress':JSON.stringify(initial)});
  assert.equal(p.ids.get('car-pane').hidden,true);
  await p.click('primary-button'); await p.click('armory-button');
  await p.click('armory-tab-car'); p.advance(17);
  assert.equal(p.context.audioRunning,false);
  assert.equal(p.ids.get('weapons-pane').hidden,true);
  assert.equal(p.ids.get('car-pane').hidden,false);
  assert.equal(p.ids.get('armory-tab-car').getAttribute('aria-selected'),'true');
  assert.equal(p.ids.get('armory-title').textContent,'گاراژ رودستر');
  assert.equal((p.ids.get('garage-car-preview').innerHTML.match(/<svg/g)??[]).length,1);
  assert.match(p.ids.get('upgrade-car-label-armor').textContent,/۴٬۰۰۰/);
  assert.match(p.ids.get('upgrade-car-label-boost-reserve').textContent,/۳٬۰۰۰/);
  for(const id of ['armor','boost-reserve','boost-power']) {
    shopState(p,`car-upgrade-card-${id}`,'available');
    shopState(p,`upgrade-car-${id}`,'available',`car-upgrade-shop-${id}`);
    for(let level=1;level<=4;level++) {
      await p.purchase(`upgrade-car-${id}`);
      shopState(p,`car-upgrade-card-${id}`,level<4?'owned':'complete');
      shopState(p,`upgrade-car-${id}`,level<4?'available':'complete',`car-upgrade-shop-${id}`);
    }
  }
  const saved=JSON.parse(p.storage.get('roadster-progress'));
  assert.deepEqual(saved.carUpgrades,{armor:4,'boost-reserve':4,'boost-power':4});
  assert.equal(saved.coins,18750);
  assert.equal(p.context.snapshot.maxHealth,200);
  assert.equal(p.context.snapshot.health,200);
  assert.equal(p.context.snapshot.armorMask,15);
  assert.equal(p.ids.get('health-meter').getAttribute('aria-valuemax'),'200');
  assert.equal(p.ids.get('health-meter').style['--health-segment'],'12.5%');
  assert.equal((p.ids.get('garage-car-preview').innerHTML.match(/data-armor-part=/g)??[]).length,4);
  for(const id of ['armor','boost-reserve','boost-power']) {
    assert.equal(p.ids.get(`upgrade-car-${id}`).disabled,true);
    assert.equal(p.ids.get(`car-next-${id}`).hidden,true);
    await p.purchase(`upgrade-car-${id}`);
  }
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,18750);
  for(const model of ['samandster','tibaster','peugester','roadster']) {
    await p.click(`vehicle-${model}`);
    for(const paint of ['blue','white']) {
      await p.click(`paint-${paint}`);
      assert.equal(p.ids.get('purchase-dialog').hidden,true);
      assert.equal(p.context.paint,paint); assert.equal(p.context.snapshot.maxHealth,200);
      assert.equal(p.context.snapshot.armorMask,15);
      assert.deepEqual(JSON.parse(JSON.stringify(p.context.snapshot.carUpgrades)),saved.carUpgrades);
      for(const id of ['armor','boost-reserve','boost-power']) assert.equal(p.ids.get(`upgrade-car-${id}`).disabled,true);
      assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,18750,'all purchased upgrade levels must follow every car and color');
    }
  }
  const restored=await page('fa-IR',Object.fromEntries(p.storage));
  assert.equal(restored.context.snapshot.health,200);
  assert.equal(restored.context.snapshot.armorMask,15);
  assert.deepEqual(JSON.parse(restored.storage.get('roadster-progress')).carUpgrades,saved.carUpgrades);
  p.key('Escape'); p.advance(34);
  assert.equal(p.context.audioRunning,true);
});

test('garage navigation traps focus in its visible tab and insufficient funds cannot buy upgrades',async()=>{
  const p=await page('en-US',{'roadster-xp':'2400','roadster-progress':progressSave(3999,['machine-gun','twin-gun'])});
  await p.click('armory-button');
  p.ids.get('armory-tab-weapons').dispatch('keydown',{code:'ArrowRight'});
  assert.equal(p.ids.get('car-pane').hidden,false);
  assert.equal(p.context.document.activeElement,p.ids.get('armory-tab-car'));
  assert.equal(p.ids.get('upgrade-car-armor').disabled,true);
  await p.purchase('upgrade-car-armor');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,3999);
  p.key('Digit2'); assert.equal(p.context.snapshot.weapon.id,'machine-gun','car tab must not activate hidden weapon shortcuts');
  await p.purchase('upgrade-car-boost-reserve');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,999);
  p.ids.get('paint-burgundy').focus(); p.key('Tab');
  assert.equal(p.context.document.activeElement,p.ids.get('armory-close'),'available paints remain reachable when upgrades are disabled');
  p.key('Tab','keydown',{shiftKey:true});
  assert.equal(p.context.document.activeElement,p.ids.get('paint-burgundy'));
  p.ids.get('armory-tab-car').dispatch('keydown',{code:'Home'});
  assert.equal(p.ids.get('weapons-pane').hidden,false);
  p.key('Digit2'); assert.equal(p.context.snapshot.weapon.id,'twin-gun');
});

test('the distance reward bar advances through every goal, shows earned coins, and resets for a new run',async()=>{
  const p=await page('fa-IR',{'roadster-best':'20000'});
  const bar=p.ids.get('distance-rewards');
  assert.equal(bar.classList.contains('is-celebrating'),false);
  assert.match(p.ids.get('distance-reward-next').textContent,/۱٬۵۰۰.*۱۰۰/);
  assert.equal(p.ids.get('distance-reward-fill').style.transform,'scaleX(0)');
  await p.click('primary-button');
  p.context.snapshot.distance=1499; p.advance(17);
  assert.equal(p.ids.get('coin-total').textContent,'۷۰');
  assert.equal(bar.classList.contains('is-celebrating'),false,'ordinary distance coins should not brighten the bar');
  p.context.snapshot.distance=1500; p.advance(77);
  assert.equal(bar.classList.contains('is-celebrating'),true);
  assert.equal(p.ids.get('coin-total').textContent,'۱۷۰');
  assert.equal(p.ids.get('xp-total').textContent,'۱۵۰ XP');
  assert.equal(p.storage.get('roadster-xp'),'150');
  assert.equal(p.ids.get('distance-reward-earned').textContent,'دریافتی این دور: ۱۷۰ سکه · ۱۵۰ XP');
  assert.match(p.ids.get('distance-reward-next').textContent,/۳٬۰۰۰.*۲۵۰/);
  assert.equal(p.ids.get('distance-reward-mark-0').classList.contains('is-reached'),true);
  assert.equal(p.ids.get('distance-reward-mark-1').classList.contains('is-reached'),false);
  assert.equal(p.ids.get('distance-reward-fill').style.transform,'scaleX(0.15)');
  assert.equal(p.ids.get('distance-reward-meter').getAttribute('aria-valuenow'),'1500');
  p.context.snapshot.distance=10000; p.advance(137);
  assert.equal(p.ids.get('coin-total').textContent,'۴٬۶۰۰');
  assert.equal(p.ids.get('xp-total').textContent,'۵٬۵۵۰ XP');
  assert.equal(p.ids.get('distance-reward-earned').textContent,'دریافتی این دور: ۴٬۶۰۰ سکه · ۵٬۵۵۰ XP');
  assert.equal(p.storage.get('roadster-xp'),'5550');
  assert.equal(p.ids.get('menu-coins').textContent,'۴٬۶۰۰');
  assert.equal(p.ids.get('distance-reward-fill').style.transform,'scaleX(1)');
  assert.equal(p.ids.get('distance-reward-next').textContent,'همهٔ جایزه‌های مسیر را گرفتی!');
  p.context.snapshot.distance=12000; p.advance(197);
  assert.equal(p.ids.get('distance-reward-meter').getAttribute('aria-valuenow'),'10000');
  assert.equal(p.ids.get('coin-total').textContent,'۴٬۷۰۰');
  p.advance(1936);
  assert.equal(bar.classList.contains('is-celebrating'),true);
  p.advance(1938);
  assert.equal(bar.classList.contains('is-celebrating'),false,'the highlight must fade after 1.8 seconds without replaying for the same milestone');
  p.context.snapshot.health=25; p.context.impactNext=true; p.advance(2257);
  p.advance(5257); await p.click('primary-button'); p.advance(5274);
  assert.equal(bar.classList.contains('is-celebrating'),false);
  assert.equal(p.ids.get('distance-reward-fill').style.transform,'scaleX(0)');
  assert.equal(p.ids.get('distance-reward-earned').textContent,'دریافتی این دور: ۰ سکه · ۰ XP');
  assert.equal(p.ids.get('coin-total').textContent,'۴٬۷۰۰');
});

test('menu balance opens a localized earning guide and an unavailable purchase tab without starting the game',async()=>{
  const p=await page('fa-IR',{'roadster-progress':progressSave(500)});
  assert.equal(p.ids.get('menu-coins').textContent,'۵۰۰');
  await p.click('menu-wallet-button');
  assert.equal(p.ids.get('coin-dialog').hidden,false);
  assert.equal(p.ids.get('overlay').inert,true);
  assert.equal(p.ids.get('coin-earn-pane').hidden,false);
  assert.equal(p.ids.get('coin-buy-pane').hidden,true);
  assert.equal(p.ids.get('coin-guide-balance').textContent,'۵۰۰');
  assert.equal(p.ids.get('coin-milestone-distance-0').textContent,'۱٬۵۰۰ متر');
  assert.equal(p.ids.get('coin-milestone-value-5').textContent,'+۱٬۵۰۰ سکه');
  assert.equal(p.ids.get('coin-milestone-xp-0').textContent,'+۱۵۰ XP');
  assert.equal(p.ids.get('coin-milestone-xp-5').textContent,'+۲٬۰۰۰ XP');
  p.ids.get('coin-tab-earn').dispatch('keydown',{code:'End'});
  assert.equal(p.ids.get('coin-buy-pane').hidden,false);
  assert.equal(p.ids.get('coin-earn-pane').hidden,true);
  assert.equal(p.ids.get('coin-buy-unavailable').textContent,'خرید سکه فعلاً فعال نیست');
  p.key('KeyG'); p.key('Space'); p.key('Digit8'); await p.click('primary-button'); p.advance(17);
  assert.equal(p.context.steps,0);
  assert.equal(p.ids.get('armory').hidden,true);
  p.ids.get('coin-back-earn').focus(); p.key('Tab');
  assert.equal(p.context.document.activeElement,p.ids.get('coin-guide-close'));
  p.key('Tab','keydown',{shiftKey:true});
  assert.equal(p.context.document.activeElement,p.ids.get('coin-back-earn'));
  await p.click('coin-back-earn');
  assert.equal(p.ids.get('coin-earn-pane').hidden,false);
  p.key('Escape');
  assert.equal(p.ids.get('coin-dialog').hidden,true);
  assert.equal(p.ids.get('overlay').inert,false);
  assert.equal(p.context.document.activeElement,p.ids.get('menu-wallet-button'));
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,500);
});

test('coin guide restores an underlying armory and pauses or resumes only the run that opened it',async()=>{
  const p=await page('en-US',{'roadster-progress':progressSave(500)});
  await p.click('primary-button'); p.key('KeyF'); p.advance(17);
  await p.click('armory-button'); await p.click('armory-wallet-button');
  assert.equal(p.ids.get('armory').inert,true);
  p.key('Escape'); p.advance(77);
  assert.equal(p.ids.get('coin-dialog').hidden,true);
  assert.equal(p.ids.get('armory').hidden,false);
  assert.equal(p.ids.get('armory').inert,false);
  assert.equal(p.context.audioRunning,false);
  p.key('Escape'); p.advance(94);
  assert.equal(p.context.audioRunning,true);
  assert.equal(p.context.lastControls.fire,false);
  await p.click('coin-wallet-button'); p.advance(154);
  assert.equal(p.context.audioRunning,false);
  await p.click('coin-guide-close'); p.advance(171);
  assert.equal(p.context.audioRunning,true);
  assert.equal(p.context.document.activeElement,p.ids.get('coin-wallet-button'));
});

test('the car tab buys and applies colors for 50 coins, persists selection and switches owned colors for free', async () => {
  const p = await page('fa-IR', { 'roadster-progress': progressSave(100), 'roadster-xp': '25' });
  await p.click('armory-button'); await p.click('armory-tab-car');
  assert.match(p.ids.get('paint-state-blue').textContent, /۵۰ سکه/);
  await p.purchase('paint-blue');
  assert.equal(p.context.paint, 'blue');
  assert.match(p.ids.get('garage-car-preview').innerHTML, /#3185f5/);
  assert.equal(p.ids.get('paint-blue').getAttribute('aria-pressed'), 'true');
  assert.equal(p.ids.get('coin-total').textContent, '۵۰');
  await p.purchase('paint-pink');
  assert.equal(p.ids.get('coin-total').textContent, '۰');
  assert.equal(p.ids.get('paint-red').disabled, true);
  await p.purchase('paint-red'); assert.equal(p.context.paint, 'pink');
  await p.purchase('paint-white'); await p.purchase('paint-blue');
  assert.equal(p.ids.get('coin-total').textContent, '۰');
  assert.equal(p.storage.get('roadster-xp'), '25');
  const restored = await page('fa-IR', Object.fromEntries(p.storage));
  assert.equal(restored.context.paint, 'blue');
  await restored.click('armory-button'); await restored.click('armory-tab-car');
  assert.equal(restored.ids.get('paint-pink').disabled, false);
  assert.equal(restored.ids.get('paint-state-blue').textContent, 'رنگ فعلی');
});

test('car purchases confirm 100 coins once and each car remembers its own color through restart and reload', async () => {
  const p = await page('fa-IR', { 'roadster-progress': progressSave(500, ['machine-gun'], undefined, {}, { armor:2 }) });
  assert.equal(p.context.vehicle, 'roadster'); assert.equal(p.context.physicsVehicle, 'roadster');
  await p.click('armory-button'); await p.click('armory-tab-car');
  const previews = ['roadster','samandster','tibaster','peugester'].map(id => p.ids.get(`vehicle-preview-${id}`).innerHTML);
  assert.equal(new Set(previews).size, 4);
  for(const [id,name] of [['samandster','سمندستر'],['tibaster','تیباستر'],['peugester','پژوستر']]) {
    assert.equal(p.ids.get(`vehicle-name-${id}`).textContent,name);
    assert.match(p.ids.get(`vehicle-state-${id}`).textContent,/۱۰۰/);
  }
  await p.click('vehicle-samandster');
  assert.equal(p.ids.get('purchase-dialog').hidden,false);
  assert.equal(p.ids.get('purchase-name').textContent,'سمندستر');
  assert.match(p.ids.get('purchase-cost').textContent,/۱۰۰/);
  assert.equal(p.ids.get('purchase-remaining').textContent,'۴۰۰');
  assert.match(p.ids.get('purchase-preview').innerHTML,/data-vehicle="samandster"/);
  assert.equal(p.context.vehicle,'roadster');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,500);
  await p.click('purchase-cancel');
  assert.equal(p.context.vehicle,'roadster'); assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,500);
  await p.click('vehicle-samandster'); await p.click('purchase-confirm'); await p.click('purchase-confirm');
  assert.equal(p.context.vehicle,'samandster'); assert.equal(p.context.physicsVehicle,'samandster');
  assert.equal(p.ids.get('garage-car-name').textContent,'سمندستر');
  assert.equal(p.ids.get('vehicle-samandster').getAttribute('aria-pressed'),'true');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,400);
  await p.purchase('paint-blue');
  assert.equal(p.context.paint,'blue'); assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,350);
  await p.purchase('vehicle-tibaster');
  assert.equal(p.context.vehicle,'tibaster'); assert.equal(p.context.physicsVehicle,'tibaster');
  assert.equal(p.context.paint,'white','a newly purchased model must start with its own white paint');
  assert.match(p.ids.get('garage-car-preview').innerHTML,/data-vehicle="tibaster"/);
  assert.match(p.ids.get('garage-car-preview').innerHTML,/#f3f4ee/);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,250);
  await p.click('paint-blue');
  assert.equal(p.context.paint,'blue'); assert.equal(p.ids.get('purchase-dialog').hidden,true);
  await p.click('paint-white');
  assert.equal(p.context.paint,'white'); assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,250);
  await p.purchase('vehicle-peugester');
  assert.equal(p.context.vehicle,'peugester'); assert.equal(p.context.paint,'white');
  await p.purchase('paint-pink');
  assert.equal(p.context.paint,'pink');
  assert.equal(p.ids.get('vehicle-peugester').getAttribute('aria-pressed'),'true');
  assert.equal(p.ids.get('vehicle-tibaster').getAttribute('aria-pressed'),'false');
  assert.match(p.ids.get('garage-car-preview').getAttribute('aria-label'),/پژوستر/);
  assert.match(p.ids.get('garage-car-preview').innerHTML,/data-vehicle="peugester"/);
  assert.equal((p.ids.get('garage-car-preview').innerHTML.match(/data-armor-part=/g)??[]).length,2);
  assert.match(p.ids.get('vehicle-preview-samandster').innerHTML,/#3185f5/);
  assert.match(p.ids.get('vehicle-preview-tibaster').innerHTML,/#f3f4ee/);
  const saved=JSON.parse(p.storage.get('roadster-progress'));
  assert.equal(saved.coins,100); assert.equal(saved.selectedVehicle,'peugester');
  for(const [id,paint] of Object.entries({roadster:'white',samandster:'blue',tibaster:'white',peugester:'pink'})) {
    assert.equal(saved.vehiclePaints[id]??'white',paint);
  }
  await p.click('armory-close'); await p.click('primary-button');
  p.context.dead=p.context.snapshot.crashed=true; p.advance(17);
  p.advance(3018); await p.click('primary-button');
  assert.equal(p.context.physicsVehicle,'peugester'); assert.equal(p.context.paint,'pink');
  assert.equal(p.context.snapshot.armorMask,3);
  const restored=await page('fa-IR',Object.fromEntries(p.storage));
  assert.equal(restored.context.vehicle,'peugester'); assert.equal(restored.context.physicsVehicle,'peugester');
  assert.equal(restored.context.paint,'pink');
  await restored.click('armory-button'); await restored.click('armory-tab-car');
  for(const [id,paint] of [['samandster','blue'],['tibaster','white'],['roadster','white'],['peugester','pink']]) {
    await restored.click(`vehicle-${id}`);
    assert.equal(restored.context.vehicle,id); assert.equal(restored.context.paint,paint);
    assert.equal(restored.ids.get('purchase-dialog').hidden,true,'owned model selection must not request another payment');
    assert.equal(restored.ids.get('coin-total').textContent,'۱۰۰');
    assert.equal(restored.context.snapshot.armorMask,3);
  }
});

test('insufficient coins cannot open a car purchase or change the equipped car', async () => {
  const p=await page('fa-IR',{'roadster-progress':progressSave(99)});
  await p.click('armory-button'); await p.click('armory-tab-car');
  for(const id of ['samandster','tibaster','peugester']) {
    assert.equal(p.ids.get(`vehicle-${id}`).disabled,true);
    await p.click(`vehicle-${id}`);
    assert.equal(p.ids.get('purchase-dialog').hidden,true);
    assert.equal(p.context.vehicle,'roadster'); assert.equal(p.context.physicsVehicle,'roadster');
    assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,99);
  }
});

test('box prizes update saved coins and XP once, show power timers, pause and clear on restart', async () => {
  const p = await page('fa-IR'); await p.click('primary-button');
  Object.assign(p.context.snapshot, { boxCoins: 270, boxXp: 850, boxRewardSerial: 3,
    boxRewardEvents: [{ serial: 3, reward: { kind: 'shield', seconds: 20 } }], shieldRemaining: 20, unlimitedBoostRemaining: 20, boost: .1 });
  p.advance(17);
  assert.equal(p.ids.get('coin-total').textContent, '۲۷۰');
  assert.equal(p.ids.get('xp-total').textContent, '۸۵۰ XP');
  assert.match(p.ids.get('box-toast').textContent, /شیلد روشن شد.*۲۰/);
  assert.equal(p.ids.get('boost-value').textContent, '∞');
  assert.equal(p.ids.get('touch-boost-value').textContent, '∞');
  assert.match(p.ids.get('shield-status').textContent, /۲۰ ثانیه/);
  assert.equal(p.ids.get('unlimited-boost-status').hidden, false);
  await p.click('pause-button'); p.advance(5000);
  assert.equal(p.ids.get('box-toast').hidden, false, 'pause spent the prize notification');
  assert.equal(p.ids.get('coin-total').textContent, '۲۷۰');
  assert.equal(p.storage.get('roadster-xp'), '850');
  await p.click('primary-button'); p.context.snapshot.shieldRemaining = 2.8; p.advance(5017);
  assert.equal(p.ids.get('shield-status').classList.contains('is-expiring'), true);
  p.context.dead = p.context.snapshot.crashed = true; p.advance(5034);
  p.advance(8040); await p.click('primary-button');
  assert.equal(p.ids.get('box-toast').hidden, true); assert.equal(p.ids.get('shield-status').hidden, true);
  assert.equal(p.ids.get('unlimited-boost-status').hidden, true);
  assert.equal(p.ids.get('coin-total').textContent, '۲۷۰');
  assert.equal(p.storage.get('roadster-xp'), '850');
});

test('car upgrades require the displayed player level and never spend XP when purchased',async()=>{
  const p=await page('fa-IR',{'roadster-xp':'4800','roadster-progress':progressSave(40000)});
  await p.click('armory-button'); await p.click('armory-tab-car');
  assert.equal(p.ids.get('upgrade-car-armor').disabled,true);
  shopState(p,'car-upgrade-card-armor','locked');
  shopState(p,'upgrade-car-armor','locked','car-upgrade-shop-armor');
  assert.equal(p.ids.get('car-requirement-armor').textContent,'از سطح ۵۰ باز می‌شود · سطح تو: ۴۹');
  await p.purchase('upgrade-car-armor');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,40000);
  await p.click('armory-close'); await p.click('primary-button');
  p.context.snapshot.loopCompletions=4; p.advance(17);
  await p.click('armory-button');
  assert.equal(p.ids.get('upgrade-car-armor').disabled,false);
  shopState(p,'upgrade-car-armor','available','car-upgrade-shop-armor');
  assert.equal(p.ids.get('car-requirement-armor').classList.contains('is-met'),true);
  await p.purchase('upgrade-car-armor');
  assert.equal(p.storage.get('roadster-xp'),'4900');
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins,36020);
  assert.equal(p.context.snapshot.maxHealth,125);
  assert.equal(p.ids.get('upgrade-car-armor').disabled,true);
  shopState(p,'car-upgrade-card-armor','owned');
  shopState(p,'upgrade-car-armor','locked','car-upgrade-shop-armor');
  assert.equal(p.ids.get('car-requirement-armor').textContent,'از سطح ۱۰۰ باز می‌شود · سطح تو: ۵۰');
  const restored=await page('fa-IR',Object.fromEntries(p.storage));
  assert.equal(restored.context.snapshot.armorMask,1);
  assert.equal(restored.context.snapshot.maxHealth,125);
  assert.equal(restored.storage.get('roadster-xp'),'4900');
});


test('the newest flip direction replaces the previous keyboard or touch hold, and releases clear input', async () => {
  const p = await page('en-US', {'roadster-touch-layout':JSON.stringify({version:1, buttons:{'rear-jet':{x:.8,y:.5,size:48,hidden:false}}})});
  await p.click('primary-button');
  p.key('KeyZ'); p.advance(17);
  assert.equal(p.context.lastControls.frontJet, true);
  assert.equal(p.context.lastControls.rearJet, false);
  p.key('KeyX'); p.advance(34);
  assert.equal(p.context.lastControls.frontJet, false);
  assert.equal(p.context.lastControls.rearJet, true);
  assert.equal(p.context.lastControls.boost, false, 'X must no longer trigger boost');
  p.key('ShiftLeft'); p.advance(51);
  assert.equal(p.context.lastControls.boost, true);
  p.key('KeyZ', 'keyup'); p.key('KeyX', 'keyup'); p.key('ShiftLeft', 'keyup');
  p.pointer('touch-front-jet', 'pointerdown', {pointerId:2});
  p.pointer('touch-rear-jet', 'pointerdown', {pointerId:3}); p.advance(68);
  assert.equal(p.context.lastControls.frontJet, false);
  assert.equal(p.context.lastControls.rearJet, true);
  assert.equal(p.ids.get('touch-front-jet').classList.contains('is-pressed'), false);
  assert.equal(p.ids.get('touch-rear-jet').classList.contains('is-pressed'), true);
  p.pointer('touch-front-jet', 'pointercancel', {pointerId:2});
  p.pointer('touch-rear-jet', 'lostpointercapture', {pointerId:3}); p.advance(85);
  assert.equal(p.context.lastControls.frontJet, false);
  assert.equal(p.context.lastControls.rearJet, false);
  p.key('KeyZ'); p.pointer('touch-rear-jet', 'pointerdown', {pointerId:4}); p.advance(102);
  assert.equal(p.context.lastControls.frontJet, false, 'touch must replace an opposite keyboard hold');
  assert.equal(p.context.lastControls.rearJet, true);
  p.pointer('touch-rear-jet', 'pointerup', {pointerId:4}); p.advance(119);
  assert.equal(p.context.lastControls.frontJet, false, 'releasing the new direction must not revive an old hold');
  assert.equal(p.context.lastControls.rearJet, false);
  p.key('KeyZ', 'keyup');
  p.key('KeyZ'); p.key('KeyG'); p.key('KeyX'); p.key('KeyG'); p.advance(136);
  assert.equal(p.context.lastControls.frontJet, false);
  assert.equal(p.context.lastControls.rearJet, false);
});

test('circular touch meters show localized ammunition and boost, and track firing without changing reserves', async () => {
  const p = await page('fa-IR');
  assert.equal(p.ids.get('touch-ammo-value').textContent,'۸۰');
  assert.equal(p.ids.get('touch-ammo-ring').getAttribute('stroke-dashoffset'),'0');
  assert.equal(p.ids.get('touch-boost-value').textContent,'۱۰۰٪');
  await p.click('primary-button');
  p.key('KeyF'); p.advance(17); p.key('KeyF','keyup');
  assert.equal(p.ids.get('touch-ammo-value').textContent,'۷۹');
  assert.ok(Math.abs(Number(p.ids.get('touch-ammo-ring').getAttribute('stroke-dashoffset'))-1.25)<1e-9);
  assert.match(p.ids.get('touch-fire').getAttribute('aria-label'),/شلیک.*۷۹ \/ ۸۰/);
  p.context.snapshot.boost=.4; p.advance(34);
  assert.equal(p.ids.get('touch-boost-value').textContent,'۴۰٪');
  assert.equal(p.ids.get('touch-boost-ring').getAttribute('stroke-dashoffset'),'60');
  assert.match(p.ids.get('touch-boost').getAttribute('aria-label'),/۴۰٪/);
  await p.click('language-button');
  assert.equal(p.ids.get('touch-ammo-value').textContent,'79');
  assert.equal(p.ids.get('touch-boost-value').textContent,'40%');
});

test('flip coins reach the wallet, toast and save once, and reset for the next run', async () => {
  const p = await page('en-US');
  await p.click('primary-button');
  p.context.snapshot.flipsCompleted = 3; p.context.snapshot.flipCoins = 45; p.advance(17);
  assert.equal(p.ids.get('coin-total').textContent, '45');
  assert.equal(p.ids.get('coin-toast').textContent, '+45 COINS');
  assert.equal(p.ids.get('coin-toast').hidden, false);
  assert.equal(JSON.parse(p.storage.get('roadster-progress')).coins, 45);
  p.advance(34);
  assert.equal(p.ids.get('coin-total').textContent, '45');
  await p.click('pause-button'); await p.click('coin-wallet-button');
  const description = p.context.document.querySelectorAll('[data-i18n]').find(node => node.dataset.i18n === 'coinFlipDescription');
  assert.match(description.textContent, /5 coins.*2 = 20.*3 = 45/);
  await p.click('coin-guide-close');
  await p.click('pause-button');
  p.context.snapshot.health=0; p.context.snapshot.crashed=true; p.context.dead=true;
  p.advance(51); p.advance(3052);
  p.key('Space'); p.advance(3069);
  p.context.snapshot.flipsCompleted=1; p.context.snapshot.flipCoins=5; p.advance(3086);
  assert.equal(p.ids.get('coin-total').textContent, '50');
});


test('mobile starts with one nozzle, and a hidden touch button leaves keyboard control available', async () => {
  const p = await page();
  assert.equal(p.ids.get('touch-front-jet').hidden, false);
  assert.equal(p.ids.get('touch-rear-jet').hidden, true);
  await p.click('primary-button');
  p.pointer('touch-rear-jet', 'pointerdown'); p.advance(17);
  assert.equal(p.context.lastControls.rearJet, false);
  p.key('KeyX'); p.advance(34);
  assert.equal(p.context.lastControls.rearJet, true);
  p.key('KeyX', 'keyup');
  await p.click('touch-layout-button');
  p.ids.get('touch-layout-control').value = 'rear-jet';
  p.ids.get('touch-layout-control').dispatch('change');
  assert.equal(p.ids.get('touch-rear-jet').hidden, false, 'hidden button must remain reachable in the editor');
  assert.equal(p.ids.get('touch-rear-jet').classList.contains('is-layout-hidden'), true);
  assert.equal(p.ids.get('touch-layout-visibility').getAttribute('aria-pressed'), 'false');
  await p.click('touch-layout-visibility');
  assert.equal(p.ids.get('touch-layout-visibility-status').textContent, 'Visible');
  await p.click('touch-layout-save');
  p.pointer('touch-rear-jet', 'pointerdown'); p.advance(51);
  assert.equal(p.context.lastControls.rearJet, true);
  assert.equal(JSON.parse(p.storage.get('roadster-touch-layout')).buttons['rear-jet'].hidden, false);
});

test('all mobile buttons can be hidden, persisted, resized while hidden, and individually recovered', async () => {
  const controls = ['jump','fire','boost','aim','suction','front-jet','rear-jet'];
  const p = await page('fa-IR');
  await p.click('touch-layout-button');
  for (const id of controls) {
    p.ids.get('touch-layout-control').value = id;
    p.ids.get('touch-layout-control').dispatch('change');
    if (p.ids.get('touch-layout-visibility').getAttribute('aria-pressed') === 'true') await p.click('touch-layout-visibility');
    assert.equal(p.ids.get('touch-layout-visibility-status').textContent, 'پنهان است');
    p.ids.get('touch-layout-size').value = '80'; p.ids.get('touch-layout-size').dispatch('input');
  }
  assert.equal(p.storage.has('roadster-touch-layout'), false);
  await p.click('touch-layout-save');
  for(const id of controls) assert.equal(p.ids.get(`touch-${id}`).hidden, true);
  const saved = p.storage.get('roadster-touch-layout');
  const restored = await page('fa-IR', {'roadster-touch-layout':saved});
  for(const id of controls) assert.equal(restored.ids.get(`touch-${id}`).hidden, true);
  restored.resize(740, 360);
  await restored.click('touch-layout-button');
  for(const id of controls) {
    assert.equal(restored.ids.get(`touch-${id}`).hidden, false);
    assert.equal(restored.ids.get(`touch-${id}`).style.width, '80px', 'measuring a hidden button must retain its size');
  }
  restored.ids.get('touch-layout-control').value = 'aim';
  restored.ids.get('touch-layout-control').dispatch('change');
  assert.equal(restored.ids.get('touch-layout-visibility').getAttribute('aria-controls'), 'touch-aim');
  restored.ids.get('touch-layout-size').value = '92'; restored.ids.get('touch-layout-size').dispatch('input');
  await restored.click('touch-layout-visibility'); await restored.click('touch-layout-save');
  for(const id of controls) assert.equal(restored.ids.get(`touch-${id}`).hidden, id !== 'aim');
  assert.equal(restored.ids.get('touch-aim').style.width, '92px');
  const again = await page('en-US', Object.fromEntries(restored.storage));
  assert.equal(again.ids.get('touch-aim').hidden, false);
  assert.equal(again.ids.get('touch-aim').style.width, '92px');
});

test('old layouts retain placement, cancel discards visibility edits, and reset restores the single-nozzle default', async () => {
  const saved = JSON.stringify({version:1,buttons:{jump:{x:.4,y:.6,size:100},'rear-jet':{x:.7,y:.5,size:64,hidden:false}}});
  const p = await page('en-US', {'roadster-touch-layout':saved});
  assert.equal(p.ids.get('touch-jump').style.width, '100px');
  assert.equal(p.ids.get('touch-jump').hidden, false);
  assert.equal(p.ids.get('touch-rear-jet').hidden, false);
  for (const cancel of ['touch-layout-cancel', 'Escape']) {
    await p.click('touch-layout-button');
    await p.click('touch-layout-visibility');
    assert.equal(p.ids.get('touch-layout-visibility').getAttribute('aria-pressed'), 'false');
    if(cancel === 'Escape') p.key('Escape'); else await p.click(cancel);
    assert.equal(p.ids.get('touch-jump').hidden, false);
    assert.equal(p.storage.get('roadster-touch-layout'), saved);
  }
  await p.click('touch-layout-button'); await p.click('touch-layout-visibility');
  await p.click('touch-layout-reset'); await p.click('touch-layout-save');
  assert.equal(p.ids.get('touch-jump').hidden, false);
  assert.equal(p.ids.get('touch-jump').style.width, '76px');
  assert.equal(p.ids.get('touch-rear-jet').hidden, true);
  assert.equal(p.ids.get('touch-front-jet').hidden, false);
});


test('distance XP is shown alongside coins, unlocks weapons, and persists without spending XP on purchases', async () => {
  const p = await page('en-US', {'roadster-xp':'50', 'roadster-progress':progressSave(1000)});
  assert.equal(p.ids.get('distance-reward-next').textContent, 'NEXT: 1,500 m · +100 COINS · +150 XP');
  assert.equal(p.ids.get('distance-reward-earned').textContent, 'THIS RUN: 0 COINS · 0 XP');
  await p.click('primary-button');
  p.context.snapshot.distance=1499; p.advance(17);
  assert.equal(p.storage.get('roadster-xp'), '50');
  assert.equal(p.ids.get('equip-twin-gun').disabled, true);
  p.context.snapshot.distance=1500; p.advance(77);
  assert.equal(p.storage.get('roadster-xp'), '200');
  assert.equal(p.ids.get('xp-total').textContent, '200 XP');
  assert.equal(p.ids.get('xp-level').textContent, 'LEVEL 3');
  assert.equal(p.ids.get('xp-toast').textContent, 'DISTANCE BONUS · +150 XP');
  assert.equal(p.ids.get('distance-reward-next').textContent, 'NEXT: 3,000 m · +250 COINS · +300 XP');
  assert.equal(p.ids.get('distance-reward-earned').textContent, 'THIS RUN: 170 COINS · 150 XP');
  assert.match(p.ids.get('distance-reward-meter').getAttribute('aria-valuetext'), /300 XP/);
  p.advance(137);
  assert.equal(p.storage.get('roadster-xp'), '200');
  await p.click('armory-button');
  assert.equal(p.ids.get('equip-twin-gun').disabled, false);
  await p.purchase('equip-twin-gun');
  assert.equal(p.context.snapshot.weapon.id, 'twin-gun');
  assert.equal(p.storage.get('roadster-xp'), '200');
  const restored = await page('en-US', Object.fromEntries(p.storage));
  assert.equal(restored.ids.get('xp-total').textContent, '200 XP');
  assert.equal(restored.context.snapshot.weapon.id, 'twin-gun');
  assert.equal(restored.ids.get('distance-reward-earned').textContent, 'THIS RUN: 0 COINS · 0 XP');
});

test('a goal reached on the fatal frame pays once, appears in the game-over total, and can pay in a new run', async () => {
  const p = await page('fa-IR', {'roadster-best':'20000'});
  await p.click('primary-button');
  p.context.snapshot.distance=1500; p.context.snapshot.health=25; p.context.impactNext=true;
  p.advance(17);
  assert.equal(p.storage.get('roadster-xp'), '150');
  assert.match(p.ids.get('overlay-description').textContent, /۱۵۰ XP/);
  assert.equal(p.ids.get('distance-reward-earned').textContent, 'دریافتی این دور: ۱۷۰ سکه · ۱۵۰ XP');
  p.context.snapshot.distance=10000; p.advance(77);
  assert.equal(p.storage.get('roadster-xp'), '150', 'wreck frames cannot award XP');
  p.advance(3017); await p.click('primary-button'); p.advance(3034);
  assert.equal(p.ids.get('distance-reward-earned').textContent, 'دریافتی این دور: ۰ سکه · ۰ XP');
  assert.equal(p.ids.get('xp-total').textContent, '۱۵۰ XP');
  p.context.snapshot.distance=1500; p.advance(3051);
  assert.equal(p.storage.get('roadster-xp'), '300');
  assert.equal(p.ids.get('distance-reward-earned').textContent, 'دریافتی این دور: ۱۷۰ سکه · ۱۵۰ XP');
});
