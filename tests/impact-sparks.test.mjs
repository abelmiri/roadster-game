import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Matrix4, Vector3 } from 'three';

let ImpactSparks, roadHeight;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-sparks-tests');
  await build({ entryPoints: ['src/game/impactSparks.ts', 'src/game/track.ts'], bundle: true,
    platform: 'node', format: 'esm', outdir, outExtension: { '.js': '.mjs' }, external: ['three'] });
  ({ ImpactSparks } = await import(pathToFileURL(path.join(outdir, 'impactSparks.mjs')).href));
  ({ roadHeight } = await import(pathToFileURL(path.join(outdir, 'track.mjs')).href));
});

function particles(sparks) {
  const matrix = new Matrix4();
  const point = new Vector3();
  const heat = sparks.mesh.geometry.getAttribute('sparkHeat');
  return Array.from({ length: sparks.activeCount }, (_, i) => {
    sparks.mesh.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix);
    return { x: point.x, y: point.y, heat: heat.getX(i) };
  });
}

const event = serial => ({ serial, x: 30, y: roadHeight(30) + .6, vx: 16, vy: 0, strength: 16, age: 0 });

test('a collision showers bright sparks outward, which fall onto terrain and gradually cool', () => {
  const sparks = new ImpactSparks();
  try {
    sparks.update([event(1)], 1, 0, false);
    const before = particles(sparks);
    assert.ok(before.length >= 64, 'impacts need a substantial shower');
    assert.ok(before.every(p => p.heat >= .79));
    const version = sparks.mesh.instanceMatrix.version;
    sparks.update([event(1)], 1, 1, false);
    assert.deepEqual(particles(sparks), before);
    assert.equal(sparks.mesh.instanceMatrix.version, version, 'paused particles should not upload unchanged matrices');
    sparks.update([event(1)], 1, .04);
    const moving = particles(sparks);
    assert.equal(moving.length, before.length, 'the same event emitted twice');
    assert.ok(moving.some((p, i) => p.x > before[i].x));
    assert.ok(moving.some((p, i) => p.x < before[i].x));
    assert.ok(moving.every((p, i) => p.heat < before[i].heat));
    let touchedGround = false;
    for (let i = 0; i < 66; i++) {
      sparks.update([], 1, 1 / 60);
      for (const p of particles(sparks)) {
        assert.ok(p.y >= roadHeight(p.x) + .024, 'a spark tunneled through the road');
        if (p.y - roadHeight(p.x) < .06) touchedGround = true;
      }
    }
    assert.ok(touchedGround, 'the shower never fell to the road');
    assert.ok(particles(sparks).every(p => p.heat < .6), 'ground sparks stayed fully lit');
    for (let i = 0; i < 150; i++) sparks.update([], 1, 1 / 60);
    assert.equal(sparks.activeCount, 0);
  } finally { sparks.dispose(); }
});

test('sparks fall freely over gaps, stay bounded under many collisions, and clear on restart', () => {
  const sparks = new ImpactSparks();
  try {
    sparks.update([event(1)], 1, 0);
    for (let i = 0; i < 70; i++) sparks.update([], 1, 1 / 60, true, { hasRoad: () => false });
    assert.ok(particles(sparks).some(p => p.y < roadHeight(p.x) - 1), 'sparks bounced on an absent road');
    for (let serial = 2; serial <= 200; serial++) sparks.update([event(serial)], serial, 1 / 120);
    assert.ok(sparks.activeCount > 200 && sparks.activeCount <= 512);
    sparks.update([], 0, 0, false);
    assert.equal(sparks.activeCount, 0);
  } finally { sparks.dispose(); }
});

test('bullet sparks launch opposite the incoming direction, with a smaller shower on terrain', () => {
  for (const [dx,dy] of [[1,0],[-1,0],[0,-1],[.6,-.8]]) {
    const sparks=new ImpactSparks();
    try {
      const hit={...event(1),y:roadHeight(30)+8,kind:'projectile',directionX:dx,directionY:dy};
      sparks.update([hit],1,0);
      const before=particles(sparks);
      sparks.update([],1,1/120);
      const after=particles(sparks);
      assert.ok(after.every((p,i)=>(p.x-before[i].x)*dx+(p.y-before[i].y)*dy<0),`incoming ${dx},${dy}`);
      assert.ok(after.length>=18&&after.length<40);
      sparks.update([],0,0);
      sparks.update([{...hit,kind:'terrain'}],1,0);
      assert.ok(sparks.activeCount>0&&sparks.activeCount<=8);
    } finally {sparks.dispose();}
  }
});
