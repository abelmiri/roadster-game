import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let PlayerProgress, WEAPONS, WeaponLoadout, weaponUpgradeCost;
let CAR_UPGRADE_IDS, carUpgradeCost, carUpgradeRequiredLevel, carUpgradeStats;
let DISTANCE_COIN_REWARDS, distanceCoinProgress;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-economy-tests');
  await build({ entryPoints: ['src/game/playerProgress.ts', 'src/game/weapons.ts', 'src/game/carUpgrades.ts', 'src/game/coinRewards.ts'], bundle: true,
    platform: 'node', format: 'esm', outdir, outExtension: { '.js': '.mjs' } });
  ({ PlayerProgress } = await import(pathToFileURL(path.join(outdir, 'playerProgress.mjs')).href));
  ({ WEAPONS, WeaponLoadout, weaponUpgradeCost } = await import(pathToFileURL(path.join(outdir, 'weapons.mjs')).href));
  ({ CAR_UPGRADE_IDS, carUpgradeCost, carUpgradeRequiredLevel, carUpgradeStats } = await import(pathToFileURL(path.join(outdir, 'carUpgrades.mjs')).href));
  ({ DISTANCE_COIN_REWARDS, distanceCoinProgress } = await import(pathToFileURL(path.join(outdir, 'coinRewards.mjs')).href));
});
function store(coins = 0, extra = {}) {
  const values = new Map(Object.entries({ 'roadster-progress': JSON.stringify({ version: 1, coins, ownedWeapons: ['machine-gun'] }), ...extra }));
  const writes = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); writes.push([key, value]); } };
  return { values, writes, storage };
}

test('each 200 meters earns 10 coins, skipped milestones are retained, and reversing never pays twice', () => {
  const s = store(); const p = new PlayerProgress(s.storage);
  assert.equal(p.collect(199.99, 0, 0), 0);
  assert.equal(p.collect(200, 0, 0), 10);
  assert.equal(p.collect(399.99, 0, 0), 0);
  assert.equal(p.collect(1000, 0, 0), 40);
  assert.equal(p.collect(190, 0, 0), 0);
  assert.equal(p.collect(1000, 0, 0), 0);
  assert.equal(p.coins, 50);
  assert.equal(new PlayerProgress(s.storage).coins, 50);
});

test('loops pay 5 coins and destroyed patrols pay 10, once per cumulative counter', () => {
  const p = new PlayerProgress();
  assert.equal(p.collect(0, 1, 0), 5);
  assert.equal(p.collect(0, 1, 1), 10);
  assert.equal(p.collect(600, 4, 3), 65);
  assert.equal(p.collect(600, 4, 3), 0);
  assert.equal(p.collect(100, 1, 1), 0);
  assert.equal(p.collect(NaN, NaN, Infinity), 0);
  assert.equal(p.collect(800, -1, 3), 10, 'invalid counters must not discard valid distance rewards');
  assert.equal(p.runCoins, 90);
  p.finishRun(800);
  assert.equal(p.collect(1000, 5, 4), 0, 'wreck snapshots must never keep earning coins');
  p.resetRun();
  assert.equal(p.runCoins, 0);
  assert.equal(p.collect(200, 1, 1), 25);
  assert.equal(p.coins, 115);
});

test('record bonuses use one exclusive tier and are awarded only once for a strictly better completed run', () => {
  for (const [distance, bonus] of [[0,0],[1000,0],[1001,10],[2000,10],[2001,25],[5000,25]]) {
    const s = store(); const p = new PlayerProgress(s.storage);
    assert.deepEqual(p.finishRun(distance), { newRecord: distance > 0, bonus });
    assert.equal(p.coins, bonus);
    assert.equal(p.finishRun(distance + 1000).bonus, 0);
    const restored = new PlayerProgress(s.storage);
    assert.equal(restored.coins, bonus);
    assert.equal(restored.finishRun(distance).newRecord, false);
    restored.resetRun();
    assert.equal(restored.finishRun(distance - 1).bonus, 0);
  }
  const p = new PlayerProgress();
  assert.equal(p.finishRun(1500).bonus, 10);
  p.resetRun();
  assert.equal(p.finishRun(2500).bonus, 25);
  assert.equal(p.coins, 35);
});

