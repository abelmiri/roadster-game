import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
let WEAPONS, VehicleWeapon, WeaponLoadout, canEquip, WeaponVisual, CombatVisual;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-weapon-tests');
  await build({entryPoints:['src/game/weapons.ts','src/game/weaponVisual.ts'],bundle:true,
    platform:'node',format:'esm',outdir,outExtension:{'.js':'.mjs'}});
  ({WEAPONS,VehicleWeapon,WeaponLoadout,canEquip} = await import(pathToFileURL(path.join(outdir,'weapons.mjs')).href));
  ({WeaponVisual,CombatVisual} = await import(pathToFileURL(path.join(outdir,'weaponVisual.mjs')).href));
});
const pose = {x:0,y:0,angle:0,vx:0,vy:0};
function advance(weapon, seconds, controls={}, targets=[], onDamage=()=>{}) {
  for(let i=0;i<Math.round(seconds*120);i++) weapon.step(1/120,controls,pose,targets,onDamage);
}
test('all eight reference weapons unlock at exact XP boundaries; equipment persists and invalid saves recover',()=>{
  assert.equal(WEAPONS.length,8);
  const store=new Map(); const storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)};
  for(const spec of WEAPONS){
    assert.equal(canEquip(spec.id,spec.xp),true);
    assert.equal(canEquip(spec.id,spec.xp-1),false);
    const loadout=new WeaponLoadout(0,storage);
    assert.equal(loadout.select(spec.id,spec.xp),true);
    assert.equal(new WeaponLoadout(spec.xp,storage).selected,spec.id);
    if(spec.xp>0)assert.equal(new WeaponLoadout(0,storage).selected,'machine-gun');
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
    weapon.equip('plasma-cannon',950);weapon.equip(spec.id,950);
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
