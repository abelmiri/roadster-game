import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
let WEAPONS, VehicleWeapon, WeaponLoadout, canEquip, weaponSpec, weaponUpgradeCost, WeaponVisual, CombatVisual;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-weapon-tests');
  await build({entryPoints:['src/game/weapons.ts','src/game/weaponVisual.ts'],bundle:true,
    platform:'node',format:'esm',outdir,outExtension:{'.js':'.mjs'}});
  ({WEAPONS,VehicleWeapon,WeaponLoadout,canEquip,weaponSpec,weaponUpgradeCost} = await import(pathToFileURL(path.join(outdir,'weapons.mjs')).href));
  ({WeaponVisual,CombatVisual} = await import(pathToFileURL(path.join(outdir,'weaponVisual.mjs')).href));
});
const pose = {x:0,y:0,angle:0,vx:0,vy:0};
function advance(weapon, seconds, controls={}, targets=[], onDamage=()=>{}) {
  for(let i=0;i<Math.round(seconds*120);i++) weapon.step(1/120,controls,pose,targets,onDamage);
}
test('every weapon gains 15 percent range, including upgraded equipment',()=>{
  const previousRanges=[43.7,46,46,48.3,50.6,55.2,50.6,52.9];
  for(const [index,spec] of WEAPONS.entries()){
    assert.ok(Math.abs(spec.range-previousRanges[index]*1.15)<1e-9,spec.id);
    for(let level=1;level<=5;level++)assert.equal(weaponSpec(spec.id,level).range,spec.range);
  }
  for(const id of ['machine-gun','laser-gun']){
    const oldRange=previousRanges[WEAPONS.findIndex(spec=>spec.id===id)];
    const inRange={id:'near',kind:'hazard',x:oldRange+4,y:1.08,radius:.2,health:10};
    const weapon=new VehicleWeapon(id);
    weapon.step(1/120,{fire:true},pose,[inRange],()=>{},()=>-100);
    advance(weapon,1.2,{},[inRange]);
    assert.ok(inRange.health<10,`${id} did not reach beyond its old range`);
    const outOfRange={id:'far',kind:'hazard',x:weaponSpec(id).range+5,y:1.08,radius:.2,health:10};
    const second=new VehicleWeapon(id);
    second.step(1/120,{fire:true},pose,[outOfRange],()=>{},()=>-100);
    advance(second,1.2,{},[outOfRange]);
    assert.equal(outOfRange.health,10,`${id} exceeded its new range`);
  }
});
test('all eight reference weapons unlock at exact XP boundaries; equipment persists and invalid saves recover',()=>{
  assert.equal(WEAPONS.length,8);
  assert.deepEqual(WEAPONS.map(spec=>spec.xp),[0,200,500,900,1400,2000,2800,3800]);
  assert.deepEqual(WEAPONS.map(spec=>spec.price),[0,1000,2000,3000,4000,5000,6000,7000]);
  const store=new Map(); const storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)};
  const owned=new Set(['machine-gun']); const owns=id=>owned.has(id);
  for(const spec of WEAPONS){
    assert.equal(canEquip(spec.id,spec.xp),true);
    assert.equal(canEquip(spec.id,spec.xp-1),false);
    const loadout=new WeaponLoadout(0,storage,owns);
    if(spec.price>0)assert.equal(loadout.select(spec.id,spec.xp),false,'XP cannot bypass ownership');
    owned.add(spec.id);
    assert.equal(loadout.select(spec.id,spec.xp),true);
    assert.equal(new WeaponLoadout(spec.xp,storage,owns).selected,spec.id);
    if(spec.xp>0)assert.equal(new WeaponLoadout(0,storage,owns).selected,'machine-gun');
  }
  for(const bad of ['unknown','<script>',null]){
    store.set('roadster-weapon',bad);
    assert.equal(new WeaponLoadout(950,storage).selected,'machine-gun');
  }
  assert.equal(new WeaponLoadout(950,{getItem(){throw Error()},setItem(){throw Error()}}).selected,'machine-gun');
});
test('turning takes simulation time, blocks fire until aligned, and can be reversed smoothly',()=>{
  for(const spec of WEAPONS){
    const weapon=new VehicleWeapon(spec.id);
    advance(weapon,spec.turnSeconds/2,{aim:-1,fire:true});
    let state=weapon.snapshot();
    assert.ok(state.yaw>1.4&&state.yaw<1.8,spec.id);
    assert.equal(state.ammo,spec.ammo);
    const halfway=state.yaw;
    weapon.step(1/120,{aim:1,fire:true},pose,[],()=>{});
    assert.ok(weapon.snapshot().yaw<halfway&&weapon.snapshot().yaw>0);
    advance(weapon,spec.turnSeconds,{aim:-1,fire:true});
    state=weapon.snapshot();
    assert.equal(state.yaw,Math.PI);
    assert.equal(state.turnRemaining,0);
    assert.ok(state.ammo<spec.ammo);
    if(state.projectiles.length&&spec.id!=='laser-gun')assert.ok(state.projectiles.at(-1).vx<0);
  }
});
test('ammo is finite, cadence is fixed-step, and switching never refills a weapon',()=>{
  for(const spec of WEAPONS){
    const weapon=new VehicleWeapon(spec.id);
    advance(weapon,spec.interval*2.5,{fire:true});
    assert.equal(weapon.snapshot().shotSerial,3,spec.id);
    assert.equal(weapon.snapshot().ammo,spec.ammo-3*spec.barrels,spec.id);
    assert.equal(weapon.equip('cannon',0),false);
    const remaining=weapon.snapshot().ammo;
    weapon.equip('plasma-cannon',3800);weapon.equip(spec.id,3800);
    assert.equal(weapon.snapshot().ammo,remaining);
    advance(weapon,30,{fire:true});
    assert.equal(weapon.snapshot().ammo,0);
    const shots=weapon.snapshot().shotSerial;
    advance(weapon,2,{fire:true});
    assert.equal(weapon.snapshot().shotSerial,shots);
    assert.equal(new VehicleWeapon(spec.id).snapshot().ammo,spec.ammo);
    assert.ok(weapon.snapshot().projectiles.length<=64);
  }
});
test('an ammo pickup refills the selected weapon to its upgraded capacity only',()=>{
  const weapon=new VehicleWeapon('machine-gun');
  weapon.setUpgradeLevel('twin-gun',2);
  advance(weapon,.5,{fire:true});
  const machineAmmo=weapon.ammoFor('machine-gun');
  assert.equal(weapon.equip('twin-gun',200),true);
  advance(weapon,.5,{fire:true});
  const missing=weapon.snapshot().capacity-weapon.snapshot().ammo;
  assert.ok(missing>0);
  assert.equal(weapon.refillActive(),missing);
  assert.equal(weapon.snapshot().ammo,weapon.snapshot().capacity);
  assert.equal(weapon.ammoFor('machine-gun'),machineAmmo);
  assert.equal(weapon.refillActive(),0);
});
test('swept bullets hit small targets between frames, and front/back fire damages only its path',()=>{
  for(const direction of [1,-1]){
    const weapon=new VehicleWeapon();
    advance(weapon,.6,{aim:direction});
    const target={id:'barrier',kind:'hazard',x:direction*9,y:1.08,radius:.03,health:1};
    const untouched={id:'other',kind:'hazard',x:-direction*9,y:1.08,radius:.3,health:3};
    advance(weapon,.4,{aim:direction,fire:true},[target,untouched]);
    assert.equal(target.health,0);
    assert.equal(untouched.health,3);
    assert.equal(weapon.snapshot().destroySerial,1);
  }
});
test('laser hits instantly; rockets/plasma splash nearby targets without damaging distant ones',()=>{
  const laser=new VehicleWeapon('laser-gun');
  const target={id:'drone',kind:'hazard',x:20,y:1.08,radius:.65,health:4};
  laser.step(1/120,{fire:true},pose,[target],()=>{});
  assert.equal(target.health,2);
  assert.ok(laser.snapshot().projectiles[0].beamEndX<20);
  for(const id of ['cannon','rocket-launcher','plasma-cannon']){
    const weapon=new VehicleWeapon(id);
    const targets=[{id:'main',kind:'hazard',x:9,y:1.08,radius:.65,health:3},
      {id:'near',kind:'hazard',x:9.7,y:1.08,radius:.3,health:2},
      {id:'far',kind:'hazard',x:17,y:1.08,radius:.3,health:3}];
    advance(weapon,.35,{fire:true},targets);
    assert.equal(targets[0].health,0,id);assert.equal(targets[1].health,0,id);assert.equal(targets[2].health,3,id);
  }
});
test('all weapons hit an elevated target while driving or boosting at high speed',()=>{
  for(const speed of [27,60])for(const spec of WEAPONS){
    const weapon=new VehicleWeapon(spec.id);
    const target={id:'drone',kind:'hazard',x:13,y:4.2,radius:.4,health:100};
    const movingPose={x:0,y:0,angle:0,vx:speed,vy:0};
    for(let frame=0;frame<120;frame++){
      movingPose.x=speed*frame/120;
      weapon.step(1/120,{fire:frame===0},movingPose,[target],()=>{},()=>-100);
    }
    assert.ok(target.health<100,`${spec.id} at ${speed} m/s missed`);
  }
});
test('non-homing shots lead a moving airborne target at high speed',()=>{
  for(const spec of WEAPONS.filter(spec=>spec.id!=='missile-launcher'&&spec.id!=='laser-gun')){
    const weapon=new VehicleWeapon(spec.id);
    const target={id:'drone',kind:'hazard',x:30,y:3.2,vx:-2,vy:3,radius:.38,health:100};
    const movingPose={x:0,y:0,angle:0,vx:60,vy:0};
    for(let frame=0;frame<120;frame++){
      movingPose.x=60*frame/120;
      target.x=30+target.vx*frame/120;
      target.y=3.2+target.vy*frame/120;
      weapon.step(1/120,{fire:frame===0},movingPose,[target],()=>{},()=>-100);
    }
    assert.ok(target.health<100,`${spec.id} did not lead the moving target`);
  }
});
test('rear-facing weapons still lead targets when the car outruns slow projectiles',()=>{
  for(const speed of [27,60])for(const spec of WEAPONS){
    const weapon=new VehicleWeapon(spec.id);
    const target={id:'rear',kind:'hazard',x:-13,y:3.2,radius:.4,health:100};
    const movingPose={x:0,y:0,angle:0,vx:speed,vy:0};
    for(let frame=0;frame<150;frame++)weapon.step(1/120,{aim:-1},movingPose,[target],()=>{},()=>-100);
    for(let frame=0;frame<300;frame++){
      movingPose.x=speed*frame/120;
      weapon.step(1/120,{fire:frame===0,aim:-1},movingPose,[target],()=>{},()=>-100);
    }
    assert.ok(target.health<100,`${spec.id} missed the rear target at ${speed} m/s`);
  }
});
test('missiles steer toward a moving target and release the lock after its destruction',()=>{
  const weapon=new VehicleWeapon('missile-launcher');
  const target={id:'moving',kind:'hazard',x:20,y:1.08,radius:.7,health:7};
  weapon.step(1/120,{fire:true},pose,[target],()=>{});
  assert.equal(weapon.snapshot().projectiles[0].targetId,'moving');
  let hit=false;
  for(let i=0;i<120;i++){
    target.y+=.012;
    weapon.step(1/120,{},pose,[target],()=>{hit=true});
  }
  assert.equal(hit,true);assert.equal(target.health,0);
});
test('terrain blocks bullets and laser beams before an occluded target',()=>{
  for(const id of ['machine-gun','laser-gun']){
    const weapon=new VehicleWeapon(id);
    const target={id:'occluded',kind:'hazard',x:20,y:1.08,radius:.65,health:3};
    for(let i=0;i<90;i++)weapon.step(1/120,{fire:true},pose,[target],()=>{},x=>x>7&&x<12?3:-10);
    assert.equal(target.health,3,id);
  }
});

