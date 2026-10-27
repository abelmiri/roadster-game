import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Matrix4, Vector3 } from 'three';
import RAPIER from '@dimforge/rapier2d-compat';

let CAR_PAINTS, CAR_PAINT_PRICE, PlayerProgress, ExperienceProgress, RandomBoxRewards, rollBoxReward;
let GamePhysics, TrackGenerator, MagneticShield, RandomBoxVisuals, CarBodyDamage, createRoadsterBody, carGarageIcon;
let BOX_UNLOCK_DISTANCE, CHUNK_LENGTH, RAMP_LANDING, RAMP_APPROACH, loopsBetween, rampsBetween;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-customization-tests');
  const entries = ['carPaint', 'playerProgress', 'experience', 'randomBox', 'physics', 'track', 'powerVisuals', 'carBodyDamage', 'roadsterModel', 'carGarageIcon'];
  await build({ entryPoints: entries.map(name => `src/game/${name}.ts`), bundle: true, platform: 'node', format: 'esm',
    outdir, outExtension: { '.js': '.mjs' }, external: ['three', '@dimforge/rapier2d-compat'] });
  const modules = await Promise.all(entries.map(name => import(pathToFileURL(path.join(outdir, `${name}.mjs`)).href)));
  ({ CAR_PAINTS, CAR_PAINT_PRICE, PlayerProgress, ExperienceProgress, RandomBoxRewards, rollBoxReward, GamePhysics,
    TrackGenerator, MagneticShield, RandomBoxVisuals, CarBodyDamage, createRoadsterBody, carGarageIcon,
    BOX_UNLOCK_DISTANCE, CHUNK_LENGTH, RAMP_LANDING, RAMP_APPROACH, loopsBetween, rampsBetween } = Object.assign({}, ...modules));
  await RAPIER.init();
});
const idle = { jumpPressed: false, jumpHeld: false, suction: false, boost: false };
const box = id => ({ id, x: 40, y: 2, airborne: false, phase: 0 });
const boxEvent = (spec,serial=1,age=0) => ({ serial,boxId:spec.id,x:spec.x,y:spec.y,
  airborne:spec.airborne,phase:spec.phase,reward:{kind:'coins',amount:20},age });