test('cumulative flip coin rewards retain skipped combos, persist, and never pay twice or during a wreck', () => {
  const s = store(); const p = new PlayerProgress(s.storage);
  assert.equal(p.collect(0, 0, 0, 5), 5);
  assert.equal(p.collect(0, 0, 0, 20), 15, 'two flips pay a total of 20 coins');
  assert.equal(p.collect(0, 0, 0, 45), 25, 'three flips pay a total of 45 coins');
  assert.equal(p.collect(0, 0, 0, 80), 35, 'four flips pay a total of 80 coins');
  assert.equal(p.collect(0, 0, 0, 80), 0);
  assert.equal(p.collect(0, 0, 0, 20), 0);
  assert.equal(p.collect(200, 1, 1, NaN), 25);
  assert.equal(p.collect(200, 1, 1, 85), 5, 'a later single flip adds five coins');
  assert.equal(new PlayerProgress(s.storage).coins, 110);
  p.finishRun(200);
  assert.equal(p.collect(200, 1, 1, 100), 0);
  p.resetRun();
  assert.equal(p.collect(0, 0, 0, 5), 5);
  assert.equal(p.runCoins, 5);
  assert.equal(new PlayerProgress(s.storage).coins, 115);
});

test('record score persists before naming, a reload retains the pending form, and a name survives updates', () => {
  const s = store(30, { 'roadster-language': 'fa', 'roadster-best': '900' });
  const p = new PlayerProgress(s.storage);
  assert.equal(p.record.distance, 900);
  assert.equal(p.record.needsName, false, 'legacy records are retained without inventing their holder');
  assert.equal(p.finishRun(2100).bonus, 25);
  assert.equal(s.values.get('roadster-best'), '2100');
  const reloaded = new PlayerProgress(s.storage);
  assert.equal(reloaded.record.distance, 2100);
  assert.equal(reloaded.record.needsName, true);
  assert.equal(reloaded.nameRecord(' \n '), false);
  assert.equal(reloaded.nameRecord('  آبل\n  '), true);
  assert.deepEqual(new PlayerProgress(s.storage).record, { distance: 2100, name: 'آبل', needsName: false });
  assert.equal(new PlayerProgress(s.storage).playerName, 'آبل');
  assert.equal(new PlayerProgress(s.storage).coins, 55);
  assert.equal(s.values.get('roadster-language'), 'fa');
});

test('legacy best scores merge conservatively with a newer structured record', () => {
  const s = store(10, { 'roadster-best': '1200' });
  const p = new PlayerProgress(s.storage);
  p.finishRun(2001); p.nameRecord('Driver');
  s.values.set('roadster-best', '800');
  assert.equal(new PlayerProgress(s.storage).record.distance, 2001);
  s.values.set('roadster-best', '2400');
  assert.equal(new PlayerProgress(s.storage).record.distance, 2400);
  assert.equal(new PlayerProgress(s.storage).record.name, '');
});

test('purchases require both XP and coins, debit once, persist ownership atomically, and retain XP', () => {
  const s = store(28000); const p = new PlayerProgress(s.storage);
  assert.equal(p.purchaseWeapon('unknown', 9999), 'unknown');
  assert.equal(p.purchaseWeapon('machine-gun', 0), 'owned');
  for (const spec of WEAPONS.slice(1)) {
    const before = p.coins;
    assert.equal(p.purchaseWeapon(spec.id, spec.xp - 1), 'xp-locked');
    assert.equal(p.coins, before);
    const writes = s.writes.length;
    assert.equal(p.purchaseWeapon(spec.id, spec.xp), 'purchased');
    assert.equal(s.writes.length, writes + 1, 'the debit and ownership must be one save');
    const saved = JSON.parse(s.writes.at(-1)[1]);
    assert.equal(saved.coins, before - spec.price);
    assert.ok(saved.ownedWeapons.includes(spec.id));
    assert.equal(p.purchaseWeapon(spec.id, spec.xp), 'owned');
    assert.equal(p.coins, before - spec.price);
    assert.equal(new PlayerProgress(s.storage).ownsWeapon(spec.id), true);
  }
  assert.equal(p.coins, 0);
  p.resetRun();
  assert.equal(p.ownsWeapon('plasma-cannon'), true);
  assert.equal(new PlayerProgress().purchaseWeapon('twin-gun', 200), 'insufficient-coins');
});

