import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import RAPIER from '@dimforge/rapier2d-compat';

let MISSIONS, MissionProgress, PlayerProgress, RunMissionTracker, emptyMissionStats;
let purchaseQuote, confirmPurchase, GamePhysics, roadHeight;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-mission-tests');
  const entries = ['missions', 'missionStats', 'playerProgress', 'purchases', 'physics', 'track'];
  await build({ entryPoints: entries.map(name => `src/game/${name}.ts`), bundle: true, platform: 'node', format: 'esm',
    outdir, outExtension: { '.js': '.mjs' }, external: ['@dimforge/rapier2d-compat'] });
  const modules = await Promise.all(entries.map(name => import(pathToFileURL(path.join(outdir, `${name}.mjs`)).href)));
  ({ MISSIONS, MissionProgress, PlayerProgress, RunMissionTracker, emptyMissionStats, purchaseQuote, confirmPurchase,
    GamePhysics, roadHeight } = Object.assign({}, ...modules));
  await RAPIER.init();
});
const idle = { jumpPressed: false, jumpHeld: false, suction: false, boost: false };
function store(extra = {}) {
  const values = new Map([['roadster-progress', JSON.stringify({ version: 1, coins: 100000, ownedWeapons: ['machine-gun'], ...extra })]]);
  const writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); writes.push(JSON.parse(value)); } };
}
function board(ids) {
  const progress = new MissionProgress();
  progress.restore({ active: ids.map(id => ({ id, progress: 0, best: 0 })), seed: 7 });
  progress.beginRun(8);
  return progress;
}

test('the campaign contains 100 distinct goals, all requested tiers and bilingual copy', () => {
  assert.equal(MISSIONS.length, 100);
  assert.equal(new Set(MISSIONS.map(spec => spec.id)).size, 100);
  assert.equal(new Set(MISSIONS.map(spec => `${spec.metric}-${spec.target}`)).size, 100);
  for (const metric of ['forwardFlips','backflips','policeDestroyed','emptyWeapons']) {
    assert.deepEqual(MISSIONS.filter(spec => spec.metric === metric).map(spec => spec.target), [1,2,3,4,5]);
  }
  assert.deepEqual(MISSIONS.filter(spec => spec.metric === 'obstaclesShot').map(spec => spec.target), [5,10,15,20]);
  for (const metric of ['maxSpeed','speed80Seconds','roofHits','nightReached','nightSeconds','dronesRammed']) assert.ok(MISSIONS.some(spec => spec.metric === metric));
  for (const spec of MISSIONS) {
    assert.ok(spec.reward > 0 && spec.points > 0);
    assert.ok(spec.title.en && spec.title.fa && spec.description.en && spec.description.fa);
  }
});

test('missions progress across the entire campaign without repeating a completed goal or offering unowned weapon requirements', () => {
  const progress = new MissionProgress(); progress.fillSlots(1);
  assert.equal(progress.active.length, 3);
  const seen = new Set();
  const stats = Object.fromEntries(Object.keys(emptyMissionStats()).map(key => [key, 1000000]));
  for (let run = 0; run < 200 && progress.completed.length < MISSIONS.length; run++) {
    progress.beginRun(8);
    assert.ok(progress.active.length <= 3);
    const awarded = progress.update(stats, true, run);
    for (const spec of awarded) { assert.equal(seen.has(spec.id), false); seen.add(spec.id); }
    assert.deepEqual(progress.update(stats, true), [], 'a finished run paid again');
  }
  assert.equal(progress.completed.length, 100); assert.equal(seen.size, 100);
  progress.beginRun(8); assert.equal(progress.active.length, 0);
  const locked = new MissionProgress();
  locked.restore({ completed: MISSIONS.filter(spec => spec.metric !== 'emptyWeapons' || spec.target === 1).map(spec => ({ id: spec.id })) });
  locked.fillSlots(1); assert.equal(locked.active.length, 0);
  locked.fillSlots(2); assert.equal(locked.active[0].id, 'emptyWeapons-2');
});