test('bullet and laser impacts report the incoming direction on terrain and surviving police',()=>{
  for(const id of ['machine-gun','laser-gun'])for(const direction of [1,-1]){
    const weapon=new VehicleWeapon(id);advance(weapon,.7,{aim:direction});
    const target={id:'police',kind:'police',x:direction*9,y:1.08,radius:.7,health:12};
    const impacts=[];
    for(let i=0;i<60&&!impacts.length;i++)weapon.step(1/120,{fire:i===0,aim:direction},pose,[target],()=>{},()=>-10,hit=>impacts.push(hit));
    assert.equal(impacts.length,1,id);
    assert.equal(impacts[0].surface,'police');
    assert.equal(impacts[0].destroyed,false);
    assert.ok(impacts[0].directionX*direction>.9);
    assert.ok(Math.abs(Math.hypot(impacts[0].directionX,impacts[0].directionY)-1)<1e-9);
    assert.ok(target.health>0&&target.health<12);
    const groundWeapon=new VehicleWeapon(id);
    const ground=[];
    const floor=x=>x>5?.85+(x-5)*.3:-10;
    for(let i=0;i<60&&!ground.length;i++)groundWeapon.step(1/120,{fire:i===0},pose,[],()=>{},floor,hit=>ground.push(hit));
    assert.equal(ground.length,1,id);
    assert.equal(ground[0].surface,'terrain');
    assert.equal(ground[0].destroyed,false);
    assert.ok(Math.abs(ground[0].x-5)<.02);
    assert.ok(ground[0].directionX>.99);
    assert.equal(groundWeapon.snapshot().destroySerial,0);
  }
});
test('all eight 3D models animate from snapshots, reuse projectile/effect pools, and dispose cleanly',()=>{
  const visual=new WeaponVisual();const combat=new CombatVisual();
  const pool=combat.group.children.length;
  for(const spec of WEAPONS){
    const weapon=new VehicleWeapon(spec.id);advance(weapon,.2,{fire:true});
    visual.update(weapon.snapshot());combat.update(weapon.snapshot());
    assert.equal(visual.group.children.length,1);
    assert.ok(visual.group.children[0].children.length>1);
    assert.equal(combat.group.children.length,pool);
  }
  visual.dispose();combat.dispose();
  assert.equal(visual.group.children.length,0);
});

