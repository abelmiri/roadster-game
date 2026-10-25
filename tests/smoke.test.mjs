import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Matrix4, Vector3 } from 'three';

let CarSmoke;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-smoke-tests');
  await build({ entryPoints: ['src/game/smoke.ts'], bundle: true, platform: 'node',
    format: 'esm', outdir, outExtension: { '.js': '.mjs' }, external: ['three'] });
  ({ CarSmoke } = await import(pathToFileURL(path.join(outdir, 'smoke.mjs')).href));
});

const snapshot = (patch = {}) => ({
  car: { x: 10, y: 4, angle: 0 }, distance: 3, speed: 12,
  grounded: false, boostActive: false, crashed: false, health: 100, wrecked: false,
  suspensionOffset: 0, suspensionPitch: 0, jumpSerial: 0, ...patch,
});

test('the final damage stage emits rising black smoke during the game-over simulation and clears on restart', () => {
  const smoke = new CarSmoke();
  try {
    smoke.update(snapshot({ health: 25 }), 0.06);
    assert.equal(smoke.activeCount, 0, 'black smoke should start at the final stage');
    const wreck = snapshot({ health: 0, wrecked: true, crashed: true, speed: 0 });
    smoke.update(wreck, 0.06);
    const before = positions(smoke);
    assert.ok(before.length > 0);
    const darkness = smoke.mesh.geometry.getAttribute('smokeDarkness');
    assert.ok(Array.from({ length: smoke.activeCount }, (_, i) => darkness.getX(i)).every(value => value > 0.9));
    smoke.update(wreck, 0.01);
    assert.ok(positions(smoke).every((puff, i) => puff.y > before[i].y));
    const frozen = positions(smoke);
    smoke.update(wreck, 1, false);
    assert.deepEqual(positions(smoke), frozen);
    for (let i = 0; i < 600; i++) smoke.update(wreck, 1 / 60);
    assert.ok(smoke.activeCount > 30 && smoke.activeCount <= 128);
    smoke.update(snapshot(), 0);
    assert.equal(smoke.activeCount, 0, 'restart kept smoke from the previous wreck');
  } finally { smoke.dispose(); }
});

test('game-over smoke doubles its black-puff density while police smoke keeps its ordinary intensity', () => {
  const normal = new CarSmoke();
  const final = new CarSmoke();
  const police = new CarSmoke();
  const wreck = snapshot({ health:0, wrecked:true, crashed:true, speed:0 });
  try {
    for (let i=0; i<10; i++) {
      normal.update(wreck, .04);
      final.update(wreck, .04, true, 2);
      police.updateWreck(wreck.car, 0, i * .04, .04);
    }
    assert.equal(normal.activeCount, 10);
    assert.equal(final.activeCount, normal.activeCount * 2);
    assert.equal(police.activeCount, normal.activeCount);
    const darkness = final.mesh.geometry.getAttribute('smokeDarkness');
    assert.ok(Array.from({ length:final.activeCount }, (_, i) => darkness.getX(i)).every(value => value>.9));
    const frozen = positions(final);
    final.update(wreck, .04, false, 2);
    assert.deepEqual(positions(final), frozen);
    final.update(snapshot(), 0);
    assert.equal(final.activeCount, 0);
  } finally { normal.dispose(); final.dispose(); police.dispose(); }
});

function positions(smoke) {
  const matrix = new Matrix4();
  const point = new Vector3();
  const opacity = smoke.mesh.geometry.getAttribute('smokeOpacity');
  const result = [];
  for (let i = 0; i < smoke.mesh.count; i++) {
    if (!opacity.getX(i)) continue;
    smoke.mesh.getMatrixAt(i, matrix);
    point.setFromMatrixPosition(matrix);
    result.push({ x: point.x, y: point.y });
  }
  return result;
}

