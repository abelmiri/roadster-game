import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
let PolicePursuit, ExperienceProgress;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-progress-tests');
  await build({ entryPoints: ['src/game/pursuit.ts', 'src/game/experience.ts'], bundle: true,
    platform: 'node', format: 'esm', outdir, outExtension: { '.js': '.mjs' } });
  ({ PolicePursuit } = await import(pathToFileURL(path.join(outdir, 'pursuit.mjs')).href));
  ({ ExperienceProgress } = await import(pathToFileURL(path.join(outdir, 'experience.mjs')).href));
});
function advance(pursuit, seconds, boost = false) {
  let x = pursuit.x + pursuit.gap;
  for (let i = 0; i < seconds * 120; i++) {
    x += 13 / 120;
    pursuit.update(1 / 120, boost, { x, speed: 13 });
  }
}
test('police gives warning before closing and boost drives it back', () => {
  const pursuit = new PolicePursuit();
  advance(pursuit, 11);
  assert.equal(pursuit.visibility, 0);
  advance(pursuit, 3);
  assert.ok(pursuit.visibility > .8);
  assert.ok(pursuit.gap >= 29.9);
  advance(pursuit, 5);
  assert.ok(pursuit.gap < 20);
  const before = pursuit.gap;
  advance(pursuit, 1, true);
  assert.ok(pursuit.gap > before + 9);
  assert.equal(pursuit.idleSeconds, 0);
  advance(pursuit, 3);
  assert.ok(pursuit.visibility < .2);
  advance(pursuit, 25);
  assert.equal(pursuit.gap, 3.5);
});
test('police drives straight forward during a loop even when the player travels backward', () => {
  const pursuit = new PolicePursuit(300);
  pursuit.gap = 8; pursuit.idleSeconds = 20;
  pursuit.beginLoop(300, 16);
  let previous = pursuit.x;
  for (let i = 0; i < 240; i++) {
    const angle = i / 240 * Math.PI * 2;
    pursuit.update(1 / 120, false, { x: 300 + Math.sin(angle) * 5, speed: 16 });
    assert.ok(pursuit.x > previous, 'patrol stopped or followed the car backward');
    assert.ok(pursuit.x - previous < .2, 'patrol teleported');
    previous = pursuit.x;
  }
  assert.ok(pursuit.x > 300, 'patrol should pass the loop while slowing ahead of the player');
  assert.equal(pursuit.mode, 'bypassing');
  assert.ok(pursuit.idleSeconds > 21.9, 'chase time should advance in a loop');
});

test('a hidden patrol cannot bypass a loop and later spawn ahead when the warning starts', () => {
  for (const completed of [true, false]) {
    const pursuit = new PolicePursuit(300);
    pursuit.beginLoop(300, 16);
    for (let i = 0; i < 360; i++) {
      const angle = i / 360 * Math.PI * 2;
      pursuit.update(1 / 120, true, { x: 300 + Math.sin(angle) * 5, speed: 16 });
    }
    pursuit.finishLoop(completed);
    assert.equal(pursuit.visibility, 0);
    let x = 300;
    for (let i = 0; i < 1441; i++) {
      x += 14 / 120;
      pursuit.update(1 / 120, false, { x, speed: 14 });
    }
    assert.ok(pursuit.visibility > 0, 'the warning must eventually start');
    assert.ok(pursuit.x < x - 29.9, `first appearance was ahead after completed=${completed}`);
    assert.equal(pursuit.mode, 'chasing');
    advance(pursuit, 1.5);
    assert.ok(pursuit.gap >= 29.9, 'lights must give warning before the patrol closes');
    advance(pursuit, 2);
    assert.ok(pursuit.gap < 27, 'the patrol should then approach from behind');
  }
});

