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
  grounded: false, boostActive: false, crashed: false,
  suspensionOffset: 0, suspensionPitch: 0, jumpSerial: 0, ...patch,
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

test('smoke freezes when paused, clears on restart, and stays in its fixed pool', () => {
  const smoke = new CarSmoke();
  try {
    for (let i = 0; i < 1000; i++) smoke.update(snapshot({ boostActive: true }), 1 / 60);
    assert.ok(smoke.activeCount > 0 && smoke.activeCount <= 128);
    const before = positions(smoke);
    smoke.update(snapshot({ boostActive: true }), 1, false);
    assert.deepEqual(positions(smoke), before);
    smoke.update(snapshot({ distance: 0, jumpSerial: 0 }), 0, false);
    assert.equal(smoke.activeCount, 0);
  } finally { smoke.dispose(); }
});
