import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
let ImpactCamera, VIEW_HALF_HEIGHT, CRASH_ZOOM, CAMERA_LOOK_AHEAD;
before(async()=>{
  const outdir=path.resolve('node_modules/.cache/roadster-camera-tests');
  await build({entryPoints:['src/game/impactCamera.ts'],bundle:true,platform:'node',format:'esm',outdir,outExtension:{'.js':'.mjs'}});
  ({ImpactCamera,VIEW_HALF_HEIGHT,CRASH_ZOOM,CAMERA_LOOK_AHEAD}=await import(pathToFileURL(path.join(outdir,'impactCamera.mjs')).href));
});
const contact={serial:1,x:22,y:3,kind:'collision'};
test('the ordinary view is 20% wider; collisions zoom 70% toward the car and contact, then ease back',()=>{
  assert.ok(Math.abs(VIEW_HALF_HEIGHT-10.8*1.2)<1e-9);
  assert.equal(CAMERA_LOOK_AHEAD, .27 * 1.2);
  const camera=new ImpactCamera();
  camera.update([contact],1,false,.04);
  assert.ok(camera.zoom>1&&camera.zoom<1.7);
  camera.update([contact],1,false,.06);
  assert.equal(camera.zoom,1.7);
  assert.deepEqual(camera.focus({x:20,y:5}),{x:21,y:4});
  camera.update([contact],1,false,.4);
  assert.equal(camera.zoom,1.7);
  camera.update([contact],1,false,.32);
  assert.ok(camera.zoom>1&&camera.zoom<1.7);
  camera.update([contact],1,false,1);
  assert.equal(camera.zoom,1);
});
test('hit stop uses display time; manual pause holds framing and bullets never retrigger the zoom',()=>{
  const camera=new ImpactCamera();
  camera.update([contact],1,false,.1);
  const zoom=camera.zoom;
  camera.update([contact],1,false,20,false);
  assert.equal(camera.zoom,zoom);
  camera.update([contact,{...contact,serial:2,kind:'projectile'}],2,false,.8);
  assert.ok(camera.zoom<1.7);
  camera.update([],0,false,0);
  assert.equal(camera.zoom,1,'restart must clear the impact camera');
});

test('the game-over view takes two real seconds to reach 50% zoom and holds the fatal position',()=>{
  const camera=new ImpactCamera();
  const fatal={x:40,y:3};
  camera.update([contact],1,true,.1,true,fatal);
  assert.ok(camera.zoom>1&&camera.zoom<1.5);
  assert.deepEqual(camera.focus({x:80,y:-4}),fatal);
  camera.update([{...contact,serial:2,x:120,y:0}],2,true,.9,true,{x:120,y:0});
  assert.equal(camera.zoom,1.25,'one real second is halfway through the zoom');
  camera.update([],2,true,.999,true,{x:120,y:0});
  assert.ok(camera.zoom<1.5,'the transition must not finish before two real seconds');
  camera.update([],2,true,.001,true,{x:120,y:0});
  assert.equal(CRASH_ZOOM,1.5);
  assert.equal(camera.zoom,1.5);
  assert.equal(camera.amount,1);
  assert.deepEqual(camera.focus({x:120,y:0}),fatal,'wreck contacts cannot move the original framing');
  camera.update([],2,true,30,true,{x:300,y:-10});
  assert.equal(camera.zoom,1.5,'the zoom must persist for the whole restart menu');
  assert.deepEqual(camera.focus({x:300,y:-10}),fatal);
});

test('a fatal hit transitions smoothly from an existing impact zoom instead of stacking zoom factors',()=>{
  const camera=new ImpactCamera();
  camera.update([contact],1,false,.1);
  assert.equal(camera.zoom,1.7);
  const fatal={...contact,serial:2,x:50,y:2};
  camera.update([contact,fatal],2,true,0);
  assert.equal(camera.zoom,1.7,'entering the final crash must not snap the zoom');
  camera.update([fatal],2,true,1);
  assert.ok(camera.zoom>1.5&&camera.zoom<1.7);
  camera.update([fatal],2,true,1);
  assert.equal(camera.zoom,1.5);
  assert.deepEqual(camera.focus({x:70,y:0}),{x:50,y:2});
});

test('falls use the captured crash position; pausing holds the transition and restarting clears it',()=>{
  const camera=new ImpactCamera();
  camera.update([contact],1,false,2);
  const fatal={x:300,y:-8};
  camera.update([],1,true,.1,true,fatal);
  assert.deepEqual(camera.focus({x:350,y:-10}),fatal,'a fall cannot reuse an earlier road collision');
  const zoom=camera.zoom;
  camera.update([],1,true,10,false,fatal);
  assert.equal(camera.zoom,zoom);
  camera.update([],1,true,1.9,true,fatal);
  assert.equal(camera.zoom,1.5);
  camera.update([],0,false,0);
  assert.equal(camera.zoom,1);
  assert.equal(camera.amount,0);
  camera.update([contact],1,false,.1);
  assert.equal(camera.zoom,1.7);
  assert.deepEqual(camera.focus({x:20,y:5}),{x:21,y:4});
});