test('saved run attempts reset for the next run, best attempts remain, and lifetime distance carries over', () => {
  const progress = board(['obstaclesShot-5','totalDistance-1000','forwardFlips-1']);
  progress.update({ ...emptyMissionStats(), distance: 600, obstaclesShot: 3 });
  const restored = new MissionProgress(); restored.restore(JSON.parse(JSON.stringify(progress.save())));
  assert.deepEqual(restored.active, progress.active, 'reload changed the assigned IDs or their saved progress');
  restored.beginRun(8);
  assert.equal(restored.active.find(item => item.id === 'obstaclesShot-5').progress, 0);
  assert.equal(restored.active.find(item => item.id === 'obstaclesShot-5').best, 3);
  const earned = restored.update({ ...emptyMissionStats(), distance: 450, obstaclesShot: 2 });
  assert.deepEqual(earned.map(spec => spec.id), ['totalDistance-1000']);
  assert.equal(restored.totals.totalDistance, 1050);
  assert.equal(restored.active.find(item => item.id === 'obstaclesShot-5').progress, 2);
  assert.deepEqual(restored.update({ ...emptyMissionStats(), distance: 400, obstaclesShot: 1 }), []);
  assert.equal(restored.totals.totalDistance, 1050, 'older snapshots duplicated lifetime distance');
});

test('mission completion, coin credit, points and archive are saved atomically and never paid again on reload', () => {
  const storage = store({ coins: 100 }); const player = new PlayerProgress(storage);
  player.resetRun(); player.beginMissionRun();
  const stats = { ...emptyMissionStats(), distance: 250, jumps: 5, boxesOpened: 1 };
  const earned = player.collectMissions(stats, 1000);
  assert.equal(earned.length, 3);
  const reward = earned.reduce((sum, spec) => sum + spec.reward, 0);
  assert.equal(player.coins, 100 + reward); assert.equal(player.runCoins, reward);
  const commit = storage.writes.at(-1);
  assert.equal(commit.coins, 100 + reward); assert.equal(commit.missions.completed.length, 3);
  const restored = new PlayerProgress(storage);
  assert.equal(restored.missions.score, player.missions.score);
  assert.equal(restored.missions.earnedCoins, reward);
  assert.equal(restored.missions.completed.length, 3);
  assert.ok(restored.missions.active.every(item => !earned.some(spec => spec.id === item.id)));
  assert.deepEqual(restored.collectMissions(stats, 2000), [], 'reload credited old actions before a new run');
  assert.equal(restored.coins, 100 + reward);
  restored.beginMissionRun();
  assert.deepEqual(restored.collectMissions(emptyMissionStats(), 3000), []);
});

test('progress checkpoints stay throttled, pause flushes the latest attempt, and corrupt records cannot duplicate IDs', () => {
  const storage = store({ coins: 0 }); const player = new PlayerProgress(storage); player.beginMissionRun();
  const writes = storage.writes.length;
  for (let i = 0; i < 100; i++) player.collectMissions({ ...emptyMissionStats(), distance: i }, i * 10);
  assert.ok(storage.writes.length - writes <= 2, 'mission progress wrote storage on every frame');
  player.flushScore();
  assert.equal(new PlayerProgress(storage).missions.active.find(item => item.id === 'distance-250').progress, 99);
  const corrupt = new MissionProgress();
  corrupt.restore({ active: [{ id: 'bad' }, { id: 'distance-250', progress: -1 }, { id: 'distance-250', progress: 200 }],
    completed: [{ id: 'roofHits-1' }, { id: 'roofHits-1' }, { id: 'unknown' }], totals: { totalDistance: Infinity, totalRuns: -1 } });
  assert.equal(corrupt.completed.length, 1); assert.equal(corrupt.active.length, 1);
  assert.equal(corrupt.active[0].progress, 0); assert.equal(corrupt.totals.totalDistance, 0);
});

