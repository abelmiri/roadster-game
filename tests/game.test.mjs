import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import RAPIER from '@dimforge/rapier2d-compat';
import { build } from 'esbuild';

let GamePhysics;
let FIXED_STEP;
let TrackGenerator;
let roadHeight;
let roadSlope;
let CAR_WHEEL_RADIUS;
let CAR_WHEEL_OFFSET;
let CAR_AXLE_Y;
let CAR_BODY_CLEARANCE;
let CAR_ARCH_RADIUS;

before(async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-tests');
  await build({
    entryPoints: ['src/game/physics.ts', 'src/game/track.ts', 'src/game/vehicle.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outdir,
    outExtension: { '.js': '.mjs' },
    external: ['@dimforge/rapier2d-compat'],
  });
  await RAPIER.init();
  ({ GamePhysics, FIXED_STEP } = await import(pathToFileURL(path.join(outdir, 'physics.mjs')).href));
  ({ TrackGenerator, roadHeight, roadSlope } = await import(pathToFileURL(path.join(outdir, 'track.mjs')).href));
  ({ CAR_WHEEL_RADIUS, CAR_WHEEL_OFFSET, CAR_AXLE_Y, CAR_BODY_CLEARANCE, CAR_ARCH_RADIUS } =
    await import(pathToFileURL(path.join(outdir, 'vehicle.mjs')).href));
});

const idle = { jumpPressed: false, jumpHeld: false, suction: false, boost: false };

function stepFor(game, seconds, controls = idle) {
  for (let i = 0; i < Math.round(seconds / FIXED_STEP) && !game.crashed; i++) game.step(controls);
}

function placeOnRoad(game, x, speed) {
  const y = roadHeight(x) + CAR_BODY_CLEARANCE;
  const angle = Math.atan(roadSlope(x));
  game.car.setTranslation({ x, y }, true);
  game.car.setRotation(angle, true);
  game.car.setLinvel({ x: speed, y: speed * roadSlope(x) }, true);
  game.car.setAngvel(0, true);
  game.wheels.forEach((wheel, i) => {
    const offset = i === 0 ? -CAR_WHEEL_OFFSET : CAR_WHEEL_OFFSET;
    wheel.setTranslation({
      x: x + offset * Math.cos(angle) - CAR_AXLE_Y * Math.sin(angle),
      y: y + offset * Math.sin(angle) + CAR_AXLE_Y * Math.cos(angle),
    }, true);
    wheel.setLinvel({ x: speed, y: speed * roadSlope(x) }, true);
  });
}

function runChallenge(startX, endX, jumpAt) {
  const game = new GamePhysics(startX);
  let jumpStep = -Infinity;
  try {
    for (let i = 0; i < 1200 && !game.crashed && game.snapshot(1).car.x < endX; i++) {
      const jumpPressed = jumpStep === -Infinity && game.snapshot(1).car.x >= jumpAt;
      if (jumpPressed) jumpStep = i;
      game.step({ ...idle, jumpPressed, jumpHeld: i - jumpStep < 22 });
    }
    return { x: game.snapshot(1).car.x, crashed: game.crashed };
  } finally { game.dispose(); }
}

test('track chunks are deterministic, continuous, and leave a run-up to each gap', () => {
  const track = new TrackGenerator();
  const initial = Array.from({ length: 80 }, (_, i) => track.chunk(i));
  for (const chunk of initial) {
    assert.equal(track.chunk(chunk.index), chunk);
    assert.equal(chunk.end, (chunk.index + 1) * 30);
    if (chunk.gap) {
      assert.ok(chunk.gap.end - chunk.gap.start < 5);
      assert.ok(chunk.gap.start - chunk.start >= 13);
      assert.equal(chunk.hazards.length, 0);
      assert.equal(track.hasRoad((chunk.gap.start + chunk.gap.end) / 2), false);
    }
    for (const hazard of chunk.hazards) {
      assert.ok(hazard.x > chunk.start + 18);
      assert.equal(hazard.y, roadHeight(hazard.x));
    }
  }
});