test('a pursuit starting during a loop appears behind and then drives forward on the road', () => {
  const pursuit = new PolicePursuit(300);
  advance(pursuit, 11.5);
  const loopX = pursuit.x + pursuit.gap;
  pursuit.beginLoop(loopX, 16);
  let previous = null;
  for (let i = 0; i < 240; i++) {
    const angle = i / 240 * Math.PI * 2;
    const x = loopX + Math.sin(angle) * 5;
    pursuit.update(1 / 120, false, { x, speed: 16 });
    if (pursuit.visibility > 0) {
      if (previous === null) assert.ok(pursuit.gap >= 29, 'first warning must come from behind');
      else assert.ok(pursuit.x > previous, 'a visible patrol must keep moving forward');
      previous = pursuit.x;
    }
  }
  assert.notEqual(previous, null);
  assert.equal(pursuit.mode, 'bypassing');
});
test('completed loops let the player overtake the police without a backward teleport', () => {
  const pursuit = new PolicePursuit(300);
  pursuit.gap = 8; pursuit.idleSeconds = 20;
  pursuit.beginLoop(300, 16);
  for (let i = 0; i < 240; i++) pursuit.update(1 / 120, false, { x: 300, speed: 16 });
  const before = pursuit.x;
  pursuit.finishLoop(true);
  assert.equal(pursuit.x, before);
  assert.equal(pursuit.mode, 'rejoining');
  let carX = 300;
  let previous = pursuit.x;
  for (let i = 0; i < 720 && pursuit.mode !== 'chasing'; i++) {
    carX += 16 / 120;
    pursuit.update(1 / 120, false, { x: carX, speed: 16 });
    assert.ok(pursuit.x >= previous);
    assert.ok(pursuit.x - previous < .2);
    previous = pursuit.x;
  }
  assert.equal(pursuit.mode, 'chasing');
  assert.ok(carX - pursuit.x >= 8);
});
test('after an abandoned loop the patrol brakes ahead and stays slow until the player passes', () => {
  const pursuit = new PolicePursuit(300);
  pursuit.gap = 8; pursuit.idleSeconds = 20;
  pursuit.beginLoop(300, 16);
  let previousX = pursuit.x;
  let previousSpeed = 0;
  for (let i = 0; i < 120; i++) {
    previousX = pursuit.x;
    pursuit.update(1 / 120, false, { x: 300, speed: 16 });
    previousSpeed = (pursuit.x - previousX) * 120;
  }
  const before = pursuit.x;
  assert.ok(before > 300);
  pursuit.finishLoop(false);
  assert.equal(pursuit.mode, 'intercepting');
  pursuit.update(1 / 120, false, { x: 301, speed: 14 });
  assert.ok(pursuit.x > before);
  const speed = (pursuit.x - before) * 120;
  assert.ok(speed < previousSpeed, 'patrol must decelerate instead of speeding away');
  assert.ok(speed > 0 && previousSpeed - speed <= 20 / 120 + .0001, 'braking must stay smooth and forward');
  let carX = 301;
  let returnedBehind = false;
  for (let i = 0; i < 1200; i++) {
    previousX = pursuit.x;
    carX += 14 / 120;
    pursuit.update(1 / 120, false, { x: carX, speed: 14 });
    assert.ok(pursuit.x > previousX, 'patrol must never stop or reverse');
    if (pursuit.mode === 'chasing') {
      assert.ok(pursuit.gap >= 8);
      returnedBehind = true; break;
    }
    if (i > 120) assert.ok((pursuit.x - previousX) * 120 < 6, 'patrol accelerated before falling safely behind');
  }
  assert.equal(returnedBehind, true);
});

test('any active patrol ahead of the player slows without teleporting, at early and late speeds', () => {
  for (const speed of [6, 14, 18, 23]) {
    const pursuit = new PolicePursuit(100);
    pursuit.visibility = 1; pursuit.idleSeconds = 20;
    pursuit.x = 106; pursuit.gap = -6;
    let carX = 100;
    let previousX = pursuit.x;
    let fellBehind = false;
    for (let i = 0; i < 1800; i++) {
      carX += speed / 120;
      pursuit.update(1 / 120, false, { x: carX, speed });
      const patrolSpeed = (pursuit.x - previousX) * 120;
      assert.ok(patrolSpeed > 0 && patrolSpeed <= 23, 'patrol stopped, reversed, or warped');
      previousX = pursuit.x;
      if (i > 120 && pursuit.mode !== 'chasing') assert.ok(patrolSpeed < speed, 'patrol must allow an overtake');
      if (pursuit.mode === 'chasing') { fellBehind = true; assert.ok(pursuit.gap >= 8); break; }
    }
    assert.equal(fellBehind, true, `player speed=${speed}`);
  }
});
test('XP is awarded exactly once per completed lap and persists across runs and reloads', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const progress = new ExperienceProgress(storage);
  assert.equal(progress.collect(1), 25);
  assert.equal(progress.collect(1), 0);
  assert.equal(progress.collect(3), 50, 'skipped display frames must retain every reward');
  progress.resetRun();
  assert.equal(progress.collect(1), 25);
  assert.equal(progress.total, 100);
  assert.equal(progress.level, 2);
  assert.equal(progress.levelProgress, 0);
  assert.equal(new ExperienceProgress(storage).total, 100);
  assert.equal(progress.collect(NaN), 0);
});

test('obstacles award 10 XP, patrols 20 XP, and combined counters cannot pay twice', () => {
  const values = new Map();
  const storage = { getItem:key=>values.get(key), setItem:(key,value)=>values.set(key,value) };
  const progress = new ExperienceProgress(storage);
  assert.equal(progress.collect(0,1,0),10);
  assert.equal(progress.lastRewardKind,'obstacle');
  assert.equal(progress.collect(0,1,1),20);
  assert.equal(progress.lastRewardKind,'police');
  assert.equal(progress.collect(0,1,1),0,'repeated snapshots must not duplicate XP');
  assert.equal(progress.collect(2,4,3),120,'skipped frames must retain two loops, three obstacles, and two patrols');
  assert.equal(progress.lastRewardKind,'mixed');
  assert.equal(progress.total,150);
  assert.equal(values.get('roadster-xp'),'150');
  assert.equal(new ExperienceProgress(storage).total,150);
  assert.equal(progress.collect(1,2,1),0,'older snapshots must not roll reward counters backward');
  assert.equal(progress.collect(2,4,3),0);
  progress.resetRun();
  assert.equal(progress.collect(0,1,1),30,'new targets in a new run must pay again');
  assert.equal(progress.total,180);
});

