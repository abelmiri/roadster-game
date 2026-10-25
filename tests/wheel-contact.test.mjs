import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let WheelContactPhysics;
before(async () => {
  const outfile = path.resolve('node_modules/.cache/roadster-wheel-tests/wheelContact.mjs');
  await build({ entryPoints: ['src/game/wheelContact.ts'], bundle: true, platform: 'node', format: 'esm', outfile });
  ({ WheelContactPhysics } = await import(pathToFileURL(outfile).href));
});

const flat = { height: () => 0, slope: () => 0, exists: () => true };
const bodyAt = (overrides = {}) => ({ x: 0, y: 0.79, angle: 0, vx: 0, vy: 0, omega: 0, ...overrides });
const dt = 1 / 120;

test('air nozzles lift opposite ends, reject simultaneous directions, and yield to a grounded tire', () => {
  for (const surface of [flat, { ...flat, exists: x => x < 0 }, { ...flat, exists: x => x > 0 }]) {
    const idleContact = new WheelContactPhysics(surface);
    const jetContact = new WheelContactPhysics(surface);
    const initial = bodyAt();
    const idle = idleContact.step(initial, false, dt);
    const jets = jetContact.step(initial, false, dt, false, {front:true, rear:true});
    assert.deepEqual(jets, idle, 'a grounded axle allowed air thrust');
    assert.equal(jetContact.frontJetActive, false);
    assert.equal(jetContact.rearJetActive, false);
  }
  const rejected = new WheelContactPhysics(flat);
  const idleAir = new WheelContactPhysics(flat);
  const airborne = bodyAt({y:20});
  assert.deepEqual(rejected.step(airborne,false,dt,false,{front:true,rear:true}),idleAir.step(airborne,false,dt));
  assert.equal(rejected.frontJetActive,false);
  assert.equal(rejected.rearJetActive,false);
  for (const [front, rear, sign] of [[true,false,1], [false,true,-1]]) {
    const contact = new WheelContactPhysics(flat);
    let body = bodyAt({y:20});
    contact.beginJump(body, true);
    for(let i=0;i<20;i++) body = contact.step(body, false, dt, true, {front,rear});
    assert.equal(contact.frontJetActive, front);
    assert.equal(contact.rearJetActive, rear);
    if(sign) assert.ok(sign * body.omega > 3, 'jump leveling resisted deliberate nozzle control');
    else assert.equal(body.omega, 0);
    assert.ok(body.vy < 0 && body.vy > -22 * 20 * dt, 'jets must lift without allowing a hover');
    const spin = body.omega;
    body = contact.step(body, false, dt);
    assert.equal(contact.frontJetActive, false);
    assert.equal(contact.rearJetActive, false);
    assert.ok(Math.abs(body.omega - spin * Math.exp(-.65 * dt)) < 1e-9);
  }
});

test('aligned landings preserve forward speed on level and sloped roads while the springs absorb the drop', () => {
  for (const slope of [-0.25, 0, 0.25]) {
    const contact = new WheelContactPhysics({ height: x => x * slope, slope: () => slope, exists: () => true });
    let body = bodyAt({ y: 1.8, angle: Math.atan(slope), vx: 20, vy: 20 * slope - 8 });
    let landedAt = -1;
    for (let i = 0; i < 120; i++) {
      body = contact.step(body, false, dt);
      if (landedAt < 0 && contact.wheels.some(wheel => wheel.impactSerial)) landedAt = i;
      if (landedAt >= 0) {
        assert.ok(body.vx >= 20 - 1e-9, `aligned landing lost speed on slope ${slope}: ${body.vx}`);
        if (i - landedAt === 24) break;
      }
    }
    assert.ok(landedAt >= 0);
    assert.ok(contact.wheels.every(wheel => wheel.energyLost > 10), 'suspension stopped absorbing vertical impact energy');
    assert.ok(Math.abs(body.vy - body.vx * slope) < .5, 'landing caused a normal rebound');
  }
});

test('tilted or hard landings lose at most a small amount of forward speed, with independent axle reactions', () => {
  for (const [pitch, descent] of [[-.5, 8], [.5, 8], [0, 22]]) {
    const slope = .25;
    const contact = new WheelContactPhysics({ height: x => x * slope, slope: () => slope, exists: () => true });
    let body = bodyAt({ y: 2.5, angle: Math.atan(slope) + pitch, vx: 20, vy: 20 * slope - descent });
    let landedAt = -1;
    let firstSerials;
    let minimum = 20;
    for (let i = 0; i < 120; i++) {
      body = contact.step(body, false, dt);
      if (landedAt < 0 && contact.wheels.some(wheel => wheel.impactSerial)) {
        landedAt = i;
        firstSerials = contact.wheels.map(wheel => wheel.impactSerial);
      }
      if (landedAt >= 0) {
        minimum = Math.min(minimum, body.vx);
        if (i - landedAt === 24) break;
      }
    }
    assert.ok(landedAt >= 0);
    assert.ok(minimum < 20, 'bad landing had no speed penalty');
    assert.ok(minimum >= 19.2 - 1e-9, `landing lost too much speed: ${minimum}`);
    if (pitch) assert.equal(firstSerials.filter(serial => serial > 0).length, 1, 'both tires hit simultaneously during a tilted landing');
    assert.ok(contact.wheels.every(wheel => wheel.energyLost > 0));
  }
});