test('automatic driving follows ordinary contours without bouncing or reversing', () => {
  const game = new GamePhysics();
  try {
    let previousX = game.snapshot(1).car.x;
    let maximumClearance = 0;
    for (let i = 0; i < 540 && !game.crashed && game.snapshot(1).car.x < 60; i++) {
      game.step(idle);
      const state = game.snapshot(1);
      assert.ok(state.car.x > previousX, `car reversed at x=${state.car.x}`);
      assert.ok(state.speed > 8 && state.speed < 20, `speed=${state.speed}`);
      const clearance = Math.min(...state.wheels.map((wheel) => wheel.y - roadHeight(wheel.x)));
      maximumClearance = Math.max(maximumClearance, clearance);
      previousX = state.car.x;
    }
    assert.equal(game.crashed, false);
    assert.ok(game.distance > 45, `distance=${game.distance}`);
    assert.ok(maximumClearance < CAR_WHEEL_RADIUS + 0.15, `clearance=${maximumClearance}`);
  } finally { game.dispose(); }
});

test('jump landings preserve forward motion and do not launch the car back into the air', () => {
  for (const [startX, held] of [[7, false], [20, true], [37, false]]) {
    const game = new GamePhysics(startX);
    try {
      stepFor(game, 0.15);
      game.step({ ...idle, jumpPressed: true, jumpHeld: held });
      let airborne = false;
      let landed = false;
      let settledSteps = 0;
      let previousSpeed = game.snapshot(1).speed;
      for (let i = 0; i < 270 && !game.crashed; i++) {
        game.step({ ...idle, jumpHeld: held && i < 22 });
        const state = game.snapshot(1);
        if (!state.grounded) airborne = true;
        if (airborne && state.grounded) landed = true;
        assert.ok(state.speed > 8 && state.speed < 24, `start=${startX}, speed=${state.speed}`);
        assert.ok(Math.abs(state.speed - previousSpeed) < 1.5,
          `landing speed changed from ${previousSpeed} to ${state.speed}`);
        if (landed) {
          settledSteps++;
          const velocity = game.car.linvel();
          const normalVelocity = velocity.y - velocity.x * roadSlope(state.car.x);
          assert.ok(normalVelocity < 1.5, `landing rebound velocity=${normalVelocity}`);
          const clearance = Math.min(...state.wheels.map((wheel) => wheel.y - roadHeight(wheel.x)));
          assert.ok(clearance < CAR_WHEEL_RADIUS + 0.16, `landing rebound clearance=${clearance}`);
          if (settledSteps >= 36) break;
        }
        previousSpeed = state.speed;
      }
      assert.equal(game.crashed, false, `crashed after jump at x=${startX}`);
      assert.equal(landed, true, `no landing after jump at x=${startX}`);
      assert.equal(settledSteps, 36);
    } finally { game.dispose(); }
  }
});

test('soft suspension compresses on landing and keeps space around both tires', () => {
  const game = new GamePhysics();
  let minimumGap = Infinity;
  let minimumLandingTravel = 0;
  let landingFrame = -1;
  try {
    for (let i = 0; i < 500 && !game.crashed && game.car.translation().x < 60; i++) {
      game.step({ ...idle, jumpPressed: i === 50, jumpHeld: i >= 50 && i < 72 });
      const state = game.snapshot(1);
      const bodyAngle = state.car.angle + state.suspensionPitch;
      state.wheels.forEach((wheel, index) => {
        const offset = index === 0 ? -CAR_WHEEL_OFFSET : CAR_WHEEL_OFFSET;
        const archX = state.car.x + offset * Math.cos(bodyAngle) - CAR_AXLE_Y * Math.sin(bodyAngle);
        const archY = state.car.y + state.suspensionOffset + offset * Math.sin(bodyAngle) + CAR_AXLE_Y * Math.cos(bodyAngle);
        const gap = CAR_ARCH_RADIUS - CAR_WHEEL_RADIUS - Math.hypot(wheel.x - archX, wheel.y - archY);
        minimumGap = Math.min(minimumGap, gap);
      });
      if (state.landingSerial > 0 && landingFrame < 0) landingFrame = i;
      if (landingFrame >= 0 && i - landingFrame < 36) {
        minimumLandingTravel = Math.min(minimumLandingTravel, state.suspensionOffset);
      }
    }
    assert.equal(game.crashed, false);
    assert.equal(game.snapshot(1).jumpSerial, 1);
    assert.equal(game.snapshot(1).landingSerial, 1);
    assert.ok(game.snapshot(1).landingImpact > 0);
    assert.ok(minimumLandingTravel < -0.015, `landing compression=${minimumLandingTravel}`);
    assert.ok(minimumGap > 0.03, `tire clearance=${minimumGap}`);
  } finally { game.dispose(); }
});

