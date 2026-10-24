import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
let ImpactCamera, VIEW_HALF_HEIGHT;
before(async()=>{
  const outdir=path.resolve('node_modules/.cache/roadster-camera-tests');
  await build({entryPoints:['src/game/impactCamera.ts'],bundle:true,platform:'node',format:'esm',outdir,outExtension:{'.js':'.mjs'}});
  ({ImpactCamera,VIEW_HALF_HEIGHT}=await import(pathToFileURL(path.join(outdir,'impactCamera.mjs')).href));
});
const contact={serial:1,x:22,y:3,kind:'collision'};
test('the ordinary view is 20% wider; collisions zoom 70% toward the car and contact, then ease back',()=>{
  assert.ok(Math.abs(VIEW_HALF_HEIGHT-10.8*1.2)<1e-9);
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