test('a short hard drop also preserves momentum when the tires were recently grounded', () => {
  const slope = .25;
  const contact = new WheelContactPhysics({ height: x => x * slope, slope: () => slope, exists: () => true });
  let body = bodyAt({ angle: Math.atan(slope), vx: 20, vy: 5 });
  for (let i = 0; i < 60; i++) body = contact.step(body, false, dt);
  const serial = contact.wheels.reduce((sum, wheel) => sum + wheel.impactSerial, 0);
  body = { ...body, y: body.y + .35, vx: 20, vy: -20 };
  let landedAt = -1;
  for (let i = 0; i < 60; i++) {
    body = contact.step(body, false, dt);
    if (landedAt < 0 && contact.wheels.reduce((sum, wheel) => sum + wheel.impactSerial, 0) > serial) landedAt = i;
    if (landedAt >= 0) {
      assert.ok(body.vx >= 19.2 - 1e-9, `short landing lost speed: ${body.vx}`);
      if (i - landedAt === 24) break;
    }
  }
  assert.ok(landedAt >= 0 && landedAt < 3, 'drop did not exercise a brief airborne interval');
});

test('requested jumps cancel inherited spin and ease either pitch toward level without snapping', () => {
  for (const pitch of [-0.6, -0.25, 0.25, 0.6]) {
    for (const spin of [-3, 3]) {
      const contact = new WheelContactPhysics(flat);
      let body = bodyAt({ y: 10, angle: pitch, vx: 14, vy: 9.4, omega: spin });
      contact.beginJump(body);
      assert.equal(body.angle, pitch, 'jump changed pitch instantly');
      assert.equal(body.omega, 0, 'takeoff retained unwanted spin');
      assert.equal(body.vx, 14);
      assert.equal(body.vy, 9.4);
      for (let i = 0; i < 96; i++) {
        const before = body.angle;
        body = contact.step(body, false, dt, true);
        assert.ok(Math.abs(body.angle - before) < 0.01, 'jump leveling snapped');
        assert.ok(Math.abs(body.angle) <= Math.abs(before) + 1e-9, 'pitch correction reversed direction');
        assert.equal(Math.sign(body.angle), Math.sign(pitch), 'jump leveling overshot');
      }
      assert.ok(Math.abs(body.angle) < Math.abs(pitch) * 0.3, `pitch=${pitch}, remaining=${body.angle}`);
    }
  }
});

test('level jumps stay straight and landing impulses take over from jump leveling', () => {
  for (const spin of [-4, 4]) {
    const contact = new WheelContactPhysics(flat);
    let body = bodyAt({ y: 10, vy: 9.4, omega: spin });
    contact.beginJump(body);
    for (let i = 0; i < 90; i++) body = contact.step(body, false, dt, true);
    assert.equal(body.angle, 0);
    assert.equal(body.omega, 0);
  }
  const contact = new WheelContactPhysics({ ...flat, exists: x => x > 0 });
  let body = bodyAt({ y: 1.25, angle: -0.3, vy: -6 });
  contact.beginJump(body);
  let previousSpin = 0;
  for (let i = 0; i < 30 && !contact.wheels[1].impactSerial; i++) {
    previousSpin = body.omega;
    body = contact.step(body, false, dt, true);
  }
  assert.equal(contact.wheels[1].impactSerial, 1);
  assert.equal(contact.wheels[0].impactSerial, 0);
  assert.ok(body.omega > previousSpin + 0.1, 'jump assistance suppressed the front tire impact');
});

test('a front-wheel impact transfers angular momentum without inventing rear-wheel contact', () => {
  const contact = new WheelContactPhysics({ ...flat, exists: x => x > 0 });
  let body = bodyAt({ y: 1.25, angle: -0.3, vy: -6 });
  for (let i = 0; i < 30 && !contact.wheels[1].impactSerial; i++) body = contact.step(body, false, dt);
  const [rear, front] = contact.wheels;
  assert.equal(front.impactSerial, 1);
  assert.equal(rear.impactSerial, 0);
  assert.equal(front.grounded, true);
  assert.equal(rear.grounded, false);
  assert.ok(body.omega > 0.1, 'front impulse did not rotate the chassis');
  assert.ok(front.energyLost > 0 && rear.energyLost === 0);
  assert.ok(front.travel > rear.travel + 0.01);
});