function firstBoxes() {
  const track = new TrackGenerator();
  const boxes = Array.from({ length: 200 }, (_, index) => track.chunk(index).boxes).flat();
  return [boxes.find(spec => !spec.airborne), boxes.find(spec => spec.airborne)];
}
function store(save = {}) {
  const values = new Map([['roadster-progress', JSON.stringify({ version: 1, coins: 650, ...save })]]);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('all twelve new paints cost 50, remain owned after reload, and switch without another debit', () => {
  const storage = store(); const player = new PlayerProgress(storage);
  assert.equal(CAR_PAINTS.length, 12);
  assert.equal(CAR_PAINT_PRICE, 50);
  for (const id of ['blue', 'pink', 'red', 'black', 'purple', 'yellow', 'lime', 'silver']) assert.ok(CAR_PAINTS.some(paint => paint.id === id));
  for (const paint of CAR_PAINTS) assert.equal(player.purchasePaint(paint.id), 'purchased');
  assert.equal(player.coins, 50);
  const restored = new PlayerProgress(storage);
  assert.equal(restored.selectedPaint, 'burgundy');
  for (const paint of CAR_PAINTS) {
    assert.equal(restored.ownsPaint(paint.id), true);
    assert.equal(restored.purchasePaint(paint.id), 'owned');
    assert.equal(restored.selectPaint(paint.id), true);
  }
  assert.equal(restored.selectPaint('white'), true);
  assert.equal(restored.coins, 50);
  const poor = new PlayerProgress(store({ coins: 49 }));
  assert.equal(poor.purchasePaint('blue'), 'insufficient-coins');
  assert.equal(poor.selectPaint('blue'), false);
  assert.equal(poor.purchasePaint('invalid'), 'unknown');
  assert.equal(poor.coins, 49);
  assert.equal(poor.selectedPaint, 'white');
  assert.equal(new PlayerProgress(store({ selectedPaint: 'red', ownedPaints: ['bad'] })).selectedPaint, 'white');
});

test('paint changes survive damage, repair and restart in both the model and garage preview', () => {
  const body = createRoadsterBody(); const damage = new CarBodyDamage(body);
  const material = body.children[0].material[0];
  try {
    for (const paint of CAR_PAINTS) {
      damage.setPaint(paint.id); damage.update(100);
      assert.equal(material.color.getHexString(), paint.color.slice(1));
      assert.ok(carGarageIcon(2, paint.id).includes(`fill="${paint.color}"`));
      damage.update(25);
      assert.notEqual(material.color.getHexString(), paint.color.slice(1));
      damage.update(100);
      assert.equal(material.color.getHexString(), paint.color.slice(1));
    }
    damage.setPaint('white'); damage.update(100);
    assert.equal(material.color.getHexString(), 'f3f4ee');
  } finally { damage.dispose(); }
});

test('reward draws include every prize and larger coin amounts are strictly rarer', () => {
  const counts = new Map();
  for (let ticket = 0; ticket < 100; ticket++) {
    const reward = rollBoxReward((ticket + .5) / 100);
    const value = reward.amount ?? reward.seconds;
    const key = value === undefined ? reward.kind : `${reward.kind}-${value}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.size, 11);
  const coins = [20, 50, 100, 200].map(amount => counts.get(`coins-${amount}`));
  assert.ok(coins.every((count, index) => count > 0 && (index === 0 || count < coins[index - 1])));
  for (const key of ['shield-20', 'boost-20', 'health', 'ammo', 'xp-100', 'xp-250', 'xp-500']) assert.ok(counts.get(key) > 0);
});

test('opened boxes never pay twice; timers refresh to 20 seconds and end exactly once', () => {
  const loot = new RandomBoxRewards(() => .66);
  loot.open(box('shield-1'));
  assert.deepEqual(loot.events[0], { serial:1,boxId:'shield-1',x:40,y:2,airborne:false,phase:0,
    reward:{kind:'shield',seconds:20},age:0 });
  assert.equal(loot.shieldRemaining, 20);
  loot.step(17);
  assert.equal(loot.shieldRemaining, 3);
  assert.equal(loot.open(box('shield-1')), null);
  assert.equal(loot.shieldRemaining, 3);
  loot.open(box('shield-2'));
  assert.equal(loot.shieldRemaining, 20, 'a second shield refreshes instead of stacking');
  loot.random = () => .78; loot.open(box('boost'));
  loot.step(19.99);
  assert.ok(loot.shieldRemaining > 0 && loot.boostRemaining > 0);
  loot.step(.01);
  assert.equal(loot.shieldRemaining, 0); assert.equal(loot.boostRemaining, 0);
  loot.random = () => 0; loot.open(box('coins'));
  loot.random = () => .99; loot.open(box('xp'));
  loot.random = () => .85; assert.deepEqual(loot.open(box('health')), { kind: 'health' });
  loot.random = () => .91; assert.deepEqual(loot.open(box('ammo')), { kind: 'ammo' });
  loot.random = () => .85; assert.deepEqual(loot.open(box('full-health'), { health: false }), { kind: 'coins', amount: 20 });
  loot.random = () => .91; assert.deepEqual(loot.open(box('full-ammo'), { ammo: false }), { kind: 'coins', amount: 20 });
  loot.step(4);
  assert.equal(loot.events.length, 0);
  assert.equal(loot.coins, 60); assert.equal(loot.xp, 500);
  assert.equal(loot.open(box('coins')), null); assert.equal(loot.coins, 60);
});

test('cumulative box coins and XP persist across missed frames without duplicate or post-run awards', () => {
  const storage = store({ coins: 0 }); const player = new PlayerProgress(storage); const xp = new ExperienceProgress(storage);
  assert.equal(player.collect(0, 0, 0, 0, 270), 270);
  assert.equal(xp.collect(0, 0, 0, 0, 850), 850);
  assert.equal(xp.lastRewardKind, 'box');
  for (const amount of [270, 20, NaN, -5]) assert.equal(player.collect(0, 0, 0, 0, amount), 0);
  for (const amount of [850, 100, Infinity, -5]) assert.equal(xp.collect(0, 0, 0, 0, amount), 0);
  assert.equal(new PlayerProgress(storage).coins, 270); assert.equal(new ExperienceProgress(storage).total, 850);
  player.finishRun(0); xp.finishRun();
  assert.equal(player.collect(0, 0, 0, 0, 1000), 0); assert.equal(xp.collect(0, 0, 0, 0, 1000), 0);
  player.resetRun(); xp.resetRun();
  assert.equal(player.collect(0, 0, 0, 0, 20), 20); assert.equal(xp.collect(0, 0, 0, 0, 100), 100);
});

test('procedural boxes include ground and air placements and avoid missing road', () => {
  const track = new TrackGenerator(); const boxes = [];
  for (let index = 0; index < 200; index++) {
    const chunk = track.chunk(index);
    if (chunk.gap) assert.equal(chunk.boxes.length, 0);
    for (const box of chunk.boxes) {
      assert.ok(box.x - 7 >= BOX_UNLOCK_DISTANCE, `box ${box.id} appeared before 300m`);
      assert.equal(track.hasRoad(box.x), true); boxes.push(box);
    }
  }
  assert.ok(boxes.some(box => box.airborne)); assert.ok(boxes.some(box => !box.airborne));
  const reverse = new TrackGenerator();
  for (let index = 199; index >= 0; index--) assert.deepEqual(reverse.chunk(index).boxes, track.chunk(index).boxes);
});

test('box density keeps about 80 percent of eligible placements after the opening stretch', () => {
  const track = new TrackGenerator();
  let candidates=0,kept=0;
  for (let index=11;index<10000;index++) {
    const chunk=track.chunk(index);
    const start=index*CHUNK_LENGTH;
    const reserved=loopsBetween(start-20,start+CHUNK_LENGTH+20).length>0 ||
      rampsBetween(start-RAMP_LANDING,start+CHUNK_LENGTH+RAMP_APPROACH).length>0;
    if (index%3===1&&!chunk.gap&&!reserved) candidates++;
    kept+=chunk.boxes.length;
  }
  assert.ok(candidates>1000,'the sample must cover enough independently thinned slots');
  assert.ok(Math.abs(kept/candidates-.8)<.025, `kept ${kept}/${candidates} eligible slots`);
});

test('physics keeps all boxes hidden and unshootable until the player reaches 300m', () => {
  const [ground]=firstBoxes(); const game=new GamePhysics(7);
  try {
    game.ensureChunks(ground.x);
    game.car.setTranslation({x:306,y:game.car.translation().y},true);
    assert.equal(game.distance,299); assert.deepEqual(game.randomBoxStates,[]);
    game.updateWeapon({...idle,fire:true});
    assert.equal(game.snapshot(1).boxRewardSerial,0);
    game.car.setTranslation({x:307,y:game.car.translation().y},true);
    assert.equal(game.distance,300);
    assert.ok(game.randomBoxStates.some(spec=>spec.id===ground.id));
  } finally {game.dispose();}
});

test('real bullets open ground and airborne boxes once without explosions and retain animation metadata across streaming', () => {
  const [ground,air]=firstBoxes();
  for (const spec of [ground, air]) {
    const game = new GamePhysics(spec.x - 14);
    game.furthestX=game.startX+BOX_UNLOCK_DISTANCE;
    game.boxRewards.random = () => spec.airborne ? .99 : 0;
    try {
      for (let i = 0; i < 240 && !game.crashed && game.snapshot(1).boxRewardSerial === 0; i++) game.step({ ...idle, suction: true, fire: true });
      const state = game.snapshot(1);
      assert.equal(state.boxRewardSerial, 1, `box ${spec.id} must be shootable`);
      assert.equal(state.boxCoins, spec.airborne ? 0 : 20);
      assert.equal(state.boxXp, spec.airborne ? 500 : 0);
      const purpleHits=state.weapon.effects.filter(effect=>effect.color==='#cb7dff');
      assert.ok(purpleHits.length>0);
      assert.ok(purpleHits.every(effect=>!effect.destroyed&&effect.size<.9),'box hits must stay small and nonexplosive');
      assert.equal(state.weapon.destroySerial,0,'opening a box must not trigger explosion slow motion');
      assert.equal(game.explosionSerial,0);
      const event=state.boxRewardEvents[0];
      assert.equal(event.serial,1); assert.equal(event.boxId,spec.id);
      assert.equal(event.x,spec.x); assert.ok(Math.abs(event.y-spec.y)<.05);
      assert.equal(event.airborne,spec.airborne); assert.equal(event.phase,spec.phase);
      assert.equal(state.obstaclesDestroyed, 0, 'boxes must not also pay obstacle XP');
      assert.ok(!game.randomBoxStates.some(box => box.id === spec.id));
      game.ensureChunks(spec.x + 200); game.ensureChunks(spec.x);
      assert.ok(!game.randomBoxStates.some(box => box.id === spec.id), 'reloaded box reappeared');
      assert.equal(game.snapshot(1).boxRewardSerial, 1);
    } finally { game.dispose(); }
  }
  const game = new GamePhysics(ground.x - 3);
  game.furthestX=game.startX+BOX_UNLOCK_DISTANCE;
  try {
    for (let i = 0; i < 60 && game.car.translation().x < ground.x + 3; i++) game.step(idle);
    assert.equal(game.snapshot(1).boxRewardSerial, 0, 'driving through a box must not claim its prize');
    assert.ok(game.randomBoxStates.some(box => box.id === ground.id));
  } finally { game.dispose(); }
});

test('shot boxes restore one health unit or refill only the selected weapon', () => {
  const [spec] = firstBoxes();
  for (const kind of ['health', 'ammo']) {
    const game = new GamePhysics(spec.x - 14, { id: 'twin-gun', xp: 200 });
    game.furthestX = game.startX + BOX_UNLOCK_DISTANCE;
    game.boxRewards.random = () => kind === 'health' ? .85 : .91;
    game.damage.hullHealth = 50;
    game.weapon.ammunition.set('twin-gun', 10);
    const otherAmmo = game.weapon.ammoFor('machine-gun');
    try {
      for (let i = 0; i < 240 && !game.crashed && game.snapshot(1).boxRewardSerial === 0; i++) {
        game.step({ ...idle, suction: true, fire: true });
      }
      const state = game.snapshot(1);
      assert.equal(state.boxRewardSerial, 1, `${kind} box did not open`);
      assert.equal(state.boxRewardEvents[0].reward.kind, kind);
      if (kind === 'health') {
        assert.equal(state.health, 75);
        assert.ok(state.weapon.ammo < state.weapon.capacity);
      } else {
        assert.equal(state.health, 50);
        assert.equal(state.weapon.id, 'twin-gun');
        assert.equal(state.weapon.ammo, state.weapon.capacity);
        assert.equal(game.weapon.ammoFor('machine-gun'), otherAmmo);
      }
      assert.equal(game.boxRewards.open(spec), null, 'the same box paid twice');
    } finally { game.dispose(); }
  }
});

test('a shield protects hull and armor against actual obstacles and police until it expires', () => {
  const spec = new TrackGenerator().chunk(2).hazards[0];
  const game = new GamePhysics(spec.x - 4, { id: 'machine-gun', xp: 0, carUpgrades: { armor: 4 } });
  game.boxRewards.random = () => .66; game.boxRewards.open(box('shield'));
  try {
    for (let i = 0; i < 120 && game.car.translation().x < spec.x + 4; i++) game.step(idle);
    assert.equal(game.snapshot(1).health, 200); assert.equal(game.snapshot(1).armorMask, 15);
    assert.equal(game.snapshot(1).impactSerial, 0);
    assert.equal(game.chunks.get(2).hazards[0].health, 0, 'shielded car still shatters an obstacle');
    const contactPolice = () => {
      game.pursuit.gap = 3.85; game.pursuit.x = game.car.translation().x - 3.85;
      game.pursuit.idleSeconds = 20; game.pursuit.visibility = 1;
      game.step(idle);
    };
    contactPolice(); assert.equal(game.snapshot(1).health, 200); assert.equal(game.snapshot(1).impactSerial, 0);
    game.boxRewards.step(20); contactPolice();
    assert.equal(game.snapshot(1).health, 175); assert.equal(game.snapshot(1).impactSerial, 1);
  } finally { game.dispose(); }
});

test('unlimited boost works with an empty tank, preserves fuel and returns to limited boost after expiry', () => {
  const game = new GamePhysics(-48);
  game.charge = 0; game.boostExhausted = true;
  game.boxRewards.random = () => .78; game.boxRewards.open(box('boost'));
  try {
    for (let i = 0; i < 180; i++) game.step({ ...idle, boost: true });
    assert.equal(game.snapshot(1).boostActive, true); assert.ok(game.snapshot(1).speed > 25);
    assert.equal(game.snapshot(1).boost, 0, 'power-up must not debit or refill the saved tank');
    game.boxRewards.step(20); game.step({ ...idle, boost: true });
    assert.equal(game.snapshot(1).unlimitedBoostRemaining, 0); assert.equal(game.snapshot(1).boostActive, false);
  } finally { game.dispose(); }
});

test('ground crates stay still, air crates have two jets, and larger purple smoke curves downwind and pauses', () => {
  const visual = new RandomBoxVisuals();
  const specs = [box('ground'), { ...box('air'), x: 55, y: 7, airborne: true }];
  try {
    visual.update(specs, .5, true);
    const ground = visual.group.getObjectByName('ground'); const air = visual.group.getObjectByName('air');
    assert.equal(ground.children.filter(child => child.name === 'box-jet-nozzle').length, 0);
    assert.equal(air.children.filter(child => child.name === 'box-jet-nozzle').length, 2);
    const puffs=[];
    for(let index=0;index<visual.smoke.count/2;index++) {
      const matrix=new Matrix4(); visual.smoke.getMatrixAt(index,matrix);
      puffs.push({position:new Vector3().setFromMatrixPosition(matrix),scale:new Vector3().setFromMatrixScale(matrix)});
    }
    assert.ok(puffs.length>=24,'the larger plume must have enough overlapping puffs');
    assert.ok(Math.max(...puffs.map(puff=>puff.position.y-specs[0].y))>4,'the plume must rise well above the original short smoke');
    assert.ok(Math.max(...puffs.map(puff=>puff.scale.x))>2,'the upper smoke must spread wider than the crate');
    puffs.sort((a,b)=>a.position.y-b.position.y);
    const meanX=list=>list.reduce((sum,puff)=>sum+puff.position.x,0)/list.length;
    const low=meanX(puffs.slice(0,8)); const middle=meanX(puffs.slice(12,20)); const high=meanX(puffs.slice(-8));
    assert.ok(high<specs[0].x-1,'the plume must drift left with the wind');
    assert.ok(middle-low>high-middle+.1,'the wind bend must strengthen as smoke rises');
    const position = ground.position.clone(); const instances = [...visual.smoke.instanceMatrix.array];
    visual.update(specs, 5, false);
    assert.ok(ground.position.equals(position)); assert.deepEqual([...visual.smoke.instanceMatrix.array], instances);
    visual.update(specs, .5, true);
    assert.ok(ground.position.equals(position)); assert.notDeepEqual([...visual.smoke.instanceMatrix.array], instances);
    visual.update([], 0, false); assert.equal(visual.smoke.count, 0); assert.equal(visual.group.getObjectByName('air'), undefined);
  } finally { visual.dispose(); }
});

test('shot ground crates unfold four hinged walls outward, stop smoking, pause and expire without replay', () => {
  const visual=new RandomBoxVisuals(); const spec=box('unfolding'); const event=boxEvent(spec);
  const directions=[['left','z',1],['right','z',-1],['front','x',1],['back','x',-1]];
  try {
    visual.update([spec],0,true);
    const crate=visual.group.getObjectByName(spec.id); const origin=crate.position.clone();
    assert.equal(crate.children.filter(child=>child.name.startsWith('box-flap-')).length,4);
    assert.ok(visual.smoke.count>0);
    const closed=Object.fromEntries(directions.map(([name])=>[name,
      crate.getObjectByName(`box-flap-${name}`).localToWorld(new Vector3(0,.6,0))]));
    visual.update([],0,true,[event],1);
    assert.equal(crate.userData.mode,'opening'); assert.equal(visual.smoke.count,0);
    visual.update([],.25,true,[{...event,age:.25}],1);
    const angles=directions.map(([name,axis])=>crate.getObjectByName(`box-flap-${name}`).rotation[axis]);
    const age=crate.userData.age;
    visual.update([],10,false,[{...event,age:.25}],1);
    assert.equal(crate.userData.age,age); assert.ok(crate.position.equals(origin));
    assert.deepEqual(directions.map(([name,axis])=>crate.getObjectByName(`box-flap-${name}`).rotation[axis]),angles);
    visual.update([],.4,true,[{...event,age:.65}],1);
    for(const [name,axis,direction] of directions) {
      const flap=crate.getObjectByName(`box-flap-${name}`);
      assert.ok(Math.abs(flap.rotation[axis]-direction*1.48)<1e-8,`${name} must unfold outward`);
      assert.notEqual(crate.getObjectByName(`box-roof-${name}`).rotation[axis],0,'each roof petal must follow its wall');
      const opened=flap.localToWorld(new Vector3(0,.6,0));
      if(name==='left') assert.ok(opened.x<closed[name].x-.5);
      else if(name==='right') assert.ok(opened.x>closed[name].x+.5);
      else if(name==='front') assert.ok(opened.z>closed[name].z+.5);
      else assert.ok(opened.z<closed[name].z-.5);
    }
    assert.ok(crate.position.equals(origin),'a grounded box must open in place');
    visual.update([],2.36,true,[],1);
    assert.equal(visual.group.getObjectByName(spec.id),undefined);
    visual.update([],1,true,[event],1);
    assert.equal(visual.group.getObjectByName(spec.id),undefined,'an old reward serial must not replay its opening');
    visual.update([spec],0,false,[],0);
    const reset=visual.group.getObjectByName(spec.id);
    assert.equal(reset.userData.mode,'idle'); assert.ok(visual.smoke.count>0);
    for(const [name,axis] of directions) assert.equal(reset.getObjectByName(`box-flap-${name}`).rotation[axis],0);
  } finally {visual.dispose();}
});

test('shot air crates ignite jets separately, accelerate upward, honor late events and never replay a consumed serial', () => {
  const visual=new RandomBoxVisuals(); const spec={...box('launching'),airborne:true,y:7,phase:1.1}; const event=boxEvent(spec);
  const unchanged=JSON.stringify(event);
  try {
    visual.update([spec],0,true);
    visual.update([],0,true,[event],1);
    const crate=visual.group.getObjectByName(spec.id);
    assert.equal(crate.userData.mode,'launching'); assert.equal(visual.smoke.count,0);
    const flames=crate.children.filter(child=>child.name==='box-jet-flame');
    const delays=flames.map(flame=>flame.userData.ignitionDelay);
    assert.equal(delays.length,2); assert.ok(delays.every(delay=>delay>=.05&&delay<=.30));
    assert.ok(Math.abs(delays[0]-delays[1])>.01,'the two jets must not ignite together');
    const midpoint=(Math.min(...delays)+Math.max(...delays))/2;
    visual.update([],midpoint,true,[event],1);
    assert.equal(flames.filter(flame=>flame.userData.ignited).length,1);
    assert.ok(crate.position.y>spec.y);
    const paused={position:crate.position.clone(),rotation:crate.rotation.clone(),age:crate.userData.age,powers:flames.map(flame=>flame.scale.y)};
    visual.update([],20,false,[event],1);
    assert.ok(crate.position.equals(paused.position)); assert.ok(crate.rotation.equals(paused.rotation));
    assert.equal(crate.userData.age,paused.age); assert.deepEqual(flames.map(flame=>flame.scale.y),paused.powers);
    visual.update([],Math.max(...delays)-midpoint+.4,true,[event],1);
    assert.equal(flames.filter(flame=>flame.userData.ignited).length,2);
    assert.ok(flames.every(flame=>flame.scale.y>3),'ignited jets must visibly intensify');
    assert.ok(crate.position.y>paused.position.y+.5);
    const lateSpec={...spec,id:'late-launch'}; const late=boxEvent(lateSpec,2,1.5);
    visual.update([],0,true,[late],2);
    const caughtUp=visual.group.getObjectByName(lateSpec.id);
    assert.equal(caughtUp.userData.age,1.5);
    assert.ok(caughtUp.position.y>lateSpec.y+5,'missed frames must not restart the launch on the ground');
    visual.update([],3.1,true,[],2);
    assert.equal(visual.group.getObjectByName(spec.id),undefined);
    assert.equal(visual.group.getObjectByName(lateSpec.id),undefined);
    visual.update([],1,true,[{...late,age:0}],2);
    assert.equal(visual.group.getObjectByName(lateSpec.id),undefined);
    assert.equal(JSON.stringify(event),unchanged,'visual animation must not mutate a reward event');
  } finally {visual.dispose();}
});

test('the magnetic layer stays on for 17 seconds, blinks for the last 3 and turns off at expiry or wreck', () => {
  const visual = new MagneticShield();
  try {
    for (const remaining of [20, 10, 3.01]) { visual.update(remaining, .1, true); assert.equal(visual.group.visible, true); }
    visual.update(3, .1, true); assert.equal(visual.group.visible, true);
    visual.update(2.84, 0, false); assert.equal(visual.group.visible, false);
    visual.update(2.70, .1, true); assert.equal(visual.group.visible, true);
    visual.update(0, .1, true); assert.equal(visual.group.visible, false);
    visual.update(10, .1, true, true); assert.equal(visual.group.visible, false);
  } finally { visual.dispose(); }
});
