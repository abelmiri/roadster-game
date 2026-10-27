import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
let VehicleDamage, ImpactPause, ExplosionSlowMotion, carVisibleDuringProtection, vehicleDamageStage, HIT_RECOVERY_SECONDS;
before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-damage-tests');
  await build({ entryPoints: ['src/game/damage.ts'], bundle: true, platform: 'node',
    format: 'esm', outdir, outExtension: { '.js': '.mjs' } });
  ({ VehicleDamage, ImpactPause, ExplosionSlowMotion, carVisibleDuringProtection, vehicleDamageStage, HIT_RECOVERY_SECONDS } = await import(pathToFileURL(path.join(outdir, 'damage.mjs')).href));
});
test('health maps to the four reference damage percentages and explosions cannot shorten a collision freeze', () => {
  assert.deepEqual([100, 75, 50, 25, 0].map(vehicleDamageStage), [0, 1, 2, 3, 4]);
  const pause = new ImpactPause();
  const explosion = new ExplosionSlowMotion();
  pause.start(); explosion.start();
  assert.equal(Math.min(pause.consume(.2), explosion.consume(.2)), 0);
  assert.ok(explosion.timeScale > 0);
  assert.equal(pause.remaining, .3);
  pause.start();
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

test('four armor plates absorb one accepted hit each before the hull takes damage', () => {
  const damage=new VehicleDamage(4);
  assert.equal(damage.health,200); assert.equal(damage.maxHealth,200);
  for(const mask of [14,12,8,0]) {
    assert.equal(damage.hit(),true);
    assert.equal(damage.armorMask,mask);
    assert.equal(damage.hullHealth,100);
    const health=damage.health;
    assert.equal(damage.hit(),false,'protection must prevent a second plate falling');
    assert.equal(damage.health,health);
    damage.step(1.5);
  }
  assert.equal(damage.health,100);
  for(let index=0;index<4;index++) { damage.hit(); damage.step(1.5); }
  assert.equal(damage.health,0); assert.equal(damage.impactSerial,8);
  assert.equal(new VehicleDamage(4).armorMask,15,'a new run restores all purchased plates');
});

test('a health pickup restores one 25-point unit without exceeding hull or armor capacity', () => {
  const damage = new VehicleDamage(2);
  damage.hit(); damage.step(1.5);
  assert.equal(damage.health, 125);
  assert.equal(damage.restoreUnit(), 25);
  assert.equal(damage.armorMask, 3);
  assert.equal(damage.health, 150);
  assert.equal(damage.restoreUnit(), 0);

  damage.hit(); damage.step(1.5);
  damage.hit(); damage.step(1.5);
  damage.hit(); damage.step(1.5);
  assert.equal(damage.hullHealth, 75);
  assert.equal(damage.health, 75);
  assert.equal(damage.restoreUnit(), 25);
  assert.equal(damage.hullHealth, 100);
  assert.equal(damage.restoreUnit(), 25);
  assert.equal(damage.health, 125);
  assert.equal(damage.restoreUnit(), 25);
  assert.equal(damage.health, damage.maxHealth);
  assert.equal(damage.impactSerial, 4, 'repair is not another collision');

  const wreck = new VehicleDamage();
  for (let i = 0; i < 4; i++) { wreck.hit(); wreck.step(1.5); }
  assert.equal(wreck.restoreUnit(), 0, 'a destroyed car cannot be revived by a late pickup');
});

test('new armor preserves damaged hull health, cannot restore lost plates, and protects the impacted rear', () => {
  const damage=new VehicleDamage(); damage.hullHealth=50;
  damage.upgradeArmor(1);
  assert.equal(damage.health,75); assert.equal(damage.hullHealth,50);
  damage.hit(); damage.step(1.5);
  assert.equal(damage.health,50);
  damage.upgradeArmor(1);
  assert.equal(damage.armorMask,0);
  damage.upgradeArmor(4);
  assert.equal(damage.armorMask,14,'only the three new plates should be installed');
  damage.hit(3);
  assert.equal(damage.armorMask,6,'a rear contact drops the rear plate when installed');
  assert.equal(damage.hullHealth,50);
  damage.hullHealth=0; damage.armorMask=0;
  damage.upgradeArmor(4);
  assert.equal(damage.health,0,'an upgrade cannot revive a destroyed hull');
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
  pause.start();
  assert.equal(pause.consume(.5), 0);
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
  single.start();
  assert.ok(Math.abs(single.consume(.5 + HIT_RECOVERY_SECONDS) - total) < 1e-9);
  single.start();
  assert.equal(single.timeScale, 0, 'a new hit must restart the freeze and recovery');
});

test('explosions ease down over 200 ms and recover over 1000 ms without ever stopping', () => {
  const slow = new ExplosionSlowMotion();
  slow.start();
  assert.equal(slow.timeScale, 1);
  let previous = 1;
  for (let i = 0; i < 10; i++) {
    assert.ok(slow.consume(.02) > 0);
    assert.ok(slow.timeScale < previous && slow.timeScale >= .25);
    previous = slow.timeScale;
  }
  assert.ok(Math.abs(slow.timeScale - .25) < 1e-9);
  for (let i = 0; i < 20; i++) {
    assert.ok(slow.consume(.05) > 0);
    assert.ok(slow.timeScale > previous);
    previous = slow.timeScale;
  }
  assert.equal(slow.active, false);
  assert.equal(slow.timeScale, 1);
  assert.equal(slow.consume(.016), .016);
});

test('explosion timing is frame-rate independent, including long frames and retriggered effects', () => {
  for (const retrigger of [false, true]) {
    const run = hz => {
      const slow = new ExplosionSlowMotion();
      slow.start();
      let elapsed = 0;
      for (let i = 0; i < hz * .5; i++) elapsed += slow.consume(1 / hz);
      if (retrigger) {
        const before = slow.timeScale;
        slow.start();
        assert.equal(slow.timeScale, before, 'retrigger jumped back to full speed');
      }
      for (let i = 0; i < hz * 2; i++) elapsed += slow.consume(1 / hz);
      return elapsed;
    };
    const slow = new ExplosionSlowMotion(); slow.start();
    let expected = slow.consume(.5);
    if (retrigger) slow.start();
    expected += slow.consume(2);
    for (const hz of [30, 60, 144]) assert.ok(Math.abs(run(hz) - expected) < 1e-9, `${hz} Hz, retrigger=${retrigger}`);
  }
});

test('zero elapsed time holds explosion slow motion and reset restores normal speed', () => {
  const slow = new ExplosionSlowMotion(); slow.start(); slow.consume(.3);
  const paused = slow.timeScale;
  assert.equal(slow.consume(0), 0);
  assert.equal(slow.timeScale, paused);
  slow.reset();
  assert.equal(slow.timeScale, 1);
  assert.equal(slow.consume(.2), .2);
});
test('flashing shares the immunity timer; the impact freeze and final recovery are visible', () => {
  assert.equal(carVisibleDuringProtection(1.5, true), true);
  const phases = Array.from({ length: 12 }, (_, i) => carVisibleDuringProtection(1.5 - i / 8, false));
  assert.ok(phases.includes(true) && phases.includes(false));
  assert.equal(carVisibleDuringProtection(0, false), true);
  assert.equal(carVisibleDuringProtection(.8, true), true, 'freeze always shows the car');
});
