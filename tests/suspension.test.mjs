import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let VehicleSuspension;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-suspension-tests');
  await build({ entryPoints: ['src/game/suspension.ts'], bundle: true, platform: 'node',
    format: 'esm', outdir, outExtension: { '.js': '.mjs' } });
  ({ VehicleSuspension } = await import(pathToFileURL(path.join(outdir, 'suspension.mjs')).href));
});

const flat = { grounded: true, normalAcceleration: 0, roadAngularAcceleration: 0,
  forwardAcceleration: 0, suction: false };

test('landing weight compresses over time and recovers without repeated bouncing', () => {
  const suspension = new VehicleSuspension();
  suspension.land(12, 0.025, -0.01);
  let lowest = 0;
  let peakStep = 0;
  let highest = 0;
  for (let i = 0; i < 150; i++) {
    suspension.update(flat, 1 / 120);
    if (suspension.offset < lowest) { lowest = suspension.offset; peakStep = i; }
    highest = Math.max(highest, suspension.offset);
  }
  assert.ok(lowest < -0.06 && lowest >= -0.10, `compression=${lowest}`);
  assert.ok(peakStep >= 4 && peakStep < 24, `impact flattened instantly: step=${peakStep}`);
  assert.ok(highest < 0.01, `rebound overshoot=${highest}`);
  assert.ok(Math.abs(suspension.offset) < 0.001 && Math.abs(suspension.pitch) < 0.001);
});

test('acceleration squats the rear and braking loads the front', () => {
  for (const acceleration of [4, -4]) {
    const suspension = new VehicleSuspension();
    for (let i = 0; i < 90; i++) suspension.update({ ...flat, forwardAcceleration: acceleration }, 1 / 120);
    assert.ok(Math.sign(suspension.pitch) === Math.sign(acceleration));
    assert.ok(Math.abs(suspension.pitch) > 0.01, `weight transfer=${suspension.pitch}`);
    for (let i = 0; i < 180; i++) suspension.update(flat, 1 / 120);
    assert.ok(Math.abs(suspension.pitch) < 0.001);
  }
});

test('uneven road loads are stable at different integration rates', () => {
  function run(hz) {
    const suspension = new VehicleSuspension();
    for (let i = 0; i < hz * 3; i++) {
      suspension.update({ ...flat, normalAcceleration: 8 * Math.sin(i / hz * 4),
        roadAngularAcceleration: 2 * Math.cos(i / hz * 4) }, 1 / hz);
    }
    return suspension;
  }
  const normal = run(120);
  const finer = run(240);
  assert.ok(Math.abs(normal.offset - finer.offset) < 0.002);
  assert.ok(Math.abs(normal.pitch - finer.pitch) < 0.002);
});
