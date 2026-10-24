import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
let VehicleDamage, ImpactPause, carVisibleDuringProtection, vehicleDamageStage, HIT_RECOVERY_SECONDS, EXPLOSION_PAUSE_SECONDS;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-damage-tests');
  await build({ entryPoints: ['src/game/damage.ts'], bundle: true, platform: 'node',
    format: 'esm', outdir, outExtension: { '.js': '.mjs' } });
  ({ VehicleDamage, ImpactPause, carVisibleDuringProtection, vehicleDamageStage, HIT_RECOVERY_SECONDS, EXPLOSION_PAUSE_SECONDS } = await import(pathToFileURL(path.join(outdir, 'damage.mjs')).href));
});
test('health maps to the four reference damage percentages and explosion hit stop never shortens a collision freeze', () => {
  assert.deepEqual([100, 75, 50, 25, 0].map(vehicleDamageStage), [0, 1, 2, 3, 4]);
  const pause = new ImpactPause();
  pause.start(EXPLOSION_PAUSE_SECONDS);
  assert.equal(pause.consume(EXPLOSION_PAUSE_SECONDS - .001), 0);
  assert.ok(pause.consume(.011) < .001, 'an explosion must ease out of its freeze');
  assert.equal(pause.active, false);
  assert.equal(pause.recovering, true);
  pause.start(); pause.start(EXPLOSION_PAUSE_SECONDS);
  assert.equal(pause.remaining, .5);
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
test('500 ms hit stop and eased recovery keep physics and protection consistent at different refresh rates', () => {
  for (const hz of [30, 60, 144]) {
    const damage = new VehicleDamage();
    const pause = new ImpactPause();
    damage.hit(); pause.start();
    let active = 0;
    for (let frame = 0; frame < hz * 1.5; frame++) {
      const playing = pause.consume(1 / hz);
      active += playing;
      damage.step(playing);
    }
    const expected = 1 - HIT_RECOVERY_SECONDS * .5;
    assert.ok(Math.abs(active - expected) < 1e-8, `active time at ${hz} Hz=${active}`);
    assert.ok(Math.abs(damage.invincibilityRemaining - (1.5 - expected)) < 1e-8);
    assert.equal(pause.active, false);
    assert.equal(pause.timeScale, 1);
  }
});
test('hit stop handles long display frames, partial frames, pause, and reset', () => {
  const pause = new ImpactPause();
  pause.start();
  assert.equal(pause.consume(.2), 0);
  assert.equal(pause.consume(0), 0);
  assert.equal(pause.remaining, .3);
  const resumed = pause.consume(.4);
  assert.ok(resumed > 0 && resumed < .02);
  assert.equal(pause.active, false);
  assert.equal(pause.recovering, true);
  pause.start(); pause.reset();
  assert.equal(pause.consume(.1), .1);
  assert.equal(pause.timeScale, 1);
});

test('speed eases monotonically from zero to normal with the same result for one frame or many', () => {
  const pause = new ImpactPause();
  pause.start(EXPLOSION_PAUSE_SECONDS);
  assert.equal(pause.consume(EXPLOSION_PAUSE_SECONDS), 0);
  assert.equal(pause.timeScale, 0);
  let previous = 0;
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const dt = pause.consume(HIT_RECOVERY_SECONDS / 10);
    assert.ok(dt > previous);
    assert.ok(dt < HIT_RECOVERY_SECONDS / 10);
    total += dt;
    previous = dt;
  }
  assert.ok(Math.abs(total - HIT_RECOVERY_SECONDS / 2) < 1e-9);
  assert.equal(pause.timeScale, 1);
  assert.equal(pause.recovering, false);
  assert.equal(pause.consume(.016), .016);
  const single = new ImpactPause();
  single.start(EXPLOSION_PAUSE_SECONDS);
  assert.ok(Math.abs(single.consume(EXPLOSION_PAUSE_SECONDS + HIT_RECOVERY_SECONDS) - total) < 1e-9);
  single.start();
  assert.equal(single.timeScale, 0, 'a new hit must restart the freeze and recovery');
});
test('flashing shares the immunity timer; the impact freeze and final recovery are visible', () => {
  assert.equal(carVisibleDuringProtection(1.5, true), true);
  const phases = Array.from({ length: 12 }, (_, i) => carVisibleDuringProtection(1.5 - i / 8, false));
  assert.ok(phases.includes(true) && phases.includes(false));
  assert.equal(carVisibleDuringProtection(0, false), true);
  assert.equal(carVisibleDuringProtection(.8, true), true, 'freeze always shows the car');
});
