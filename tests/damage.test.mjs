import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
let VehicleDamage, ImpactPause, carVisibleDuringProtection;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-damage-tests');
  await build({ entryPoints: ['src/game/damage.ts'], bundle: true, platform: 'node',
    format: 'esm', outdir, outExtension: { '.js': '.mjs' } });
  ({ VehicleDamage, ImpactPause, carVisibleDuringProtection } = await import(pathToFileURL(path.join(outdir, 'damage.mjs')).href));
});
test('four separate impacts remove 25% each; protection blocks repeated collider events', () => {
  const damage = new VehicleDamage();
  assert.equal(damage.health, 100);
  for (let hit = 1; hit <= 4; hit++) {
    assert.equal(damage.hit(), true);
    assert.equal(damage.health, 100 - hit * 25);
    assert.equal(damage.impactSerial, hit);
    for (let duplicate = 0; duplicate < 5; duplicate++) assert.equal(damage.hit(), false);
    for (let frame = 0; frame < 180; frame++) damage.step(1 / 120);
    assert.equal(damage.invincible, false);
  }
  assert.equal(damage.hit(), false, 'a destroyed car cannot trigger another impact');
  assert.equal(new VehicleDamage().health, 100, 'a restart begins with full health');
});
test('hit stop consumes exactly 500 ms at different refresh rates and keeps immunity unspent', () => {
  for (const hz of [30, 60, 144]) {
    const damage = new VehicleDamage();
    const pause = new ImpactPause();
    damage.hit(); pause.start();
    let active = 0;
    for (let frame = 0; frame < hz; frame++) {
      const playing = pause.consume(1 / hz);
      active += playing;
      damage.step(playing);
    }
    assert.ok(Math.abs(active - .5) < 1e-8, `active time at ${hz} Hz=${active}`);
    assert.ok(Math.abs(damage.invincibilityRemaining - 1) < 1e-8);
    assert.equal(pause.active, false);
  }
});
test('hit stop handles long display frames, partial frames, pause, and reset', () => {
  const pause = new ImpactPause();
  pause.start();
  assert.equal(pause.consume(.2), 0);
  assert.equal(pause.consume(0), 0);
  assert.equal(pause.remaining, .3);
  assert.ok(Math.abs(pause.consume(.4) - .1) < 1e-8);
  assert.equal(pause.active, false);
  pause.start(); pause.reset();
  assert.equal(pause.consume(.1), .1);
});
test('flashing shares the immunity timer; the impact freeze and final recovery are visible', () => {
  assert.equal(carVisibleDuringProtection(1.5, true), true);
  const phases = Array.from({ length: 12 }, (_, i) => carVisibleDuringProtection(1.5 - i / 8, false));
  assert.ok(phases.includes(true) && phases.includes(false));
  assert.equal(carVisibleDuringProtection(0, false), true);
  assert.equal(carVisibleDuringProtection(.8, true), true, 'freeze always shows the car');
});