test('boost emits behind the rear nozzles in the air and on the ground', () => {
  const smoke = new CarSmoke();
  try {
    for (let i = 0; i < 4; i++) smoke.update(snapshot({ boostActive: true }), 1 / 60);
    assert.ok(smoke.activeCount > 0);
    assert.ok(positions(smoke).every((puff) => puff.x < 8 && puff.y > 3.3 && puff.y < 4));
    for (let i = 0; i < 90; i++) smoke.update(snapshot({ boostActive: true, grounded: true }), 1 / 60);
    assert.ok(smoke.activeCount > 0, 'ground boost must keep emitting');
    for (let i = 0; i < 90; i++) smoke.update(snapshot({ grounded: true }), 1 / 60);
    assert.equal(smoke.activeCount, 0);
  } finally { smoke.dispose(); }
});

test('each accepted jump emits underneath, including the double jump', () => {
  const smoke = new CarSmoke();
  try {
    smoke.update(snapshot({ jumpSerial: 1 }), 1 / 120);
    assert.ok(smoke.activeCount >= 16);
    assert.ok(positions(smoke).every((puff) => puff.y < 3.5 && puff.x > 9 && puff.x < 11));
    for (let i = 0; i < 90; i++) smoke.update(snapshot({ jumpSerial: 1 }), 1 / 60);
    assert.equal(smoke.activeCount, 0, 'one held jump must not emit indefinitely');
    smoke.update(snapshot({ jumpSerial: 2 }), 1 / 120);
    assert.ok(smoke.activeCount >= 16);
  } finally { smoke.dispose(); }
});

test('air jet exhaust follows only the active front or rear outlet and rotates with the chassis', () => {
  for (const front of [true, false]) {
    const smoke = new CarSmoke();
    try {
      const active = { frontJetActive:front, rearJetActive:!front, speed:0 };
      smoke.update(snapshot(active), .02);
      const puffs = positions(smoke);
      assert.equal(puffs.length, 1);
      assert.ok(Math.abs(puffs[0].x - (10 + (front ? 1.87 : -1.87))) < .03);
      assert.ok(puffs[0].y < 3.43);
      const count = smoke.activeCount;
      smoke.update(snapshot(), .02);
      assert.equal(smoke.activeCount, count, 'released air jet kept emitting');
      smoke.clear();
      smoke.update(snapshot({...active, car:{x:10,y:4,angle:Math.PI/2}}), .02);
      const rotated = positions(smoke)[0];
      assert.ok(rotated.x > 10.57);
      assert.ok(Math.abs(rotated.y - (4 + (front ? 1.87 : -1.87))) < .03);
      const frozen = positions(smoke);
      smoke.update(snapshot(active), .06, false);
      assert.deepEqual(positions(smoke), frozen);
    } finally { smoke.dispose(); }
  }
});

test('downward smoke follows active jump thrust and stops emitting as soon as it ends', () => {
  const smoke = new CarSmoke();
  try {
    smoke.update(snapshot({ jumpSerial: 1, jumpJetActive: true }), 1 / 120);
    const burst = smoke.activeCount;
    smoke.update(snapshot({ jumpSerial: 1, jumpJetActive: true }), 0.06);
    assert.ok(smoke.activeCount > burst);
    const held = smoke.activeCount;
    smoke.update(snapshot({ jumpSerial: 1, jumpJetActive: false }), 0.06);
    assert.equal(smoke.activeCount, held, 'released jets kept emitting fresh smoke');
    for (let i = 0; i < 90; i++) smoke.update(snapshot({ jumpSerial: 1, jumpJetActive: false }), 1 / 60);
    assert.equal(smoke.activeCount, 0);
  } finally { smoke.dispose(); }
});

test('smoke freezes when paused, clears on restart, and stays in its fixed pool', () => {
  const smoke = new CarSmoke();
  try {
    for (let i = 0; i < 1000; i++) smoke.update(snapshot({ boostActive: true }), 1 / 60);
    assert.ok(smoke.activeCount > 0 && smoke.activeCount <= 128);
    const before = positions(smoke);
    const uploadVersion = smoke.mesh.instanceMatrix.version;
    smoke.update(snapshot({ boostActive: true }), 1, false);
    assert.deepEqual(positions(smoke), before);
    assert.equal(smoke.mesh.instanceMatrix.version, uploadVersion, 'paused smoke uploaded unchanged instances');
    smoke.update(snapshot({ distance: 0, jumpSerial: 0 }), 0, false);
    assert.equal(smoke.activeCount, 0);
  } finally { smoke.dispose(); }
});
