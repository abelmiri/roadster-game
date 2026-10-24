import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import RAPIER from '@dimforge/rapier2d-compat';
import { build } from 'esbuild';
let PoliceWreck, PoliceVisual, CarSmoke;
before(async()=>{
  const outdir=path.resolve('node_modules/.cache/roadster-police-wreck-tests');
  await build({entryPoints:['src/game/policeWreck.ts','src/game/policeVisual.ts','src/game/smoke.ts'],bundle:true,platform:'node',format:'esm',outdir,
    outExtension:{'.js':'.mjs'},external:['@dimforge/rapier2d-compat','three']});
  await RAPIER.init();
  ({PoliceWreck}=await import(pathToFileURL(path.join(outdir,'policeWreck.mjs')).href));
  ({PoliceVisual}=await import(pathToFileURL(path.join(outdir,'policeVisual.mjs')).href));
  ({CarSmoke}=await import(pathToFileURL(path.join(outdir,'smoke.mjs')).href));
});
test('a destroyed patrol becomes exactly three independent bodies that collide with terrain and dispose cleanly',()=>{
  const world=new RAPIER.World({x:0,y:-22});world.timestep=1/120;
  world.createCollider(RAPIER.ColliderDesc.cuboid(100,.3).setTranslation(0,-.3));
  const wreck=new PoliceWreck(world,1,{x:0,y:1.2,angle:.1},12);
  try{
    assert.equal(world.bodies.len(),3);
    for(let i=0;i<240;i++){wreck.beforeStep(1/120);world.step();}
    const state=wreck.snapshot(1);
    assert.ok(Math.abs(state.age-2)<1e-8);
    assert.ok(state.body.y>0&&state.body.y<1);
    assert.ok(state.wheels.every(w=>w.y>.4));
    assert.ok(state.wheels.some(w=>Math.abs(w.x-state.body.x)>3),'police wheels remained attached');
    assert.ok(state.body.x>0);
    wreck.dispose();
    assert.equal(world.bodies.len(),0);
  }finally{world.free();}
});
test('wreck rendering moves the shell and two wheels separately and emits black engine smoke',()=>{
  const previousDocument=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>null})};
  const visual=new PoliceVisual(true);const smoke=new CarSmoke();
  try{
    const state={serial:1,age:1,body:{x:5,y:3,angle:.5},wheels:[{x:1,y:1,angle:2},{x:9,y:1,angle:-2}],speed:4};
    visual.updateWreck(state);
    assert.equal(visual.group.children.length,3);
    assert.equal(visual.body.position.x,5);
    assert.deepEqual(visual.group.children.slice(1).map(w=>w.position.x),[1,9]);
    for(let i=0;i<30;i++)smoke.updateWreck(state.body,state.speed,state.age+i/60,1/60);
    assert.ok(smoke.activeCount>8);
    const darkness=smoke.mesh.geometry.getAttribute('smokeDarkness');
    assert.ok(darkness.getX(0)>.9);
    const count=smoke.activeCount;
    smoke.updateWreck(state.body,state.speed,2,1,false);
    assert.equal(smoke.activeCount,count);
    smoke.clear();assert.equal(smoke.activeCount,0);
  }finally{visual.dispose();smoke.dispose();globalThis.document=previousDocument;}
});