test('ending jump thrust immediately releases attitude control and preserves angular momentum', () => {
  const contact = new WheelContactPhysics(flat);
  let body = bodyAt({ y: 10, angle: 0.5, vy: 9.4 });
  contact.beginJump(body);
  for (let i = 0; i < 12; i++) body = contact.step(body, false, dt, true);
  assert.ok(body.omega < -0.1, 'active jets failed to correct pitch');
  const spin = body.omega;
  const pitch = body.angle;
  body = contact.step(body, false, dt, false);
  assert.ok(Math.abs(body.omega - spin * Math.exp(-0.65 * dt)) < 1e-9, 'released jets kept applying correction');
  assert.ok(body.angle < pitch, 'release erased existing angular momentum');
  const releasedSpin = body.omega;
  body = contact.step(body, false, dt, true);
  assert.ok(Math.abs(body.omega - releasedSpin * Math.exp(-0.65 * dt)) < 1e-9, 'spent jets restarted without a new jump');
  const tapped = new WheelContactPhysics(flat);
  const tapBody = bodyAt({ y: 10, angle: 0.4, vy: 9.4, omega: 2 });
  tapped.beginJump(tapBody, false);
  assert.equal(tapBody.omega, 2, 'an unheld jump erased prior spin');
  const free = tapped.step(tapBody, false, dt);
  assert.ok(Math.abs(free.omega - 2 * Math.exp(-0.65 * dt)) < 1e-9);
});

test('the second axle has its own impact and energy loss after the first axle touches', () => {
  for (const pitch of [-0.3, 0.3]) {
    const contact = new WheelContactPhysics(flat);
    let body = bodyAt({ y: 2.79, angle: pitch, vx: 5, vy: -8 });
    const firstIndex = pitch < 0 ? 1 : 0;
    const secondIndex = 1 - firstIndex;
    let firstStep = -1;
    let secondStep = -1;
    for (let i = 0; i < 180; i++) {
      body = contact.step(body, false, dt);
      if (firstStep < 0 && contact.wheels[firstIndex].impactSerial) firstStep = i;
      if (contact.wheels[secondIndex].impactSerial) { secondStep = i; break; }
    }
    assert.ok(firstStep >= 0 && secondStep > firstStep, `pitch=${pitch}: contact steps ${firstStep}/${secondStep}`);
    assert.ok(contact.wheels[firstIndex].energyLost > 0);
    assert.ok(contact.wheels[secondIndex].energyLost > 0, 'second axle did not dissipate impact energy');
    assert.ok(Number.isFinite(body.omega));
  }
});

test('suspension and hard stops dissipate a drop without clipping tires or adding energy', () => {
  const contact = new WheelContactPhysics(flat);
  let body = bodyAt({ y: 2.79, vy: -16 });
  const initialEnergy = 0.5 * body.vy ** 2 + 22 * body.y;
  let compression = 0;
  for (let i = 0; i < 360; i++) {
    body = contact.step(body, false, dt);
    for (const wheel of contact.wheels) {
      compression = Math.max(compression, wheel.travel);
      assert.ok(wheel.travel <= 0.170001 && wheel.travel >= -0.08);
      assert.ok(wheel.y >= 0.425, `tire penetrated the surface: ${wheel.y}`);
    }
  }
  const finalEnergy = 0.5 * (body.vx ** 2 + body.vy ** 2 + 1.3 * body.omega ** 2) + 22 * body.y;
  assert.ok(finalEnergy < initialEnergy * 0.2);
  assert.ok(compression > 0.12, 'hard landing did not use the suspension stroke');
  assert.ok(Math.abs(body.vy) < 0.01 && Math.abs(body.omega) < 0.01, 'drop failed to settle');
  assert.ok(contact.wheels.every(wheel => wheel.energyLost > 10));
});

test('suction exerts substantial finite acceleration and cannot act beyond its range or over a gap', () => {
  for (const [height, exists, active] of [[1.39, true, true], [4, true, false], [1.39, false, false]]) {
    const surface = { ...flat, exists: () => exists };
    const fan = new WheelContactPhysics(surface);
    const coast = new WheelContactPhysics(surface);
    const start = bodyAt({ y: height });
    const pulled = fan.step(start, true, dt);
    const free = coast.step(start, false, dt);
    const acceleration = (free.vy - pulled.vy) / dt;
    if (active) {
      assert.ok(acceleration > 55 && acceleration < 69, `suction acceleration=${acceleration}`);
      assert.ok(fan.suction > 55);
    } else {
      assert.ok(Math.abs(acceleration) < 1e-9);
      assert.equal(fan.suction, 0);
    }
    assert.ok(fan.wheels.every(wheel => !wheel.grounded), 'fans fabricated ground contact');
  }
});

test('suction loads each spring while leaving stroke and tire clearance available', () => {
  const fan = new WheelContactPhysics(flat);
  const coast = new WheelContactPhysics(flat);
  let pulled = bodyAt();
  let free = bodyAt();
  for (let i = 0; i < 240; i++) {
    pulled = fan.step(pulled, true, dt);
    free = coast.step(free, false, dt);
  }
  assert.ok(pulled.y < free.y - 0.09, 'fan downforce did not compress the suspension');
  for (const wheel of fan.wheels) {
    assert.equal(wheel.grounded, true);
    assert.ok(wheel.travel > 0.09 && wheel.travel < 0.16, `fan travel=${wheel.travel}`);
    assert.ok(wheel.y >= 0.425);
  }
});