test('XP and saved selection cannot bypass a purchase, while owned weapons can be equipped for free', () => {
  const s = store(1000, { 'roadster-weapon': 'plasma-cannon' });
  const p = new PlayerProgress(s.storage);
  const loadout = new WeaponLoadout(3800, s.storage, id => p.ownsWeapon(id));
  assert.equal(loadout.selected, 'machine-gun');
  assert.equal(loadout.select('twin-gun', 3800), false);
  assert.equal(p.coins, 1000);
  p.purchaseWeapon('twin-gun', 200);
  assert.equal(loadout.select('twin-gun', 200), true);
  assert.equal(loadout.select('twin-gun', 200), true);
  assert.equal(p.coins, 0);
  const restored = new PlayerProgress(s.storage);
  assert.equal(new WeaponLoadout(200, s.storage, id => restored.ownsWeapon(id)).selected, 'twin-gun');
});

test('invalid or unavailable storage preserves safe defaults and session progress', () => {
  for (const raw of ['{', 'null', '{"version":2}', '{"version":1,"coins":-1,"record":{"distance":"bad"}}']) {
    const s = store(0, { 'roadster-progress': raw, 'roadster-best': '777' });
    const p = new PlayerProgress(s.storage);
    assert.equal(p.coins, 0); assert.equal(p.record.distance, 777);
    assert.equal(p.ownsWeapon('machine-gun'), true);
  }
  const p = new PlayerProgress({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  assert.equal(p.collect(20000, 0, 0), 5100);
  assert.equal(p.purchaseWeapon('twin-gun', 200), 'purchased');
  assert.equal(p.coins, 4100);
  assert.equal(p.finishRun(20001).bonus, 25);
  assert.equal(p.nameRecord('Driver'), true);
});

test('each owned weapon has exactly five paid upgrade levels saved with one atomic coin debit', () => {
  const s = store(1000000); const p = new PlayerProgress(s.storage);
  for (const spec of WEAPONS) {
    if (spec.price) p.purchaseWeapon(spec.id, spec.xp);
    for (let level = 0; level < 5; level++) {
      const coins = p.coins; const writes = s.writes.length;
      assert.equal(p.weaponLevel(spec.id), level);
      const price = weaponUpgradeCost(spec.id, level);
      assert.equal(p.upgradeWeapon(spec.id), 'upgraded');
      assert.equal(p.coins, coins - price);
      assert.equal(s.writes.length, writes + 1);
      const saved = JSON.parse(s.writes.at(-1)[1]);
      assert.equal(saved.coins, coins - price);
      assert.equal(saved.weaponUpgrades[spec.id], level + 1);
      assert.equal(new PlayerProgress(s.storage).weaponLevel(spec.id), level + 1);
    }
    const coins = p.coins;
    assert.equal(p.upgradeWeapon(spec.id), 'max-level');
    assert.equal(p.coins, coins);
  }
  const copy = p.weaponUpgrades; copy['machine-gun'] = 0;
  assert.equal(p.weaponLevel('machine-gun'), 5, 'an exported loadout cannot mutate stored levels');
  p.resetRun();
  assert.equal(p.weaponLevel('plasma-cannon'), 5);
});

test('unowned weapons and insufficient balances cannot be upgraded or charged', () => {
  const s = store(499); const p = new PlayerProgress(s.storage);
  assert.equal(p.upgradeWeapon('unknown'), 'unknown');
  assert.equal(p.upgradeWeapon('twin-gun'), 'unowned');
  assert.equal(p.upgradeWeapon('machine-gun'), 'insufficient-coins');
  assert.equal(p.weaponLevel('machine-gun'), 0);
  assert.equal(p.weaponLevel('__proto__'), 0);
  assert.equal(p.coins, 499);
  assert.equal(s.writes.length, 0);
  p.collect(200, 0, 0);
  assert.equal(p.upgradeWeapon('machine-gun'), 'upgraded');
  assert.equal(p.coins, 9);
  assert.equal(p.upgradeWeapon('machine-gun'), 'insufficient-coins');
  assert.equal(p.weaponLevel('machine-gun'), 1);
});

test('old saves retain their wallet and record; corrupt and unowned upgrade levels are ignored', () => {
  const s = store(3000); const old = new PlayerProgress(s.storage);
  assert.equal(old.weaponLevel('machine-gun'), 0);
  assert.equal(old.coins, 3000);
  for (const bad of [-1, 6, 1.5, '3', null, {}]) {
    s.values.set('roadster-progress', JSON.stringify({ version: 1, coins: 3000,
      ownedWeapons: ['machine-gun'], weaponUpgrades: { 'machine-gun': bad, 'twin-gun': 5 },
      record: { distance: 1234, name: 'Driver', needsName: false } }));
    const p = new PlayerProgress(s.storage);
    assert.equal(p.weaponLevel('machine-gun'), 0);
    assert.equal(p.weaponLevel('twin-gun'), 0);
    assert.equal(p.coins, 3000);
    assert.equal(p.record.name, 'Driver');
    p.purchaseWeapon('twin-gun', 200);
    assert.equal(p.weaponLevel('twin-gun'), 0);
  }
  const blocked = new PlayerProgress({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  blocked.collect(30000, 0, 0);
  assert.equal(blocked.upgradeWeapon('machine-gun'), 'upgraded');
  assert.equal(blocked.coins, 5100);
});

test('car upgrades have four exact price steps, debit atomically and persist independently', () => {
  assert.deepEqual([0,1,2,3].map(level=>carUpgradeCost('armor',level)),[4000,6000,9000,13500]);
  assert.deepEqual([0,1,2,3].map(level=>carUpgradeCost('boost-reserve',level)),[3000,4500,6750,10125]);
  const s=store(100000); const p=new PlayerProgress(s.storage);
  for(const id of CAR_UPGRADE_IDS) {
    for(let level=0;level<4;level++) {
      const coins=p.coins; const writes=s.writes.length;
      assert.equal(p.upgradeCar(id,200),'upgraded');
      assert.equal(s.writes.length,writes+1);
      const saved=JSON.parse(s.values.get('roadster-progress'));
      assert.equal(saved.coins,coins-carUpgradeCost(id,level));
      assert.equal(saved.carUpgrades[id],level+1);
      assert.equal(new PlayerProgress(s.storage).carLevel(id),level+1);
    }
    const coins=p.coins;
    assert.equal(p.upgradeCar(id),'max-level');
    assert.equal(p.coins,coins);
  }
  assert.deepEqual(carUpgradeStats(p.carUpgrades),{armor:4,maxHealth:200,boostCapacity:2,boostPower:1.8});
  assert.equal(p.upgradeCar('unknown'),'unknown');
  const copy=p.carUpgrades; copy.armor=0;
  assert.equal(p.carLevel('armor'),4);
  p.resetRun(); assert.equal(p.carLevel('armor'),4);
});

test('insufficient funds and corrupt vehicle levels cannot consume coins or reset older progress', () => {
  const s=store(3999); const p=new PlayerProgress(s.storage);
  assert.equal(p.upgradeCar('armor',50),'insufficient-coins');
  assert.equal(p.coins,3999); assert.equal(p.carLevel('armor'),0);
  assert.equal(s.writes.length,0);
  for(const invalid of [-1,5,2.5,'4',null,{}]) {
    s.values.set('roadster-progress',JSON.stringify({version:1,coins:9000,ownedWeapons:['machine-gun','twin-gun'],
      weaponUpgrades:{'twin-gun':3},carUpgrades:{armor:invalid,'boost-power':2},record:{distance:2000,name:'Driver',needsName:false}}));
    const restored=new PlayerProgress(s.storage);
    assert.equal(restored.carLevel('armor'),0);
    assert.equal(restored.carLevel('boost-power'),2);
    assert.equal(restored.weaponLevel('twin-gun'),3);
    assert.equal(restored.record.name,'Driver');
    assert.equal(restored.coins,9000);
  }
});

test('all six distance bonuses pay their full value once per run, retain skipped goals, and reset cleanly',()=>{
  assert.deepEqual(DISTANCE_COIN_REWARDS.map(reward=>[reward.distance,reward.coins]),[[1500,100],[3000,250],[4500,500],[6000,750],[7500,1000],[10000,1500]]);
  const s=store(); const p=new PlayerProgress(s.storage);
  const increments=[170,330,570,830,1070,1630];
  for(const [index,reward] of DISTANCE_COIN_REWARDS.entries()) {
    assert.equal(p.collect(reward.distance,0,0),increments[index],'the goal bonus is in addition to regular 200m rewards');
    assert.equal(p.collect(reward.distance,0,0),0);
    assert.equal(p.collect(reward.distance-1,0,0),0);
  }
  assert.equal(p.runCoins,4600);
  assert.equal(new PlayerProgress(s.storage).coins,4600);
  p.resetRun();
  assert.equal(p.collect(10000,0,0),4600,'a skipped display interval must retain all six bonuses');
  assert.equal(p.collect(10000,0,0),0);
  assert.equal(p.coins,9200);
  p.finishRun(10000);
  assert.equal(p.collect(12000,1,1),0,'a wreck cannot keep earning rewards');
  const boundary=new PlayerProgress();
  assert.equal(boundary.collect(1499.99,0,0),70);
  assert.equal(boundary.collect(1500,0,0),100);
  assert.equal(boundary.collect(Infinity,NaN,NaN),0);
});

test('the distance bar handles its next goal, completed route and invalid values',()=>{
  assert.equal(distanceCoinProgress(0).next.distance,1500);
  const first=distanceCoinProgress(1500);
  assert.equal(first.fraction,.15); assert.equal(first.next.distance,3000); assert.equal(first.next.coins,250);
  assert.equal(distanceCoinProgress(9999).next.coins,1500);
  assert.deepEqual(distanceCoinProgress(12000),{distance:12000,fraction:1,next:null});
  assert.equal(distanceCoinProgress(NaN).fraction,0);
  assert.equal(distanceCoinProgress(-100).distance,0);
});

test('vehicle XP level gates apply at every stage without spending XP or removing prior purchases',()=>{
  assert.deepEqual([0,1,2,3].map(level=>carUpgradeRequiredLevel('armor',level)),[50,100,150,200]);
  for(const id of ['boost-reserve','boost-power']) assert.deepEqual([0,1,2,3].map(level=>carUpgradeRequiredLevel(id,level)),[25,50,75,100]);
  const s=store(100000,{'roadster-xp':'19900'}); const p=new PlayerProgress(s.storage);
  for(const id of CAR_UPGRADE_IDS)for(let level=0;level<4;level++) {
    const required=carUpgradeRequiredLevel(id,level); const coins=p.coins;
    assert.equal(p.upgradeCar(id,required-1),'xp-locked');
    assert.equal(p.carLevel(id),level); assert.equal(p.coins,coins);
    assert.equal(p.upgradeCar(id,required),'upgraded');
    assert.equal(s.values.get('roadster-xp'),'19900');
  }
  const fresh=new PlayerProgress(store(10000).storage);
  for(const bad of [NaN,Infinity,49,49.5])assert.equal(fresh.upgradeCar('armor',bad),'xp-locked');
  assert.equal(fresh.upgradeCar('armor'),'xp-locked','an omitted level cannot bypass the gate');
  const existing=store(90000,{'roadster-progress':JSON.stringify({version:1,coins:90000,carUpgrades:{armor:3}})});
  const restored=new PlayerProgress(existing.storage);
  assert.equal(restored.carLevel('armor'),3);
  assert.equal(restored.upgradeCar('armor',1),'xp-locked');
  assert.equal(restored.carLevel('armor'),3,'previous purchases must be retained after adding level gates');
});
