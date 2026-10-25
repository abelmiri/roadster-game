import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
let ImpactCamera, DrivingCamera, VIEW_HALF_HEIGHT, CRASH_ZOOM, CAMERA_LOOK_AHEAD;
before(async()=>{
  const outdir=path.resolve('node_modules/.cache/roadster-camera-tests');
  await build({entryPoints:['src/game/impactCamera.ts','src/game/drivingCamera.ts'],bundle:true,platform:'node',format:'esm',outdir,outExtension:{'.js':'.mjs'}});
  ({ImpactCamera,VIEW_HALF_HEIGHT,CRASH_ZOOM,CAMERA_LOOK_AHEAD}=await import(pathToFileURL(path.join(outdir,'impactCamera.mjs')).href));
  ({DrivingCamera}=await import(pathToFileURL(path.join(outdir,'drivingCamera.mjs')).href));
});

const driving = {speed:18,height:0,verticalSpeed:0,grounded:true,loopView:0,crashed:false};

test('high speed smoothly widens the view and slowing down eases back with refresh-independent timing',()=>{
  const camera=new DrivingCamera();
  camera.update(driving,1);
  assert.equal(camera.halfHeight,VIEW_HALF_HEIGHT);
  camera.update({...driving,speed:34},1/60);
  assert.ok(camera.halfHeight>VIEW_HALF_HEIGHT&&camera.halfHeight<VIEW_HALF_HEIGHT+1);
  for(let i=0;i<180;i++)camera.update({...driving,speed:34},1/60);
  assert.ok(camera.halfHeight>VIEW_HALF_HEIGHT+6.9);
  const wide=camera.halfHeight;
  camera.update(driving,1/60);
  assert.ok(camera.halfHeight<wide&&camera.halfHeight>wide-.3);
  for(let i=0;i<360;i++)camera.update(driving,1/60);
  assert.ok(Math.abs(camera.halfHeight-VIEW_HALF_HEIGHT)<.001);
  const slow=new DrivingCamera(),fast=new DrivingCamera();
  for(let i=0;i<60;i++)slow.update({...driving,speed:30},1/30);
  for(let i=0;i<240;i++)fast.update({...driving,speed:30},1/120);
  assert.ok(Math.abs(slow.halfHeight-fast.halfHeight)<1e-9);
});

test('a tall jump anticipates ascent and keeps the complete car and road inside the smoothly tracked view',()=>{
  const camera=new DrivingCamera();
  const dt=1/120;
  let centerY=0,maxHeight=0;
  for(let i=0;i<440;i++) {
    const time=i*dt;
    const height=Math.max(0,38*time-11*time*time);
    camera.update({...driving,height,verticalSpeed:38-22*time,grounded:height===0},dt);
    centerY+=(camera.lift-centerY)*(1-Math.exp(-dt*4.2));
    assert.ok(height+2.5<centerY+camera.halfHeight,`car cropped at t=${time}`);
    assert.ok(centerY-camera.halfHeight<0,'the road should stay visible');
    maxHeight=Math.max(maxHeight,camera.halfHeight);
  }
  assert.ok(maxHeight>VIEW_HALF_HEIGHT+10);
});

test('adaptive framing holds during pause and fatal crashes, resets on restart, and retains loop framing',()=>{
  const camera=new DrivingCamera();
  camera.update({...driving,speed:34,height:24,grounded:false},2);
  const before={height:camera.halfHeight,lift:camera.lift};
  camera.update(driving,0);
  assert.deepEqual({height:camera.halfHeight,lift:camera.lift},before);
  camera.update({...driving,crashed:true},10);
  assert.deepEqual({height:camera.halfHeight,lift:camera.lift},before);
  camera.update(driving,0);
  assert.equal(camera.halfHeight,VIEW_HALF_HEIGHT);
  assert.equal(camera.lift,0);
  camera.update({...driving,speed:34,height:24,grounded:false,loopView:1},10);
  assert.ok(Math.abs(camera.halfHeight-(VIEW_HALF_HEIGHT+1.7))<1e-9);
  assert.equal(camera.lift,0);
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