test('five upgrades scale power, rate, and whole-round capacity, with increasing coin prices', () => {
  assert.deepEqual([0,1,2,3,4].map(level => weaponUpgradeCost('twin-gun', level)), [500,625,782,977,1221]);
  assert.equal(weaponUpgradeCost('machine-gun', 0), 500);
  assert.equal(weaponUpgradeCost('plasma-cannon', 0), 3500);
  for (const invalid of [-1, 5, 1.5, NaN]) assert.equal(weaponUpgradeCost('twin-gun', invalid), null);
  assert.equal(weaponUpgradeCost('unknown', 0), null);
  for (const base of WEAPONS) {
    for (let level = 1; level <= 5; level++) {
      const spec = weaponSpec(base.id, level);
      const factor = 1 + .2 * level;
      assert.ok(Math.abs(spec.damage - base.damage * factor) < 1e-9);
      assert.ok(Math.abs(spec.interval - base.interval / factor) < 1e-9);
      assert.equal(spec.ammo, Math.ceil(base.ammo * factor / base.barrels) * base.barrels);
      assert.ok(spec.ammo > weaponSpec(base.id, level - 1).ammo);
      assert.equal(spec.price, base.price);
    }
    assert.equal(weaponSpec(base.id, 5).damage, base.damage * 2);
    assert.equal(weaponSpec(base.id, 5).ammo, base.ammo * 2);
    assert.equal(weaponSpec(base.id, 99), weaponSpec(base.id, 5));
    assert.equal(weaponSpec(base.id, NaN), base);
  }
});