test('invalid combat counters are ignored independently of valid rewards', () => {
  const progress = new ExperienceProgress();
  assert.equal(progress.collect(1,NaN,1),45);
  assert.equal(progress.collect(NaN,1,Infinity),10);
  assert.equal(progress.collect(1,-1,1),0);
  assert.equal(progress.total,55);
});

test('all six distance goals award their exact XP once, persist, and contribute to run XP and levels', () => {
  const values = new Map();
  const storage = {getItem:key=>values.get(key), setItem:(key,value)=>values.set(key,value)};
  const progress = new ExperienceProgress(storage);
  let total = 0;
  for(const [distance,xp] of [[1500,150],[3000,300],[4500,600],[6000,1000],[7500,1500],[10000,2000]]) {
    assert.equal(progress.collect(0,0,0,distance-.01), 0);
    assert.equal(progress.collect(0,0,0,distance), xp);
    assert.equal(progress.lastRewardKind, 'distance');
    total += xp;
    assert.equal(progress.runXp, total);
    assert.equal(progress.total, total);
    assert.equal(values.get('roadster-xp'), String(total));
    assert.equal(progress.collect(0,0,0,distance), 0);
    assert.equal(progress.collect(0,0,0,distance-1), 0);
  }
  assert.equal(progress.total, 5550);
  assert.equal(progress.level, 56);
  assert.equal(progress.levelProgress, 50);
  assert.equal(progress.collect(0,0,0,20000), 0);
  const restored = new ExperienceProgress(storage);
  assert.equal(restored.total, 5550);
  assert.equal(restored.runXp, 0);
});

test('skipped distance goals combine with combat XP, end at game over, and reset only per-run claims', () => {
  const progress = new ExperienceProgress();
  assert.equal(progress.collect(2,3,1,4500), 1150);
  assert.equal(progress.lastRewardKind, 'mixed');
  assert.equal(progress.runXp, 1150);
  assert.equal(progress.collect(2,3,1,4500), 0);
  assert.equal(progress.collect(2,3,1,NaN), 0);
  progress.finishRun();
  assert.equal(progress.collect(3,4,2,10000), 0, 'wreck frames must never earn XP');
  assert.equal(progress.total, 1150);
  progress.resetRun();
  assert.equal(progress.runXp, 0);
  assert.equal(progress.collect(0,0,0,10000), 5550);
  assert.equal(progress.total, 6700);
  assert.equal(progress.runXp, 5550);
});

test('invalid distance cannot grant bonuses or discard valid combat XP, and storage failures remain playable', () => {
  const progress = new ExperienceProgress({getItem(){throw Error();}, setItem(){throw Error();}});
  for(const distance of [NaN,Infinity,-Infinity,-1]) assert.equal(progress.collect(0,0,0,distance), 0);
  assert.equal(progress.collect(1,0,0,Infinity), 25);
  assert.equal(progress.lastRewardKind, 'loop');
  assert.equal(progress.collect(NaN,NaN,Infinity,1500), 150);
  assert.equal(progress.lastRewardKind, 'distance');
  assert.equal(progress.total, 175);
  assert.equal(progress.runXp, 175);
});
test('unavailable or invalid storage never prevents XP progression', () => {
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  const progress = new ExperienceProgress(blocked);
  assert.equal(progress.collect(1), 25);
  for (const saved of ['NaN', '-25', 'Infinity', '2.5']) {
    assert.equal(new ExperienceProgress({ getItem: () => saved, setItem() {} }).total, 0);
  }
});

test('a disabled patrol fades in place and a replacement waits before approaching from behind', () => {
  const pursuit=new PolicePursuit(100);
  advance(pursuit,20);
  const before=pursuit.x;
  pursuit.disable(8);
  assert.equal(pursuit.x,before,'destroying the patrol must not visibly warp it');
  advance(pursuit,4);
  assert.equal(pursuit.disabled,true);
  assert.ok(pursuit.visibility<.001);
  advance(pursuit,4.1);
  assert.equal(pursuit.disabled,false);
  assert.equal(pursuit.visibility,0);
  assert.ok(pursuit.gap>=29.9);
  advance(pursuit,11);
  assert.equal(pursuit.visibility,0);
  advance(pursuit,1);
  assert.ok(pursuit.visibility>0);
  assert.ok(pursuit.gap>=29.9);
});
