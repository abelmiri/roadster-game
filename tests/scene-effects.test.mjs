import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Matrix4, Vector3, MeshLambertMaterial } from 'three';

let CityBuildings, ObstacleDebris, CarBodyDamage, createRoadsterBody;
let CarArmorVisual, carGarageIcon;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-scene-tests');
  await build({ entryPoints: ['src/game/cityBuildings.ts', 'src/game/obstacleDebris.ts', 'src/game/carBodyDamage.ts', 'src/game/roadsterModel.ts', 'src/game/carArmor.ts', 'src/game/carGarageIcon.ts'], bundle: true,
    platform: 'node', format: 'esm', outdir, outExtension: { '.js': '.mjs' }, external: ['three'] });
  ({ CityBuildings } = await import(pathToFileURL(path.join(outdir, 'cityBuildings.mjs')).href));
  ({ ObstacleDebris } = await import(pathToFileURL(path.join(outdir, 'obstacleDebris.mjs')).href));
  ({ CarBodyDamage } = await import(pathToFileURL(path.join(outdir, 'carBodyDamage.mjs')).href));
  ({ createRoadsterBody } = await import(pathToFileURL(path.join(outdir, 'roadsterModel.mjs')).href));
  ({ CarArmorVisual } = await import(pathToFileURL(path.join(outdir, 'carArmor.mjs')).href));
  ({ carGarageIcon } = await import(pathToFileURL(path.join(outdir, 'carGarageIcon.mjs')).href));
});

function positions(mesh) {
  const matrix = new Matrix4();
  const point = new Vector3();
  const result = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    point.setFromMatrixPosition(matrix);
    result.push({ x: point.x, y: point.y, z: point.z });
  }
  return result;
}

const event = (serial, kind = 'barrier') => ({ serial, hazardId: `${serial}-${kind}`, kind,
  x: 30, y: 8, speed: 20, source: 'ram', age: 0 });

test('every hazard breaks into forward moving pooled fragments with pause and restart support', () => {
  for (const kind of ['barrier', 'drone', 'pulse']) {
    const debris = new ObstacleDebris();
    try {
      debris.update([event(1, kind)], 1, 0, false);
      const before = positions(debris.mesh);
      assert.ok(before.length >= 14);
      debris.update([event(1, kind)], 1, 1, false);
      assert.deepEqual(positions(debris.mesh), before, 'pause advanced debris');
      assert.equal(debris.activeCount, before.length, 'the same break emitted twice');
      debris.update([event(1, kind)], 1, 1 / 60);
      const after = positions(debris.mesh);
      assert.ok(after.every((piece, i) => piece.x > before[i].x && piece.y > before[i].y));
      debris.update([], 0, 0, false);
      assert.equal(debris.activeCount, 0, 'restart retained old fragments');
    } finally { debris.dispose(); }
  }
});

test('fragment storage stays bounded under repeated destruction and fully expires', () => {
  const debris = new ObstacleDebris();
  try {
    for (let i = 1; i <= 500; i++) debris.update([event(i, 'pulse')], i, 1 / 60);
    assert.ok(debris.activeCount > 0 && debris.activeCount <= 192);
    const matrixVersion = debris.mesh.instanceMatrix.version;
    debris.update([], 500, 1, false);
    assert.equal(debris.mesh.instanceMatrix.version, matrixVersion, 'frozen debris uploaded unchanged matrices');
    for (let i = 0; i < 180; i++) debris.update([], 500, 1 / 60);
    assert.equal(debris.activeCount, 0);
  } finally { debris.dispose(); }
});

test('the four reference armor pieces detach once, fall independently, pause, and restore on restart',()=>{
  const armor=new CarArmorVisual();
  const state={car:{x:10,y:4,angle:.1},armorMask:15,wrecked:false,distance:10,impactSerial:0,speed:14,suspensionOffset:0,suspensionPitch:0};
  try {
    armor.update(state,0);
    assert.equal(armor.attached.children.filter(part=>part.visible).length,4);
    assert.deepEqual(armor.attached.children.map(part=>part.name),['armor-front','armor-door','armor-roof','armor-rear']);
    for(let index=0;index<4;index++) {
      state.armorMask&=~(1<<index); state.impactSerial++;
      armor.update(state,0,false);
      assert.equal(armor.attached.children[index].visible,false);
      assert.equal(armor.debris.children[index].visible,true);
      assert.equal(armor.debris.children[index].children[0].geometry,armor.attached.children[index].children[0].geometry,'the dropped plate must retain the reference silhouette');
    }
    const before=armor.debris.children.map(part=>part.position.clone());
    armor.update(state,1,false);
    assert.ok(armor.debris.children.every((part,index)=>part.position.equals(before[index])));
    armor.update(state,.06,true,{hasRoad:()=>true});
    assert.ok(armor.debris.children.every((part,index)=>!part.position.equals(before[index])));
    assert.equal(armor.debris.children.length,4,'detached plates must use a bounded pool');
    for(let frame=0;frame<110;frame++)armor.update(state,.06,true,{hasRoad:()=>true});
    assert.equal(armor.debris.children.filter(part=>part.visible).length,0);
    armor.update({...state,armorMask:15,impactSerial:0,distance:0},0);
    assert.equal(armor.attached.children.filter(part=>part.visible).length,4);
    assert.equal(armor.debris.children.filter(part=>part.visible).length,0);
    for(let level=0;level<=4;level++) {
      const preview=carGarageIcon(level);
      assert.equal((preview.match(/<svg/g)??[]).length,1);
      assert.equal((preview.match(/data-armor-part=/g)??[]).length,level);
      assert.equal(/NaN|Infinity/.test(preview),false);
    }
  } finally {armor.dispose();}
});