test('speed holds are consecutive, night and airtime use simulation ticks, and different empty weapons count once each', () => {
  const tracker = new RunMissionTracker();
  const sample = { distance: 100, speed: 25, grounded: true, loop: false, crashed: false, boost: false, impacts: 0, loops: 0, police: 0, boxes: 0, ramps: 0 };
  for (let i = 0; i < 588; i++) tracker.step(sample, 1 / 120);
  tracker.step({ ...sample, speed: 20 }, 1 / 120);
  for (let i = 0; i < 24; i++) tracker.step(sample, 1 / 120);
  assert.ok(tracker.stats.speed80Seconds < 5, 'separate fast intervals were added together');
  for (let i = 0; i < 600; i++) tracker.step({ ...sample, distance: 800, grounded: false }, 1 / 120);
  assert.ok(tracker.stats.speed80Seconds >= 5); assert.ok(Math.abs(tracker.stats.nightSeconds - 5) < 1e-8);
  assert.ok(Math.abs(tracker.stats.longestFlight - 5) < 1e-8);
  const airtime = tracker.stats.airSeconds;
  tracker.step({ ...sample, grounded: false, loop: true }, 1);
  assert.equal(tracker.stats.airSeconds, airtime, 'loop riding counted as free flight');
  tracker.recordWeapon('machine-gun', 0, 80); tracker.recordWeapon('machine-gun', 0, 80);
  tracker.recordWeapon('twin-gun', 0, 130);
  assert.equal(tracker.stats.emptyWeapons, 2);
  tracker.recordWeapon('machine-gun', 0, 131); assert.equal(tracker.stats.emptyWeapons, 2);
});

test('real flips retain their direction, grounded jumps count once, and roof contact survives the fatal frame and wreck', () => {
  for (const [action, metric, other] of [['frontJet','backflips','forwardFlips'],['rearJet','forwardFlips','backflips']]) {
    const game = new GamePhysics();
    try {
      game.car.setTranslation({ x: 7, y: 100 }, true); game.car.setRotation(0, true);
      game.car.setLinvel({ x: 0, y: 0 }, true);
      for (let i = 0; i < 270; i++) game.step({ ...idle, [action]: true });
      assert.equal(game.snapshot(1).missionStats[metric], 2); assert.equal(game.snapshot(1).missionStats[other], 0);
      const stats = { ...game.snapshot(1).missionStats }; game.crashed = true;
      for (let i = 0; i < 120; i++) game.stepWreck();
      assert.deepEqual(game.snapshot(1).missionStats, stats);
    } finally { game.dispose(); }
  }
  const jumping = new GamePhysics(-40);
  try {
    jumping.step({ ...idle, jumpPressed: true, jumpHeld: true });
    jumping.step({ ...idle, jumpPressed: true, jumpHeld: true });
    jumping.step({ ...idle, jumpPressed: true, jumpHeld: true });
    assert.equal(jumping.snapshot(1).missionStats.jumps, 1); assert.equal(jumping.snapshot(1).missionStats.doubleJumps, 1);
  } finally { jumping.dispose(); }
  const roof = new GamePhysics(20);
  try {
    roof.car.setRotation(Math.PI, true); roof.car.setTranslation({ x: 20, y: roadHeight(20) + .6 }, true);
    roof.step(idle); assert.equal(roof.crashed, true); assert.equal(roof.snapshot(1).missionStats.roofHits, 1);
    const progress = board(['roofHits-1','forwardFlips-1','backflips-1']);
    assert.ok(progress.update(roof.snapshot(1).missionStats, true).some(spec => spec.id === 'roofHits-1'));
  } finally { roof.dispose(); }
});