test('late-speed jump landings cannot catapult or reverse the car', () => {
  const game = new GamePhysics();
  try {
    placeOnRoad(game, 1105, 18);
    game.step(idle);
    // Isolate road contacts from city hazards while crossing several chunks.
    const disableHazards = () => {
      for (const chunk of game.chunks.values()) {
        for (const hazard of chunk.hazards) hazard.collider.setEnabled(false);
      }
    };
    disableHazards();
    let landingCount = 0;
    let airborne = false;
    let waitingForLanding = false;
    let settledSteps = 0;
    let previousSpeed = game.snapshot(1).speed;
    let jumpStep = -Infinity;
    for (let i = 0; i < 600 && !game.crashed && landingCount < 2; i++) {
      const before = game.snapshot(1);
      const jumpPressed = before.grounded && !waitingForLanding && settledSteps >= 12;
      if (jumpPressed) {
        jumpStep = i;
        waitingForLanding = true;
        airborne = false;
        settledSteps = 0;
      }
      game.step({ ...idle, jumpPressed, jumpHeld: i - jumpStep < 22 });
      disableHazards();
      const state = game.snapshot(1);
      assert.ok(state.speed >= 16 && state.speed <= 23, `late speed=${state.speed}`);
      assert.ok(Math.abs(state.speed - previousSpeed) < 1.5,
        `late landing speed changed from ${previousSpeed} to ${state.speed}`);
      if (waitingForLanding && !state.grounded) airborne = true;
      if (waitingForLanding && airborne && state.grounded) {
        landingCount++;
        waitingForLanding = false;
        const velocity = game.car.linvel();
        assert.ok(velocity.y - velocity.x * roadSlope(state.car.x) < 1.5,
          `late landing normal velocity=${velocity.y - velocity.x * roadSlope(state.car.x)}`);
      }
      if (state.grounded && !waitingForLanding) settledSteps++;
      previousSpeed = state.speed;
    }
    assert.equal(game.crashed, false);
    assert.equal(landingCount, 2, `only ${landingCount} late-speed landings`);
  } finally { game.dispose(); }
});

test('fast downward landings cannot tunnel through the road between physics steps', () => {
  // Vary the drop height so contact arrives at different fractions of a step.
  // At this speed, downward travel plus an uphill road can exceed 0.2 m/step.
  for (const height of [0.35, 0.55, 0.75, 0.95, 1.15, 1.35]) {
    const game = new GamePhysics();
    try {
      placeOnRoad(game, 19, 18);
      game.step(idle);
      for (const body of [game.car, ...game.wheels]) {
        const p = body.translation();
        body.setTranslation({ x: p.x, y: p.y + height }, true);
        body.setLinvel({ x: 18, y: -25 }, true);
      }
      let landed = false;
      for (let i = 0; i < 24 && !game.crashed; i++) {
        game.step(idle);
        if (game.snapshot(1).grounded) { landed = true; break; }
      }
      assert.equal(game.crashed, false, `crashed during ${height}m drop`);
      assert.equal(landed, true, `${height}m drop passed through road support`);
      const state = game.snapshot(1);
      const velocity = game.car.linvel();
      assert.ok(velocity.x > 16 && velocity.x < 20, `landing speed=${velocity.x}`);
      assert.ok(velocity.y - velocity.x * roadSlope(state.car.x) < 1.5,
        `drop landing rebound=${velocity.y - velocity.x * roadSlope(state.car.x)}`);
    } finally { game.dispose(); }
  }
});