test('weapon explosions scatter unique fragments in both directions for obstacles and police', () => {
  for (const kind of ['barrier', 'drone', 'pulse', 'police']) {
    const debris = new ObstacleDebris();
    try {
      const destroyed = { ...event(1, kind), source: 'weapon' };
      debris.update([destroyed], 1, 0);
      const before = positions(debris.mesh);
      debris.update([destroyed], 1, 1 / 60);
      const after = positions(debris.mesh);
      assert.ok(after.length >= 24);
      assert.ok(after.some((piece, i) => piece.x < before[i].x), kind);
      assert.ok(after.some((piece, i) => piece.x > before[i].x), kind);
      assert.ok(after.some((piece, i) => piece.y > before[i].y), kind);
      assert.ok(after.some((piece, i) => piece.y < before[i].y), kind);
      assert.equal(after.length, before.length, 'a paused event must not emit a second set');
    } finally { debris.dispose(); }
  }
});

test('four progressive body stages deform the shell once, follow the driving pose, and restore on restart', () => {
  const body = createRoadsterBody();
  const damage = new CarBodyDamage(body);
  const geometry = body.children[0].geometry;
  const original = [...geometry.getAttribute('position').array];
  const material = body.children[0].material[0];
  const originalColor = material.color.getHex();
  let previous = original;
  try {
    for (const health of [75, 50, 25, 0]) {
      // Damage must use the rest coordinates even after moving/rotating.
      body.position.set(120, 30, 1.15); body.rotation.z = 0.8;
      body.updateMatrixWorld(true);
      damage.update(health);
      const current = [...geometry.getAttribute('position').array];
      assert.notDeepEqual(current, previous);
      assert.ok(current.every(Number.isFinite));
      assert.equal(damage.group.children.filter(layer => layer.visible).length, (100 - health) / 25);
      const version = geometry.getAttribute('position').version;
      damage.update(health);
      assert.equal(geometry.getAttribute('position').version, version, 'unchanged health uploaded geometry');
      previous = current;
    }
    assert.notEqual(material.color.getHex(), originalColor);
    damage.update(100);
    const restored = [...geometry.getAttribute('position').array];
    assert.ok(restored.every((value, i) => Math.abs(value - original[i]) < 1e-6));
    assert.equal(material.color.getHex(), originalColor);
    assert.equal(damage.group.children.some(layer => layer.visible), false);
  } finally { damage.dispose(); }
});

test('the skyline uses five instance batches and only uploads matrices when buildings wrap', () => {
  const materials = Array.from({ length: 4 }, () => new MeshLambertMaterial());
  const city = new CityBuildings(...materials);
  try {
    const batches = [];
    city.group.traverse(object => { if (object.isInstancedMesh) batches.push(object); });
    assert.equal(batches.length, 5);
    const count = batches.reduce((total, mesh) => total + mesh.count, 0);
    assert.ok(count > 400, `skyline instance count=${count}`);
    city.update(100);
    const versions = batches.map(mesh => mesh.instanceMatrix.version);
    city.update(100.0001);
    assert.deepEqual(batches.map(mesh => mesh.instanceMatrix.version), versions);
    city.update(1500);
    for (const mesh of batches) for (const point of positions(mesh)) {
      const worldX = point.x + mesh.parent.position.x;
      assert.ok(worldX > 1415 && worldX < 1585, `building failed to wrap: ${worldX}`);
    }
    assert.equal(batches.reduce((total, mesh) => total + mesh.count, 0), count, 'wrapping allocated new instances');
  } finally { city.dispose(); for (const material of materials) material.dispose(); }
});