test('upgrades actually increase every gun’s firing cadence and hit damage', () => {
  for (const base of WEAPONS) {
    const normal = new VehicleWeapon(base.id);
    const upgraded = new VehicleWeapon(base.id, { [base.id]: 1 });
    advance(normal, 3, { fire: true }); advance(upgraded, 3, { fire: true });
    assert.ok(upgraded.snapshot().shotSerial > normal.snapshot().shotSerial, base.id);
    for (const level of [1,5]) {
      const gun = new VehicleWeapon(base.id, { [base.id]: level });
      const target = { id:'target', kind:'police', x:9, y:1.08, radius:.7, health:1000 };
      gun.step(1/120, { fire: true }, pose, [target], () => {});
      advance(gun, .6, {}, [target]);
      const damage = weaponSpec(base.id, level).damage * base.barrels;
      assert.ok(Math.abs((1000 - target.health) - damage) < 1e-8, `${base.id}, level ${level}`);
    }
  }
});

test('capacity upgrades add only new slots and cannot refill spent rounds by reapplying or switching', () => {
  for (const base of WEAPONS) {
    const gun = new VehicleWeapon(base.id);
    gun.step(1/120, { fire:true }, pose, [], () => {});
    gun.setUpgradeLevel(base.id, 1);
    const capacity = weaponSpec(base.id, 1).ammo;
    assert.equal(gun.snapshot().capacity, capacity);
    assert.equal(gun.snapshot().ammo, capacity - base.barrels);
    gun.setUpgradeLevel(base.id, 1); gun.setUpgradeLevel(base.id, 0);
    gun.equip('machine-gun', 3800); gun.equip(base.id, 3800);
    assert.equal(gun.snapshot().ammo, capacity - base.barrels);
    assert.equal(gun.snapshot().level, 1);
    assert.equal(new VehicleWeapon(base.id, { [base.id]:1 }).snapshot().ammo, capacity);
  }
});

test('projectiles retain their launch damage when a gun is upgraded or switched mid-flight', () => {
  const gun = new VehicleWeapon();
  const target = { id:'target', kind:'police', x:20, y:1.08, radius:.7, health:12 };
  gun.step(1/120, { fire:true }, pose, [target], () => {});
  assert.equal(gun.snapshot().projectiles[0].upgradeLevel, 0);
  gun.setUpgradeLevel('machine-gun', 5); gun.equip('twin-gun',200);
  advance(gun, .5, {}, [target]);
  assert.equal(target.health, 11, 'an existing bullet must keep its original damage');
});

test('fractional upgraded damage destroys a patrol at exactly zero without a floating-point extra hit', () => {
  const gun = new VehicleWeapon('machine-gun', { 'machine-gun': 1 });
  const target = { id:'police', kind:'police', x:8, y:1.08, radius:.7, health:12 };
  for (let i=0; i<300; i++) {
    const firing = gun.snapshot().shotSerial < 10;
    gun.step(1/120, { fire:firing }, pose, [target], () => {});
  }
  assert.equal(gun.snapshot().shotSerial, 10);
  assert.equal(target.health, 0);
  assert.equal(gun.snapshot().destroySerial, 1);
});