test('every paid item uses a read-only quote, then debits exactly once on confirmation', () => {
  const storage = store(); const player = new PlayerProgress(storage); const xp = 50000;
  for (const intent of [{ kind:'weapon',id:'twin-gun' }, { kind:'weapon-upgrade',id:'twin-gun' },
    { kind:'car-upgrade',id:'armor' }, { kind:'car-upgrade',id:'boost-reserve' },
    { kind:'car-upgrade',id:'boost-power' }, { kind:'vehicle',id:'samandster' }, { kind:'paint',id:'blue' }]) {
    const before = player.coins; const writes = storage.writes.length;
    const quote = purchaseQuote(player, intent, xp);
    assert.ok(quote); assert.equal(player.coins, before); assert.equal(storage.writes.length, writes);
    assert.equal(confirmPurchase(player, { ...quote, cost: quote.cost - 1 }, xp), false, 'changed price was accepted');
    assert.equal(confirmPurchase(player, quote, xp), true); assert.equal(player.coins, before - quote.cost);
    assert.equal(confirmPurchase(player, quote, xp), false, 'double confirmation paid twice');
  }
  assert.equal(new PlayerProgress(storage).selectedPaint, 'blue');
  assert.equal(purchaseQuote(player, { kind:'paint',id:'blue' }, xp), null);
});

test('confirmation rechecks the balance, XP lock, ownership and upgrade stage before charging', () => {
  const player = new PlayerProgress(store({ coins: 1000 }));
  const quote = purchaseQuote(player, { kind:'paint',id:'red' }, 0);
  player.coins = 49; assert.equal(confirmPurchase(player, quote, 0), false);
  assert.equal(player.coins, 49); assert.equal(player.ownsPaint('red'), false);
  player.coins = 1000;
  const gun = purchaseQuote(player, { kind:'weapon',id:'twin-gun' }, 200);
  assert.equal(confirmPurchase(player, gun, 199), false); assert.equal(player.coins, 1000);
  assert.equal(player.ownsWeapon('twin-gun'), false);
  assert.equal(purchaseQuote(player, { kind:'car-upgrade',id:'armor' }, 100), null);
  const upgrade = purchaseQuote(player, { kind:'weapon-upgrade',id:'machine-gun' }, 0);
  player.upgradeWeapon('machine-gun');
  assert.equal(confirmPurchase(player, upgrade, 0), false);
});

test('paint confirmations stay bound to their car while unlocked colors remain reusable across cars', () => {
  const storage=store({coins:1000,ownedVehicles:['roadster','samandster']}); const player=new PlayerProgress(storage);
  const quote=purchaseQuote(player,{kind:'paint',id:'red'},0);
  assert.equal(quote.vehicle,'roadster');
  player.selectVehicle('samandster');
  assert.equal(confirmPurchase(player,quote,0),false); assert.equal(player.coins,1000);
  assert.equal(player.ownsPaint('red'),false); assert.equal(player.selectedPaint,'white');
  const current=purchaseQuote(player,{kind:'paint',id:'red'},0);
  assert.equal(current.vehicle,'samandster'); assert.equal(confirmPurchase(player,current,0),true);
  assert.equal(player.coins,950); assert.equal(player.selectedPaint,'red');
  player.selectVehicle('roadster'); assert.equal(player.selectedPaint,'white');
  assert.equal(purchaseQuote(player,{kind:'paint',id:'red'},0),null,'an unlocked color must not be charged again');
  assert.equal(player.selectPaint('red'),true); assert.equal(player.coins,950);
  player.selectPaint('white');
  const restored=new PlayerProgress(storage);
  assert.equal(restored.selectedPaint,'white'); assert.equal(restored.paintForVehicle('samandster'),'red');
});

test('purchase quotes reject invalid XP and unknown vehicles without changing progress', () => {
  const storage=store({coins:1000}); const player=new PlayerProgress(storage); const writes=storage.writes.length;
  for(const xp of [NaN,Infinity,-1,.5]) for(const intent of [
    {kind:'weapon-upgrade',id:'machine-gun'},{kind:'vehicle',id:'peugester'},{kind:'paint',id:'blue'},
  ]) assert.equal(purchaseQuote(player,intent,xp),null);
  assert.equal(purchaseQuote(player,{kind:'vehicle',id:'unknown'},0),null);
  assert.equal(purchaseQuote(player,{kind:'vehicle',id:'roadster'},0),null);
  assert.equal(player.coins,1000); assert.equal(storage.writes.length,writes);
});