test('holding jump gains height, a second press works, and a third press is ignored', () => {
  function jumpSequence(hold, second, third) {
    const game = new GamePhysics();
    try {
      stepFor(game, 0.25);
      game.step({ ...idle, jumpPressed: true, jumpHeld: hold });
      stepFor(game, 0.12, { ...idle, jumpHeld: hold });
      if (second) game.step({ ...idle, jumpPressed: true, jumpHeld: hold });
      game.step({ ...idle, jumpPressed: third, jumpHeld: hold });
      stepFor(game, 0.18, { ...idle, jumpHeld: hold });
      return game.snapshot(1).car.y;
    } finally { game.dispose(); }
  }
  const short = jumpSequence(false, false, false);
  const long = jumpSequence(true, false, false);
  const double = jumpSequence(true, true, false);
  const triple = jumpSequence(true, true, true);
  assert.ok(long > short + 0.1, `short=${short}, long=${long}`);
  assert.ok(double > long + 0.3, `long=${long}, double=${double}`);
  assert.ok(Math.abs(triple - double) < 0.02, `double=${double}, triple=${triple}`);
});

test('air boost drains and then recharges', () => {
  const game = new GamePhysics();
  const coast = new GamePhysics();
  try {
    stepFor(game, 0.25);
    stepFor(coast, 0.25);
    game.step({ ...idle, jumpPressed: true });
    coast.step({ ...idle, jumpPressed: true });
    stepFor(game, 0.45, { ...idle, boost: true });
    stepFor(coast, 0.45);
    const spent = game.snapshot(1).boost;
    assert.ok(spent < 0.90, `boost=${spent}`);
    assert.ok(game.snapshot(1).car.x > coast.snapshot(1).car.x + 0.3);
    stepFor(game, 0.45);
    assert.ok(game.snapshot(1).boost > spent);
  } finally { game.dispose(); coast.dispose(); }
});

test('an early barrier is lethal, while a timed jump clears it', () => {
  const track = new TrackGenerator();
  const barrier = track.chunk(2).hazards[0];
  assert.equal(runChallenge(7, 95, Infinity).crashed, true);
  const paths = Array.from({ length: 9 }, (_, i) => runChallenge(7, 95, barrier.x - (i + 3)));
  assert.ok(paths.some((path) => !path.crashed && path.x >= 95), 'barrier has no reachable jump');
});

test('a gap requires a jump and has a reachable landing', () => {
  const gap = new TrackGenerator().chunk(4).gap;
  assert.equal(runChallenge(122, 155, Infinity).crashed, true);
  const paths = Array.from({ length: 9 }, (_, i) => runChallenge(122, 155, gap.start - (i + 3)));
  assert.ok(paths.some((path) => !path.crashed && path.x >= 155), 'gap has no reachable jump');
});

test('suction prevents high-speed crest lift-off', () => {
  function crest(suction) {
    const game = new GamePhysics();
    const x = 1105;
    try {
      placeOnRoad(game, x, 18);
      let maxClearance = 0;
      for (let i = 0; i < 110 && !game.crashed; i++) {
        game.step({ ...idle, suction });
        const wheelClearance = Math.min(...game.snapshot(1).wheels.map((wheel) => wheel.y - roadHeight(wheel.x)));
        maxClearance = Math.max(maxClearance, wheelClearance);
      }
      return maxClearance;
    } finally { game.dispose(); }
  }
  const coasting = crest(false);
  const planted = crest(true);
  assert.ok(coasting > CAR_WHEEL_RADIUS + 0.08, `coasting clearance=${coasting}`);
  assert.ok(planted < CAR_WHEEL_RADIUS + 0.04, `suction clearance=${planted}`);
});

test('roof-first contact ends the run', () => {
  const game = new GamePhysics();
  try {
    const x = game.car.translation().x;
    game.car.setRotation(Math.PI, true);
    game.car.setTranslation({ x, y: roadHeight(x) + 0.8 }, true);
    game.step(idle);
    assert.equal(game.crashed, true);
  } finally { game.dispose(); }
});
