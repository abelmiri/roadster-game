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
let loopsBetween;
let rampsBetween;
let RAMP_APPROACH;
let RAMP_LANDING;
let loopGeometry;
let sprungBodyPose;

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
  ({ TrackGenerator, roadHeight, roadSlope, loopsBetween, loopGeometry, rampsBetween, RAMP_APPROACH, RAMP_LANDING } = await import(pathToFileURL(path.join(outdir, 'track.mjs')).href));
  ({ CAR_WHEEL_RADIUS, CAR_WHEEL_OFFSET, CAR_AXLE_Y, CAR_BODY_CLEARANCE, CAR_ARCH_RADIUS, sprungBodyPose } =
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
    return { x: game.snapshot(1).car.x, crashed: game.crashed, health: game.snapshot(1).health };
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

test('ramps begin after 1000m, stream deterministically, and reserve a continuous approach and landing', () => {
  const track = new TrackGenerator();
  assert.deepEqual(rampsBetween(-64, 1007), []);
  const ramps = rampsBetween(0, 10000);
  assert.ok(ramps.length > 5);
  for (const ramp of ramps) {
    assert.ok(ramp.start - 7 > 1000);
    assert.deepEqual(rampsBetween(ramp.start + 1, ramp.end), [ramp]);
    assert.equal(loopsBetween(ramp.start - RAMP_APPROACH - 20, ramp.end + RAMP_LANDING + 20).length, 0);
    for (let x = ramp.start - RAMP_APPROACH; x <= ramp.end + RAMP_LANDING; x += .5) {
      const chunk = track.chunk(Math.floor(x / 30));
      assert.equal(chunk.gap, null);
      assert.equal(chunk.hazards.length, 0);
      assert.equal(track.hasRoad(x), true);
    }
    for (const x of [ramp.start, ramp.takeoffX, ramp.takeoffX + 4, ramp.end]) {
      const epsilon = .0001;
      assert.ok(Math.abs(roadHeight(x + epsilon) - roadHeight(x - epsilon)) < .001);
      assert.ok(Math.abs(roadSlope(x + epsilon) - roadSlope(x - epsilon)) < .001);
      assert.ok(Math.abs((roadHeight(x + epsilon) - roadHeight(x - epsilon)) / (2 * epsilon) - roadSlope(x)) < .001);
    }
  }
  assert.deepEqual(new TrackGenerator().chunk(38), track.chunk(38));
});

test('every actual ramp is randomly spaced 400–800m after the unlock and previous ramp, including distant streamed sections', async () => {
  assert.deepEqual(rampsBetween(0, 1406), []);
  const ramps = rampsBetween(0, 100000);
  const spacings = new Set();
  let previous = 1007;
  for (const [index, ramp] of ramps.entries()) {
    const spacing = ramp.start - previous;
    assert.ok(spacing >= 400 && spacing <= 800, `ramp ${ramp.id}: spacing=${spacing}`);
    assert.equal(ramp.id, index, 'loop conflicts must not skip scheduled ramps');
    spacings.add(spacing);
    previous = ramp.start;
  }
  assert.ok(spacings.size > 50, 'spacing must vary rather than repeat a fixed interval');
  const fresh = await import(`${pathToFileURL(path.resolve('node_modules/.cache/roadster-tests/track.mjs')).href}?ramp-order`);
  assert.deepEqual(fresh.rampsBetween(80000, 81000), rampsBetween(80000, 81000));
  assert.deepEqual(fresh.loopsBetween(0, 100000), loopsBetween(0, 100000));
  assert.deepEqual(fresh.rampsBetween(0, 10000), rampsBetween(0, 10000));
});

test('boosting over ramps produces long natural jumps and clean landings without pressing jump', () => {
  for (const ramp of rampsBetween(0, 10000)) for (const upgraded of [false, true]) {
    const game = new GamePhysics(ramp.start - 10, { id:'machine-gun', xp:0,
      carUpgrades: upgraded ? {'boost-power':4,'boost-reserve':4} : {} });
    let airTime = 0, longestFlight = 0, clearance = 0, landed = false;
    try {
      for (let i = 0; i < 1400 && !game.crashed && game.snapshot(1).car.x < ramp.end + RAMP_LANDING - 5; i++) {
        game.step({ ...idle, boost: true });
        const state = game.snapshot(1);
        if (state.grounded) { if (airTime > 1) landed = true; airTime = 0; }
        else airTime += FIXED_STEP;
        longestFlight = Math.max(longestFlight, airTime);
        clearance = Math.max(clearance, state.car.y - roadHeight(state.car.x));
      }
      assert.equal(game.crashed, false, `ramp ${ramp.id} crashed`);
      assert.ok(longestFlight > 1.5, `ramp ${ramp.id}: flight=${longestFlight}`);
      assert.ok(clearance > 10, `ramp ${ramp.id}: clearance=${clearance}`);
      assert.equal(landed, true);
      assert.equal(game.snapshot(1).health, 100);
      assert.equal(game.snapshot(1).jumpSerial, 0);
    } finally { game.dispose(); }
  }
});

test('the launch depot has a continuous level apron and supports detached wreck parts behind the start', () => {
  const track = new TrackGenerator();
  for (const x of [-64, -32, -1]) {
    assert.equal(track.hasRoad(x), true);
    assert.equal(roadHeight(x), roadHeight(0));
    assert.equal(roadSlope(x), 0);
  }
  assert.equal(track.hasRoad(-64.1), false, 'the launch apron should have finite bounds');
  const game = new GamePhysics(-12);
  try {
    game.crashed = true;
    for (let i = 0; i < 180; i++) game.stepWreck();
    const state = game.snapshot(1);
    assert.ok(state.car.x < 0, 'the wreck must still be on the apron for this check');
    assert.ok(state.car.y > roadHeight(state.car.x) - .1, 'the shell fell through the launch apron');
    assert.ok(state.wheels.every(wheel => wheel.y > roadHeight(wheel.x) + CAR_WHEEL_RADIUS - .15));
  } finally { game.dispose(); }
});

test('ramp booster pads add launch speed without fuel and pay their impulse once across both axles and chunk reloads', () => {
  const ramp=rampsBetween(0,2000)[0];
  const game=new GamePhysics(ramp.start-10);
  try {
    let previous=game.snapshot(1);
    for(let i=0;i<500&&!game.snapshot(1).rampBoostSerial;i++) {
      game.step(idle);
      const state=game.snapshot(1);
      if(state.rampBoostSerial) {
        assert.ok(state.speed>previous.speed+6,'pad must give an immediate speed impulse');
        assert.equal(state.boost,1,'ground pads must not spend the player reserve');
        assert.equal(state.boostActive,true,'pad impulse should produce boost exhaust');
      }
      previous=state;
    }
    assert.equal(game.snapshot(1).rampBoostSerial,1);
    stepFor(game,.4);
    assert.equal(game.snapshot(1).rampBoostSerial,1,'the rear axle must not fire the same pad again');
    game.ensureChunks(ramp.end+220);
    placeOnRoad(game,ramp.boosterX,18);
    stepFor(game,.1);
    assert.equal(game.snapshot(1).rampBoostSerial,1,'a reloaded or revisited pad must not stack speed');
  } finally {game.dispose();}
  const airborne=new GamePhysics(ramp.boosterX-4);
  try {
    airborne.car.setTranslation({x:ramp.boosterX-4,y:roadHeight(ramp.boosterX)+25},true);
    airborne.car.setLinvel({x:27,y:0},true);
    stepFor(airborne,.5);
    assert.equal(airborne.snapshot(1).rampBoostSerial,0,'flying over a pad cannot activate it');
  } finally {airborne.dispose();}
});

test('a fresh ramp booster makes a higher and longer jump than an already spent pad', () => {
  const ramp=rampsBetween(0,2000)[0];
  const jumps=[];
  for(const spent of [false,true]) {
    const game=new GamePhysics(ramp.start-10);
    if(spent)game.usedRampBoosters.add(ramp.id);
    let height=0,airTime=0,longestFlight=0;
    try {
      for(let i=0;i<1000&&!game.crashed&&game.car.translation().x<ramp.end+100;i++) {
        game.step({...idle,boost:true});
        const state=game.snapshot(1);
        height=Math.max(height,state.car.y-roadHeight(state.car.x));
        airTime=state.grounded?0:airTime+FIXED_STEP;
        longestFlight=Math.max(longestFlight,airTime);
      }
      assert.equal(game.crashed,false);
      jumps.push({height,longestFlight});
    } finally {game.dispose();}
  }
  assert.ok(jumps[0].height>jumps[1].height+4);
  assert.ok(jumps[0].longestFlight>jumps[1].longestFlight+.2);
});

test('jump landings preserve forward motion and do not launch the car back into the air', () => {
  // Isolate tap/held landings on the level depot apron, plus a sloped landing.
  // Hill and crest tests below cover natural lift-off at the faster cruise speed.
  for (const [startX, held] of [[-60, false], [-48, true], [37, false]]) {
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
        assert.ok(Math.abs(state.speed - previousSpeed) < 3,
          `landing speed changed from ${previousSpeed} to ${state.speed}`);
        if (landed) {
          settledSteps++;
          const velocity = game.car.linvel();
          const normalVelocity = velocity.y - velocity.x * roadSlope(state.car.x);
          assert.ok(normalVelocity < 1.5, `start=${startX}, step=${i}: landing rebound velocity=${normalVelocity}`);
          const clearance = Math.min(...state.wheels.map((wheel) => wheel.y - roadHeight(wheel.x)));
          assert.ok(clearance < CAR_WHEEL_RADIUS + 0.35, `landing rebound clearance=${clearance}`);
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
  const game = new GamePhysics(19);
  let minimumGap = Infinity;
  let maximumLandingTravel = 0;
  let landingFrame = -1;
  try {
    // Use a controlled impact so the tested spring load does not depend on
    // which hill a jump reaches when the starting cruise speed changes.
    game.step(idle);
    for (const body of [game.car, ...game.wheels]) {
      const p = body.translation();
      body.setTranslation({ x: p.x, y: p.y + 1.5 }, true);
      body.setLinvel({ x: 14, y: -10 }, true);
    }
    for (let i = 0; i < 500 && !game.crashed && game.car.translation().x < 60; i++) {
      game.step(idle);
      const state = game.snapshot(1);
      const body = sprungBodyPose(state.car, state.suspensionOffset, state.suspensionPitch);
      const bodyAngle = body.angle;
      state.wheels.forEach((wheel, index) => {
        const offset = index === 0 ? -CAR_WHEEL_OFFSET : CAR_WHEEL_OFFSET;
        const archX = body.x + offset * Math.cos(bodyAngle) - CAR_AXLE_Y * Math.sin(bodyAngle);
        const archY = body.y + offset * Math.sin(bodyAngle) + CAR_AXLE_Y * Math.cos(bodyAngle);
        const gap = CAR_ARCH_RADIUS - CAR_WHEEL_RADIUS - Math.hypot(wheel.x - archX, wheel.y - archY);
        minimumGap = Math.min(minimumGap, gap);
      });
      if (state.landingSerial > 0 && landingFrame < 0) landingFrame = i;
      if (landingFrame >= 0 && i - landingFrame < 36) {
        maximumLandingTravel = Math.max(maximumLandingTravel, ...state.wheelTravel);
      }
      if (landingFrame >= 0 && i - landingFrame >= 24) break;
    }
    assert.equal(game.crashed, false);
    assert.equal(game.snapshot(1).landingSerial, 1);
    assert.ok(game.snapshot(1).landingImpact > 0.8);
    assert.ok(maximumLandingTravel > 0.10, `landing compression=${maximumLandingTravel}`);
    assert.ok(minimumGap > 0.04, `tire clearance=${minimumGap}`);
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
      // A real normal impulse can remove forward speed on an uphill landing.
      assert.ok(state.speed >= 8 && state.speed <= 23, `late speed=${state.speed}`);
      assert.ok(state.speed - previousSpeed < 1.5 && previousSpeed - state.speed < previousSpeed * 0.35,
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

test('Space jumps and double jumps neutralize takeoff spin and gradually level the car', () => {
  for (const startX of [7, 20, 37]) {
    for (const spin of [-3, 3]) {
      const game = new GamePhysics(startX);
      try {
        const takeoffAngle = game.car.rotation();
        game.car.setAngvel(spin, true);
        game.step({ ...idle, jumpPressed: true, jumpHeld: true });
        assert.equal(game.snapshot(1).jumpSerial, 1);
        assert.ok(Math.abs(game.car.rotation() - takeoffAngle) < 0.005, 'Space snapped the takeoff angle');
        assert.ok(Math.abs(game.car.angvel()) < 0.1, 'Space inherited a forward/backward tumble');
        stepFor(game, 0.5, { ...idle, jumpHeld: true });
        assert.equal(game.crashed, false);
        assert.equal(game.snapshot(1).grounded, false);
        assert.ok(Math.abs(game.car.rotation()) < Math.max(0.01, Math.abs(takeoffAngle) * 0.6),
          `start=${startX}: jump did not level toward the horizon`);

        const doubleJumpAngle = game.car.rotation();
        game.car.setAngvel(-spin, true);
        game.step({ ...idle, jumpPressed: true, jumpHeld: true });
        assert.equal(game.snapshot(1).jumpSerial, 2);
        assert.equal(game.snapshot(1).jumpsUsed, 2);
        assert.ok(Math.abs(game.car.rotation() - doubleJumpAngle) < 0.005, 'double jump snapped the pitch');
        assert.ok(Math.abs(game.car.angvel()) < 0.1, 'double jump retained unwanted spin');
        stepFor(game, 0.25, { ...idle, jumpHeld: true });
        assert.ok(Math.abs(game.car.rotation()) < Math.abs(doubleJumpAngle));
      } finally { game.dispose(); }
    }
  }
});

test('boost adds substantial speed quickly on the road and recharges after release', () => {
  const boosted = new GamePhysics(-48);
  const coast = new GamePhysics(-48);
  try {
    stepFor(boosted, .65, { ...idle, boost: true });
    stepFor(coast, .65);
    assert.ok(boosted.snapshot(1).speed - coast.snapshot(1).speed > 8,
      'boost should add more than 28 km/h within 650 ms');
    assert.ok(boosted.car.translation().x > coast.car.translation().x + 3);
    const spent = boosted.snapshot(1).boost;
    assert.ok(spent < .75);
    stepFor(boosted, .25);
    assert.equal(boosted.snapshot(1).boostActive, false);
    assert.ok(boosted.snapshot(1).boost > spent);
  } finally { boosted.dispose(); coast.dispose(); }
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

test('jump leveling and downward jets end on Space release or after their thrust budget is spent', () => {
  for (const releaseEarly of [true, false]) {
    const game = new GamePhysics(20);
    try {
      game.step({ ...idle, jumpPressed: true, jumpHeld: true });
      stepFor(game, 0.05, { ...idle, jumpHeld: true });
      assert.equal(game.snapshot(1).jumpJetActive, true);
      assert.ok(game.snapshot(1).jumpJetRemaining > 0);
      const p = game.car.translation();
      game.car.setTranslation({ x: p.x, y: p.y + 8 }, true);
      if (releaseEarly) game.step(idle);
      else stepFor(game, 0.2, { ...idle, jumpHeld: true });
      assert.equal(game.snapshot(1).jumpJetActive, false);
      assert.equal(game.snapshot(1).jumpJetRemaining, 0);
      const spin = game.car.angvel();
      assert.ok(Math.abs(spin) > 0.01);
      game.step({ ...idle, jumpHeld: true, boost: true });
      assert.equal(game.snapshot(1).jumpJetActive, false, 'rear boost or holding Space restarted spent jump jets');
      assert.ok(Math.abs(game.car.angvel() - spin * Math.exp(-0.65 * FIXED_STEP)) < 1e-6,
        'inactive jets continued leveling');
    } finally { game.dispose(); }
  }
});

test('an early barrier costs one health segment, while a timed jump clears it without damage', () => {
  const track = new TrackGenerator();
  const barrier = track.chunk(2).hazards[0];
  const collision = runChallenge(7, 95, Infinity);
  assert.equal(collision.crashed, false);
  assert.equal(collision.health, 75);
  const paths = Array.from({ length: 9 }, (_, i) => runChallenge(7, 95, barrier.x - (i + 3)));
  assert.ok(paths.some((path) => !path.crashed && path.x >= 95 && path.health === 100), 'barrier has no reachable jump');
});

test('an uphill gap requires a jump and remains reachable at the higher starting speed', () => {
  const gap = new TrackGenerator().chunk(14).gap;
  assert.equal(runChallenge(422, 455, Infinity).crashed, true);
  const paths = Array.from({ length: 9 }, (_, i) => runChallenge(422, 455, gap.start - (i + 3)));
  assert.ok(paths.some((path) => !path.crashed && path.x >= 455), 'gap has no reachable jump');
});

test('suction prevents high-speed crest lift-off', () => {
  function crest(suction) {
    const game = new GamePhysics();
    const x = 1105;
    try {
      placeOnRoad(game, x, 22);
      let maxClearance = 0;
      let airborneSteps = 0;
      for (let i = 0; i < 110 && !game.crashed; i++) {
        game.step({ ...idle, suction, boost: true });
        if (!game.snapshot(1).grounded) airborneSteps++;
        // The first touching tire now catches the car while the other axle
        // can still be airborne. Check each tire rather than only the lower one.
        maxClearance = Math.max(maxClearance, ...game.snapshot(1).wheels.map((wheel) => wheel.y - roadHeight(wheel.x)));
      }
      return { maxClearance, airborneSteps };
    } finally { game.dispose(); }
  }
  const coasting = crest(false);
  const planted = crest(true);
  assert.ok(coasting.airborneSteps >= 15, `crest airtime=${coasting.airborneSteps}`);
  assert.equal(planted.airborneSteps, 0);
  assert.ok(coasting.maxClearance > planted.maxClearance + 0.05);
  assert.ok(planted.maxClearance < CAR_WHEEL_RADIUS + 0.04, `suction clearance=${planted.maxClearance}`);
});

test('crest departures preserve momentum and produce one touchdown per hop', () => {
  for (const speed of [20, 22]) {
    const game = new GamePhysics();
    try {
      placeOnRoad(game, 1105, speed);
      let departures = 0;
      let grounded = true;
      let landingStep = -1;
      for (let i = 0; i < 145 && !game.crashed; i++) {
        const velocityBefore = game.car.linvel().y;
        game.step({ ...idle, boost: true });
        const state = game.snapshot(1);
        if (grounded && !state.grounded) {
          departures++;
          assert.ok(game.car.linvel().y <= velocityBefore + 0.02, 'crest added an upward kick');
          assert.ok(Math.abs(game.car.angvel()) > 0.1, 'takeoff erased road rotation');
        }
        grounded = state.grounded;
        if (state.landingSerial && landingStep < 0) landingStep = i;
        // The stronger boost reaches the following hill sooner. Check one
        // full hop and its first settled tire strokes before that second crest.
        if (landingStep >= 0 && i - landingStep >= 12) break;
      }
      assert.equal(game.crashed, false);
      assert.equal(departures, 1, `speed=${speed}: repeated crest release`);
      assert.equal(game.snapshot(1).landingSerial, 1, `speed=${speed}: repeated landing events`);
      assert.equal(game.snapshot(1).grounded, true);
    } finally { game.dispose(); }
  }
});

test('airborne rotation retains inertia instead of instantly aiming at the road', () => {
  const game = new GamePhysics();
  try {
    const p = game.car.translation();
    game.car.setTranslation({ x: p.x, y: p.y + 4 }, true);
    game.car.setRotation(0.35, true);
    game.car.setLinvel({ x: 14, y: 0 }, true);
    game.car.setAngvel(1.2, true);
    game.step(idle);
    assert.equal(game.snapshot(1).grounded, false);
    assert.ok(game.car.rotation() > 0.35);
    assert.ok(game.car.angvel() > 0.95 && game.car.angvel() < 1.2, `spin=${game.car.angvel()}`);
  } finally { game.dispose(); }
});

test('front and rear air nozzles allow repeated full flips across angle wrapping, while wreck spins stop scoring', () => {
  for (const action of ['frontJet', 'rearJet']) {
    const game = new GamePhysics();
    try {
      game.car.setTranslation({ x:7, y:100 }, true);
      game.car.setRotation(0, true);
      game.car.setLinvel({ x:0, y:0 }, true);
      let rotation = 0;
      let previous = 0;
      for (let i=0;i<270;i++) {
        game.step({...idle, [action]:true});
        const angle = game.car.rotation();
        rotation += Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
        previous = angle;
        const count = Math.floor(Math.abs(rotation) / (Math.PI * 2));
        assert.equal(game.snapshot(1).flipsCompleted, count);
        assert.equal(game.snapshot(1).flipCoins, 5 * count * count);
      }
      const state = game.snapshot(1);
      assert.equal(state.crashed, false);
      assert.equal(state.grounded, false);
      assert.equal(state.flipsCompleted, 2);
      assert.equal(state.frontJetActive, action === 'frontJet');
      assert.equal(state.rearJetActive, action === 'rearJet');
      assert.ok((action === 'frontJet' ? 1 : -1) * rotation > Math.PI * 4);
      game.crashed = true;
      for(let i=0;i<120;i++) game.stepWreck();
      assert.equal(game.snapshot(1).flipsCompleted, 2);
      assert.equal(game.snapshot(1).flipCoins, 20);
      assert.equal(game.snapshot(1).frontJetActive, false);
      assert.equal(game.snapshot(1).rearJetActive, false);
    } finally { game.dispose(); }
  }
});

test('landing resets the flip multiplier, and skipped snapshots retain separate jumps', () => {
  const game = new GamePhysics();
  try {
    const fly = count => {
      game.car.setTranslation({ x:7, y:100 }, true);
      game.car.setRotation(0, true);
      game.car.setLinvel({ x:0, y:0 }, true);
      game.car.setAngvel(0, true);
      for (let i=0; i<600 && game.snapshot(1).flipsCompleted<count; i++) game.step({...idle,frontJet:true});
      assert.equal(game.snapshot(1).flipsCompleted,count);
    };
    fly(2);
    assert.equal(game.snapshot(1).flipCoins,20);
    placeOnRoad(game,7,16);
    stepFor(game,.1);
    assert.equal(game.snapshot(1).grounded,true);
    fly(3);
    assert.equal(game.snapshot(1).flipCoins,25,'a new jump starts at ×1');
    fly(4);
    assert.equal(game.snapshot(1).flipCoins,40,'the second flip in this jump tops its reward up to 20');
  } finally {game.dispose();}
});

test('partial airborne turns cancel on reversal and cannot carry progress across landings', () => {
  const game = new GamePhysics();
  try {
    game.car.setTranslation({x:7, y:50}, true);
    game.car.setRotation(0, true);
    game.car.setLinvel({x:0, y:0}, true);
    game.car.setAngvel(6, true);
    stepFor(game, .6);
    assert.equal(game.snapshot(1).flipsCompleted, 0);
    game.car.setAngvel(-6, true);
    stepFor(game, .6);
    assert.equal(game.snapshot(1).flipsCompleted, 0);
    game.car.setAngvel(6, true);
    stepFor(game, .6);
    assert.equal(game.snapshot(1).flipsCompleted, 0);
    placeOnRoad(game, 7, 16);
    stepFor(game, .1);
    assert.equal(game.snapshot(1).grounded, true);
    game.car.setTranslation({x:7, y:50}, true);
    game.car.setRotation(0, true);
    game.car.setLinvel({x:0, y:0}, true);
    game.car.setAngvel(6, true);
    stepFor(game, .6);
    assert.equal(game.snapshot(1).flipsCompleted, 0, 'landing retained a partial flip');
  } finally { game.dispose(); }
});

test('tilted landings catch each tire separately and transfer rotation without snapping', () => {
  const spec = loopsBetween(0, 500)[0];
  function drop(pitch) {
    const game = new GamePhysics(spec.entryX - 4);
    try {
      const p = game.car.translation();
      const roadAngle = game.car.rotation();
      game.car.setTranslation({ x: p.x, y: p.y + 2 }, true);
      game.car.setRotation(roadAngle + pitch, true);
      game.car.setLinvel({ x: 14, y: 14 * Math.tan(roadAngle) - 10 }, true);
      let landing;
      for (let i = 0; i < 120 && !game.crashed; i++) {
        const angleBefore = game.car.rotation();
        game.step(idle);
        const state = game.snapshot(1);
        if (state.landingSerial) {
          landing = state;
          assert.ok(Math.abs(state.car.angle - angleBefore) < 0.03, 'landing snapped the chassis flat');
          if (pitch) {
            assert.ok(Math.abs(state.car.angle - roadAngle) > 0.15, 'first contact erased landing pitch');
            assert.equal(Math.sign(game.car.angvel()), -Math.sign(pitch), 'first tire should turn the free axle down');
            assert.equal(state.wheelImpactSerials[pitch < 0 ? 1 : 0], 1);
            assert.equal(state.wheelImpactSerials[pitch < 0 ? 0 : 1], 0, 'second axle landed before it touched');
          } else {
            assert.ok(Math.abs(game.car.angvel()) < 0.3, 'two-tire contact injected rotation');
          }
          break;
        }
      }
      assert.ok(landing, 'drop never landed');
      stepFor(game, 0.5);
      assert.equal(game.crashed, false);
      assert.equal(game.snapshot(1).landingSerial, 1);
      assert.ok(game.snapshot(1).wheelImpactSerials.every(serial => serial >= 1), 'second axle never received its own impact');
      assert.ok(Math.abs(game.car.rotation() - roadAngle) < 0.04, 'free axle did not settle');
      for (const wheel of game.snapshot(1).wheels) {
        const clearance = (wheel.y - roadHeight(wheel.x)) * Math.cos(Math.atan(roadSlope(wheel.x))) - CAR_WHEEL_RADIUS;
        assert.ok(clearance >= -0.005, `tire penetrated the slope by ${-clearance}m`);
      }
      return landing.speed;
    } finally { game.dispose(); }
  }
  drop(0);
  for (const pitch of [-0.3, 0.3]) {
    const tilted = drop(pitch);
    assert.ok(tilted > 12, 'landing penalty stopped the run');
  }
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


test('ground boost accelerates without a jump, spends charge, and recharges', () => {
  const game = new GamePhysics();
  const coast = new GamePhysics();
  try {
    stepFor(game, .65, { ...idle, boost: true });
    stepFor(coast, .65);
    const boosted = game.snapshot(1);
    assert.equal(boosted.grounded, true);
    assert.equal(boosted.boostActive, true);
    assert.equal(boosted.jumpSerial, 0);
    assert.ok(boosted.speed > coast.snapshot(1).speed + 2);
    assert.ok(boosted.boost < .75);
    stepFor(game, .5);
    assert.ok(game.snapshot(1).boost > boosted.boost);
  } finally { game.dispose(); coast.dispose(); }
});

test('loop spacing stays 200–400m with small adjustments for reserved ramp landings, and the road stays clear', () => {
  const loops = loopsBetween(0, 25000);
  assert.ok(loops.length > 70);
  let previous = 7;
  const generator = new TrackGenerator();
  for (const loop of loops) {
    const spacing = loop.entryX - previous;
    assert.ok(spacing >= 200 && spacing <= 412, `spacing=${spacing}`);
    if (spacing > 400) {
      const ramp = rampsBetween(previous, loop.entryX)[0];
      assert.ok(ramp && loop.entryX > ramp.end + RAMP_LANDING + 20, 'longer loop spacing must clear a ramp landing');
    }
    previous = loop.entryX;
    for (let x = loop.entryX - 19; x <= loop.entryX + 19; x += 2) {
      const chunk = generator.chunk(Math.floor(x / 30));
      assert.equal(chunk.gap, null);
      assert.equal(chunk.hazards.length, 0);
      assert.equal(generator.hasRoad(x), true);
      const finiteDifference = (roadHeight(x + .001) - roadHeight(x - .001)) / .002;
      assert.ok(Math.abs(finiteDifference - roadSlope(x)) < .001);
    }
  }
});

test('holding suction completes full loops at early and late speeds, awards once, and rejoins', () => {
  for (const index of [0, 3, 7]) {
    const spec = loopsBetween(0, 3000)[index];
    const game = new GamePhysics(index ? 7 : spec.entryX - .2);
    try {
      if (index) placeOnRoad(game, spec.entryX - .2, 18);
      let sawTop = false;
      let previousDistance = 0;
      let maximumProgress = 0;
      for (let i = 0; i < 700 && !game.crashed; i++) {
        game.step({ ...idle, suction: true, boost: index === 3, frontJet:true, rearJet:true });
        const state = game.snapshot(1);
        assert.ok(state.distance >= previousDistance, 'score regressed inside the loop');
        previousDistance = state.distance;
        if (state.loop) {
          maximumProgress = Math.max(maximumProgress, state.loop.progress);
          if (state.loop.progress > .45 && state.loop.progress < .55) {
            sawTop = true;
            const center = loopGeometry(spec);
            assert.ok(state.car.y > center.y + 3);
            assert.ok(Math.cos(state.car.angle - center.angle) < -.9, 'roof should face down at the top');
          }
          for (const wheel of state.wheels) {
            const center = loopGeometry(spec);
            const radial = Math.hypot(wheel.x - center.x, wheel.y - center.y) + CAR_WHEEL_RADIUS;
            assert.ok(Math.abs(radial - spec.radius) < .002, `tire does not follow the inner surface: ${radial}`);
          }
        }
        if (state.loopCompletions) break;
      }
      assert.equal(game.crashed, false);
      assert.equal(sawTop, true);
      assert.ok(maximumProgress > .97);
      assert.equal(game.snapshot(1).loopCompletions, 1);
      assert.equal(game.snapshot(1).flipsCompleted, 0, 'magnetic loop paid an airborne flip');
      assert.equal(game.snapshot(1).flipCoins, 0);
      assert.equal(game.snapshot(1).frontJetActive, false);
      assert.equal(game.snapshot(1).rearJetActive, false);
      assert.equal(game.snapshot(1).runXp, 25);
      stepFor(game, .7, { ...idle, suction: true });
      assert.equal(game.crashed, false);
      assert.equal(game.snapshot(1).loop, null);
      assert.equal(game.snapshot(1).runXp, 25);
      assert.ok(game.snapshot(1).car.x > spec.entryX + 5);
      assert.equal(game.snapshot(1).grounded, true);
    } finally { game.dispose(); }
  }
});

test('ordinary route skips the loop, while releasing suction abandons the reward', () => {
  const spec = loopsBetween(0, 500)[0];
  const normal = new GamePhysics(spec.entryX - 4);
  const released = new GamePhysics(spec.entryX - .2);
  try {
    stepFor(normal, 1.4);
    assert.equal(normal.crashed, false);
    assert.ok(normal.snapshot(1).car.x > spec.entryX + 8);
    assert.equal(normal.snapshot(1).runXp, 0);
    stepFor(released, .65, { ...idle, suction: true });
    const before = released.snapshot(1);
    assert.ok(before.loop && before.loop.progress > .1);
    released.step(idle);
    const after = released.snapshot(1);
    assert.equal(after.loop, null);
    assert.equal(after.grounded, false);
    assert.equal(after.runXp, 0);
    assert.ok(Math.hypot(after.car.x - before.car.x, after.car.y - before.car.y) < .25);
  } finally { normal.dispose(); released.dispose(); }
});

test('police contact costs one health segment and a grounded boost creates escape room', () => {
  const caught = new GamePhysics();
  const escaping = new GamePhysics();
  const airborne = new GamePhysics();
  try {
    for (const game of [caught, escaping, airborne]) {
      game.pursuit.gap = 4.1;
      game.pursuit.idleSeconds = 20;
      game.pursuit.visibility = 1;
    }
    for (let i = 0; i < 14; i++) caught.step(idle);
    assert.equal(caught.crashed, false);
    assert.equal(caught.snapshot(1).health, 75);
    assert.equal(caught.snapshot(1).impactSerial, 1);
    assert.equal(caught.snapshot(1).sparkSerial, 1, 'police contact should emit a metal spark shower');
    assert.ok(caught.snapshot(1).invincibilityRemaining > 0);
    stepFor(escaping, .25, { ...idle, boost: true });
    assert.equal(escaping.crashed, false);
    assert.equal(escaping.snapshot(1).health, 100);
    assert.ok(escaping.snapshot(1).police.gap > 6);
    airborne.car.setTranslation({ x: 7, y: roadHeight(7) + 4 }, true);
    stepFor(airborne, .1);
    assert.equal(airborne.crashed, false, 'police below the player must not cause an air collision');
    assert.equal(airborne.snapshot(1).health, 100);
  } finally { caught.dispose(); escaping.dispose(); airborne.dispose(); }
});

test('releasing suction near loop exits lands safely instead of falling through the ordinary road', () => {
  // Cover uphill/downhill loops, both cruise speeds, boost, and releasing just
  // before completion as well as on the first step after the reward.
  for (const spec of loopsBetween(0, 3000).slice(0, 5)) {
    for (const speed of [11.2, 18]) {
      for (const releaseAt of [.90, .94, .97, .99, 1]) {
        const game = new GamePhysics(speed > 12 ? 7 : spec.entryX - .2);
        const boosted = spec.id === 3;
        let released = false;
        let leftLoop = false;
        const label = `loop=${spec.id}, speed=${speed}, release=${releaseAt}`;
        try {
          if (speed > 12) placeOnRoad(game, spec.entryX - .2, speed);
          for (let i = 0; i < 800 && !game.crashed; i++) {
            const state = game.snapshot(1);
            if ((state.loop?.progress ?? 0) >= releaseAt || state.loopCompletions) released = true;
            game.step({ ...idle, suction: !released, boost: boosted });
            const after = game.snapshot(1);
            if (released && !after.loop) leftLoop = true;
            if (leftLoop) {
              for (const wheel of after.wheels) {
                assert.ok(wheel.y - roadHeight(wheel.x) >= CAR_WHEEL_RADIUS - .025,
                  `tire tunneled through the exit road: ${label}`);
              }
              assert.ok(after.speed >= 6 - .0001 && after.speed <= 28, `bad exit velocity=${after.speed}: ${label}`);
              assert.ok(Math.abs(after.car.angle) < 1.4, `exit retained full-turn rotation: ${label}`);
            }
            // The ordinary road can form another crest after the tangent
            // exit. Allow that physical hop, then require a stable landing.
            if (leftLoop && after.grounded && after.car.x > spec.entryX + 9) break;
          }
          assert.equal(released, true, label);
          assert.equal(game.crashed, false, label);
          assert.equal(game.snapshot(1).grounded, true, label);
          assert.ok(game.snapshot(1).car.x > spec.entryX + 9, label);
          assert.equal(game.snapshot(1).runXp, releaseAt === 1 ? 25 : 0, label);
        } finally { game.dispose(); }
      }
    }
  }
});

test('suspension preserves tire clearance through a loop and resolves heave in the local normal', () => {
  const spec = loopsBetween(0, 500)[0];
  const game = new GamePhysics(spec.entryX - .2);
  let minimumGap = Infinity;
  let sawInvertedCompression = false;
  try {
    for (let i = 0; i < 500 && !game.crashed && !game.snapshot(1).loopCompletions; i++) {
      game.step({ ...idle, suction: true, boost: true });
      const state = game.snapshot(1);
      const body = sprungBodyPose(state.car, state.suspensionOffset, state.suspensionPitch);
      if (Math.cos(state.car.angle) < -.9 && state.suspensionOffset < -.05) {
        assert.ok(body.y > state.car.y, 'compression at the top must move the body toward the tires');
        sawInvertedCompression = true;
      }
      state.wheels.forEach((wheel, index) => {
        const axle = index ? CAR_WHEEL_OFFSET : -CAR_WHEEL_OFFSET;
        const archX = body.x + axle * Math.cos(body.angle) - CAR_AXLE_Y * Math.sin(body.angle);
        const archY = body.y + axle * Math.sin(body.angle) + CAR_AXLE_Y * Math.cos(body.angle);
        minimumGap = Math.min(minimumGap, CAR_ARCH_RADIUS - CAR_WHEEL_RADIUS - Math.hypot(wheel.x - archX, wheel.y - archY));
      });
    }
    assert.equal(game.crashed, false);
    assert.equal(sawInvertedCompression, true);
    assert.ok(minimumGap > .04, `loop tire clearance=${minimumGap}`);
  } finally { game.dispose(); }
});

test('the faster start remains below crest launch speed and restart restores full health', () => {
  const game = new GamePhysics();
  try {
    assert.ok(Math.abs(game.snapshot(1).speed * 3.6 - 60) < .01);
    assert.equal(game.snapshot(1).health, 100);
    assert.equal(game.snapshot(1).impactSerial, 0);
    assert.equal(game.snapshot(1).invincibilityRemaining, 0);
    stepFor(game, 2);
    assert.equal(game.crashed, false);
    assert.equal(game.snapshot(1).grounded, true);
  } finally { game.dispose(); }
});

test('Rapier obstacle contact counts one hit across the chassis and tires; a fourth hit ends the run', () => {
  const track = new TrackGenerator();
  const barriers = Array.from({ length: 20 }, (_, index) => track.chunk(index).hazards).flat()
    .filter(hazard => hazard.kind !== 'drone').slice(0, 4);
  const game = new GamePhysics(barriers[0].x - 4);
  try {
    for (let hit = 1; hit <= 4; hit++) {
      placeOnRoad(game, barriers[hit - 1].x - 4, 12.8);
      for (let i = 0; i < 120 && !game.crashed && game.snapshot(1).impactSerial < hit; i++) game.step(idle);
      assert.equal(game.snapshot(1).health, 100 - hit * 25);
      assert.equal(game.snapshot(1).impactSerial, hit);
      assert.equal(game.snapshot(1).breakSerial, hit);
      assert.equal(game.snapshot(1).obstaclesDestroyed, 0, 'ramming must not award weapon XP');
      assert.equal(game.crashed, hit === 4);
      if (hit < 4) {
        stepFor(game, .15);
        assert.equal(game.snapshot(1).health, 100 - hit * 25, 'same obstacle must not damage through another tire');
        placeOnRoad(game, 10, 12.8);
        stepFor(game, 1.5);
      }
    }
  } finally { game.dispose(); }
});

test('a different obstacle during flashing protection causes no extra damage', () => {
  const track = new TrackGenerator();
  const first = track.chunk(2).hazards[0];
  const second = track.chunk(5).hazards[0];
  const game = new GamePhysics(first.x - 4);
  try {
    while (game.snapshot(1).impactSerial === 0 && !game.crashed) game.step(idle);
    assert.equal(game.snapshot(1).health, 75);
    placeOnRoad(game, second.x - 3, 12.8);
    stepFor(game, .45);
    assert.ok(game.snapshot(1).car.x > second.x + 2);
    assert.ok(game.snapshot(1).invincibilityRemaining > 0);
    assert.equal(game.snapshot(1).health, 75);
    assert.equal(game.snapshot(1).impactSerial, 1);
    assert.equal(game.snapshot(1).sparkSerial, 2, 'protected collisions should still throw sparks');
  } finally { game.dispose(); }
});

test('ramming each hazard type shatters it once and keeps it destroyed when chunks reload', () => {
  const track = new TrackGenerator();
  for (const index of [2, 3, 5]) {
    const spec = track.chunk(index).hazards[0];
    const game = new GamePhysics(spec.x - 3);
    try {
      const hazard = game.chunks.get(index).hazards[0];
      if (spec.kind === 'drone') {
        game.car.setTranslation({ x: spec.x - 3, y: hazard.y }, true);
        game.car.setLinvel({ x: 14, y: 0 }, true);
      }
      for (let i = 0; i < 80 && !game.snapshot(1).breakSerial; i++) game.step(idle);
      const state = game.snapshot(1);
      assert.equal(state.breakSerial, 1, spec.kind);
      assert.equal(state.health, 75);
      assert.equal(state.runXp, 0);
      assert.equal(hazard.health, 0);
      assert.equal(hazard.collider.isEnabled(), false);
      assert.equal(state.breakEvents[0].kind, spec.kind);
      assert.equal(state.breakEvents[0].source, 'ram');
      assert.ok(state.breakEvents[0].speed > 0);
      assert.equal(state.sparkSerial, 1, spec.kind);
      assert.ok(Math.abs(state.sparkEvents[0].x - spec.x) < 1.1, 'sparks must originate at the obstacle contact');
      assert.ok(state.sparkEvents[0].strength > 8);
      placeOnRoad(game, 600, 14); game.step({ ...idle, suction: true });
      placeOnRoad(game, spec.x - 3, 14); stepFor(game, 0.4, { ...idle, suction: true });
      assert.equal(game.chunks.get(index).hazards[0].health, 0);
      assert.equal(game.snapshot(1).breakSerial, 1, 'revisited obstacle shattered twice');
      assert.equal(game.snapshot(1).health, 75);
    } finally { game.dispose(); }
  }
});

test('police passes under a full loop, returns behind, and contact uses the health/impact system', () => {
  const spec = loopsBetween(0, 500)[0];
  const game = new GamePhysics(spec.entryX - .2);
  game.pursuit.gap = 7;
  game.pursuit.idleSeconds = 20;
  game.pursuit.visibility = 1;
  let previousPoliceX = -Infinity;
  let wentBackward = false;
  let previousCarX = game.car.translation().x;
  try {
    for (let i = 0; i < 600 && !game.snapshot(1).loopCompletions; i++) {
      game.step({ ...idle, suction: true });
      const state = game.snapshot(1);
      assert.equal(state.health, 100, 'a car inside the loop cannot be hit by a patrol on the ordinary road');
      assert.ok(state.police.x > previousPoliceX, 'patrol must keep moving during the lap');
      assert.ok(state.police.y < roadHeight(state.police.x) + 1.1, 'patrol followed the car into the loop');
      if (state.car.x < previousCarX) wentBackward = true;
      previousCarX = state.car.x;
      previousPoliceX = state.police.x;
    }
    assert.equal(wentBackward, true);
    assert.equal(game.snapshot(1).loopCompletions, 1);
    assert.equal(game.snapshot(1).runXp, 25);
    assert.equal(game.snapshot(1).police.mode, 'rejoining');
    assert.ok(game.snapshot(1).police.x > game.snapshot(1).car.x, 'patrol should have driven beyond the loop');
    let sawImpact = false;
    let returnedBehind = false;
    for (let i = 0; i < 1000 && !game.crashed; i++) {
      for (const chunk of game.chunks.values()) for (const hazard of chunk.hazards) hazard.collider.setEnabled(false);
      game.step({ ...idle, suction: true });
      const state = game.snapshot(1);
      assert.ok(state.police.x >= previousPoliceX - .001, 'patrol reversed or warped during regroup');
      previousPoliceX = state.police.x;
      if (state.impactSerial) {
        sawImpact = true;
        assert.equal(state.health, 75);
        assert.equal(state.impactSerial, 1, 'bumper overlap must not count twice');
      }
      if (sawImpact && state.police.mode === 'chasing' && state.police.gap >= 11.9) {
        returnedBehind = true; break;
      }
    }
    assert.equal(game.crashed, false);
    assert.equal(sawImpact, true);
    assert.equal(returnedBehind, true);
  } finally { game.dispose(); }
});

test('an abandoned loop does not move the police back behind the player', () => {
  const spec = loopsBetween(0, 500)[0];
  const game = new GamePhysics(spec.entryX - .2);
  game.pursuit.gap = 7; game.pursuit.idleSeconds = 20; game.pursuit.visibility = 1;
  try {
    stepFor(game, .6, { ...idle, suction: true });
    const before = game.snapshot(1).police.x;
    game.step(idle);
    const after = game.snapshot(1);
    assert.equal(after.loop, null);
    assert.equal(after.loopCompletions, 0);
    assert.equal(after.police.mode, 'intercepting');
    assert.ok(after.police.x > before);
    assert.ok(after.police.x - before < .2);
  } finally { game.dispose(); }
});

test('four police contacts use four health segments and report the fatal police impact', () => {
  const game = new GamePhysics(10);
  try {
    for (let hit = 1; hit <= 4; hit++) {
      assert.equal(game.pursuit.mode, 'chasing');
      // Keep contact on the same road segment, rather than on a crest that
      // the faster car can reach during its post-impact protection period.
      placeOnRoad(game, 10, 14);
      game.pursuit.gap = 3.85;
      game.pursuit.x = game.car.translation().x - game.pursuit.gap;
      game.pursuit.idleSeconds = 20;
      game.pursuit.visibility = 1;
      game.step(idle);
      assert.equal(game.snapshot(1).health, 100 - hit * 25);
      assert.equal(game.snapshot(1).impactSerial, hit);
      assert.equal(game.snapshot(1).sparkSerial, hit, 'each police impact should create one shower');
      assert.equal(game.crashed, hit === 4);
      if (hit < 4) {
        for (let i = 0; i < 360 && (game.pursuit.mode !== 'chasing' || game.snapshot(1).invincibilityRemaining > 0); i++) {
          for (const chunk of game.chunks.values()) for (const hazard of chunk.hazards) hazard.collider.setEnabled(false);
          game.step(idle);
          assert.equal(game.snapshot(1).health, 100 - hit * 25);
        }
      }
    }
    assert.equal(game.snapshot(1).crashReason, 'police');
  } finally { game.dispose(); }
});

test('every unlocked weapon can destroy a real road barrier and disable its Rapier collider', () => {
  const barrier = new TrackGenerator().chunk(2).hazards[0];
  for (const id of ['machine-gun','twin-gun','gatling-gun','cannon','rocket-launcher','missile-launcher','laser-gun','plasma-cannon']) {
    // Allow the heavy weapons their firing interval before contact at 60 km/h.
    const game = new GamePhysics(barrier.x - 20, { id, xp: 3800 });
    try {
      for (let i=0;i<240&&!game.crashed&&game.car.translation().x<barrier.x+3;i++) {
        game.step({...idle,suction:true,fire:true,aim:1});
      }
      const state = game.snapshot(1);
      const destroyed = game.chunks.get(2).hazards.find(hazard => hazard.spec.id===barrier.id);
      assert.equal(destroyed.health,0,id);
      assert.equal(destroyed.collider.isEnabled(),false,id);
      assert.equal(game.hazardStates.some(hazard=>hazard.id===barrier.id),false,id);
      assert.equal(state.health,100,id);
      assert.equal(state.sparkEvents.some(event => event.kind === 'collision'),false,'shooting must not trigger a chassis collision');
      assert.ok(state.sparkEvents.some(event => event.kind === 'projectile'),id);
      assert.ok(state.weapon.destroySerial>=1,id);
      assert.equal(game.explosionSerial,state.weapon.destroySerial,id);
      assert.ok(state.breakEvents.some(event=>event.hazardId===barrier.id&&event.source==='weapon'),id);
      assert.ok(state.obstaclesDestroyed>=1,id);
      assert.equal(state.policeDestroyed,0,id);
      assert.equal(state.runXp,state.obstaclesDestroyed*10,id);
      assert.equal(game.crashed,false,id);
    } finally { game.dispose(); }
  }
});

test('a wreck releases each wheel into solid terrain physics, preserves momentum and cannot earn more distance or XP', () => {
  const game = new GamePhysics(60);
  try {
    game.stepWreck();
    assert.equal(game.snapshot(1).wrecked, false, 'living cars must keep independent suspension control');
    assert.equal(game.snapshot(1).crashPosition, null);
    game.car.setTranslation({ x: 60, y: roadHeight(60) + 3 }, true);
    game.car.setLinvel({ x: 14, y: -2 }, true);
    game.car.setAngvel(1, true);
    game.crashed = true;
    const distance = game.distance;
    const crashPosition = { ...game.car.translation() };
    game.stepWreck();
    assert.equal(game.snapshot(1).wrecked, true);
    assert.deepEqual(game.snapshot(1).crashPosition, crashPosition);
    assert.ok(game.car.linvel().x > 12, 'slow motion must preserve momentum, rather than halve velocity');
    assert.equal(game.car.collider(0).isSensor(), false);
    assert.ok(game.wheels.every(wheel => !wheel.collider(0).isSensor()));
    const startingWheels = game.snapshot(1).wheels;
    for (let i = 0; i < 360; i++) game.stepWreck();
    const state = game.snapshot(1);
    assert.deepEqual(state.crashPosition, crashPosition, 'camera focus must stay at the fatal position while the wreck moves');
    assert.ok(Math.abs(state.car.x - crashPosition.x) > 1, 'the wreck should move independently of its camera anchor');
    assert.ok(state.car.y > roadHeight(state.car.x) - .5, 'chassis fell through the road');
    assert.ok(state.wheels.every((wheel, i) => wheel.x > startingWheels[i].x + 4));
    assert.ok(state.wheels.every(wheel => wheel.y > roadHeight(wheel.x) + CAR_WHEEL_RADIUS - .15));
    assert.ok(state.wheels.some(wheel => Math.abs(wheel.x - state.car.x) > CAR_WHEEL_OFFSET + 2), 'wheel remained attached to chassis');
    assert.equal(state.distance, distance);
    assert.equal(state.runXp, 0);
    assert.equal(state.boostActive, false);
    assert.equal(state.suctionActive, false);
    assert.equal(state.jumpJetActive, false);
  } finally { game.dispose(); }
});

test('loose wreck parts collide with surviving obstacles and keep terrain streamed under separated wheels', () => {
  const game = new GamePhysics(78);
  try {
    const hazard = game.chunks.get(2).hazards[0];
    game.car.setTranslation({ x: hazard.x - 3.5, y: hazard.y + .1 }, true);
    game.car.setLinvel({ x: 12, y: 0 }, true);
    game.car.setRotation(0, true);
    game.crashed = true;
    for (let i = 0; i < 120; i++) game.stepWreck();
    assert.equal(hazard.collider.isSensor(), false);
    assert.equal(hazard.health, 3, 'wreck collisions must not grant destruction rewards');
    assert.ok(game.car.translation().x < hazard.x - 1, 'wreck passed through a surviving barrier');
    assert.ok(Math.abs(game.car.linvel().x) < 1, 'solid obstacle failed to absorb the wreck momentum');
    assert.ok(game.snapshot(1).sparkSerial > 0, 'wreck contacts should throw sparks behind the menu');
    const chassisChunk = Math.floor(game.car.translation().x / 30);
    const wheelX = game.car.translation().x + 150;
    game.wheels[1].setTranslation({ x: wheelX, y: roadHeight(wheelX) + 1 }, true);
    game.stepWreck();
    assert.ok(game.chunks.has(Math.floor(wheelX / 30)), 'detached wheel lost streamed terrain');
    assert.ok(game.chunks.has(chassisChunk), 'streaming for a wheel removed terrain under the chassis');
    assert.ok(game.chunks.get(Math.floor(wheelX / 30)).roads.every(road => !road.isSensor()));
  } finally { game.dispose(); }
});

test('rear fire stops a real patrol; its disabled wreck cannot damage the player', () => {
  const game = new GamePhysics(20);
  game.pursuit.gap=13;game.pursuit.idleSeconds=20;game.pursuit.visibility=1;
  let sawNonfatalSparks=false;
  try {
    for(let i=0;i<480&&!game.crashed&&!game.snapshot(1).police.disabled;i++) {
      game.step({...idle,suction:true,fire:true,aim:-1});
      const current=game.snapshot(1);
      if(current.police.health>0&&current.police.health<12&&current.sparkEvents.some(event=>event.kind==='projectile'))sawNonfatalSparks=true;
    }
    let state=game.snapshot(1);
    assert.equal(state.police.health,0);
    assert.equal(state.police.disabled,true);
    assert.equal(state.health,100);
    assert.equal(state.weapon.hitSerial,12);
    assert.equal(sawNonfatalSparks,true,'surviving police hits must produce sparks before destruction');
    assert.equal(state.policeDestroyed,1);
    assert.equal(state.obstaclesDestroyed,0);
    assert.equal(state.runXp,20);
    assert.ok(state.policeWreck);
    assert.equal(state.policeWreck.wheels.length,2);
    assert.equal(state.policeWreck.serial,1);
    const wreckBefore=state.policeWreck.body;
    placeOnRoad(game,state.police.x,14);
    stepFor(game,.25,{...idle,suction:true});
    state=game.snapshot(1);
    assert.equal(state.health,100,'disabled police caused contact damage');
    assert.equal(state.police.disabled,true);
    assert.equal(state.policeDestroyed,1,'fading police must not award XP twice');
    assert.equal(state.runXp,20);
    assert.ok(state.policeWreck.age>.2);
    assert.notDeepEqual(state.policeWreck.body,wreckBefore,'destroyed police must keep simulating independently');
  } finally { game.dispose(); }
});

test('nonfatal weapon hits and ramming an obstacle award no destruction XP', () => {
  const barrier=new TrackGenerator().chunk(2).hazards[0];
  const game=new GamePhysics(barrier.x-14);
  try {
    // Let the turret settle its elevation before firing the single test shot.
    stepFor(game,.1,{...idle,suction:true});
    game.step({...idle,suction:true,fire:true,aim:1});
    stepFor(game,1.4,{...idle,suction:true});
    const state=game.snapshot(1);
    const hazard=game.chunks.get(2).hazards.find(hazard=>hazard.spec.id===barrier.id);
    assert.ok(state.weapon.hitSerial>0);
    assert.equal(hazard.health,0);
    assert.equal(hazard.collider.isEnabled(),false);
    assert.equal(state.breakEvents.at(-1).source,'ram');
    assert.ok(state.health<100,'fixture must include a real collision');
    assert.equal(state.obstaclesDestroyed,0);
    assert.equal(state.policeDestroyed,0);
    assert.equal(state.runXp,0);
  } finally {game.dispose();}
});

test('destroyed obstacles stay destroyed when a chunk reloads and cannot pay XP again', () => {
  const barrier=new TrackGenerator().chunk(2).hazards[0];
  const game=new GamePhysics(barrier.x-14);
  try {
    for(let i=0;i<160&&!game.snapshot(1).obstaclesDestroyed;i++) game.step({...idle,suction:true,fire:true});
    assert.equal(game.snapshot(1).obstaclesDestroyed,1);
    assert.equal(game.snapshot(1).runXp,10);
    game.ensureChunks(barrier.x+180);
    assert.equal(game.chunks.has(2),false);
    game.ensureChunks(barrier.x);
    const hazard=game.chunks.get(2).hazards.find(hazard=>hazard.spec.id===barrier.id);
    assert.equal(hazard.health,0);
    assert.equal(hazard.collider.isEnabled(),false);
    assert.equal(game.hazardStates.some(hazard=>hazard.id===barrier.id),false);
    assert.equal(game.snapshot(1).obstaclesDestroyed,1);
    assert.equal(game.snapshot(1).runXp,10);
  } finally {game.dispose();}
});

test('weapons follow a complete loop without changing driving, XP, or suspension stability', () => {
  const spec=loopsBetween(0,500)[0];
  const game=new GamePhysics(spec.entryX-.2,{id:'plasma-cannon',xp:3800});
  try {
    for(let i=0;i<600&&!game.crashed&&!game.snapshot(1).loopCompletions;i++) {
      game.step({...idle,suction:true,fire:true,aim:-1});
    }
    const state=game.snapshot(1);
    assert.equal(game.crashed,false);
    assert.equal(state.loopCompletions,1);
    assert.equal(state.runXp,25);
    assert.equal(state.health,100);
    assert.equal(state.grounded,true);
    assert.ok(state.weapon.ammo<18);
    assert.equal(game.equipWeapon('laser-gun',2799),false);
    assert.equal(game.snapshot(1).weapon.id,'plasma-cannon');
  } finally { game.dispose(); }
});

test('real physics loads saved upgrades and applies extra capacity without refilling spent ammunition', () => {
  const game = new GamePhysics(7, { id:'machine-gun', xp:200,
    upgrades:{ 'machine-gun':2, 'twin-gun':3 } });
  try {
    assert.equal(game.snapshot(1).weapon.level, 2);
    assert.equal(game.snapshot(1).weapon.capacity, 112);
    game.step({ ...idle, fire:true });
    assert.equal(game.snapshot(1).weapon.ammo, 111);
    game.upgradeWeapon('machine-gun', 3);
    assert.equal(game.snapshot(1).weapon.capacity, 128);
    assert.equal(game.snapshot(1).weapon.ammo, 127);
    game.upgradeWeapon('machine-gun', 3);
    assert.equal(game.snapshot(1).weapon.ammo, 127);
    assert.equal(game.equipWeapon('twin-gun', 200), true);
    assert.equal(game.snapshot(1).weapon.level, 3);
    assert.equal(game.snapshot(1).weapon.capacity, 160);
    assert.equal(game.snapshot(1).weapon.ammo, 160);
    game.equipWeapon('machine-gun', 200);
    assert.equal(game.snapshot(1).weapon.ammo, 127);
  } finally { game.dispose(); }
});

test('four purchased armor plates absorb real obstacle contacts before four hull hits end the run',()=>{
  const track=new TrackGenerator();
  const barriers=Array.from({length:20},(_,index)=>track.chunk(index).hazards).flat().filter(hazard=>hazard.kind!=='drone').slice(0,8);
  const game=new GamePhysics(barriers[0].x-4,{id:'machine-gun',xp:0,carUpgrades:{armor:4}});
  try {
    assert.equal(game.snapshot(1).maxHealth,200);
    for(let hit=1;hit<=8;hit++) {
      placeOnRoad(game,barriers[hit-1].x-4,12.8);
      for(let step=0;step<120&&!game.crashed&&game.snapshot(1).impactSerial<hit;step++) game.step(idle);
      const state=game.snapshot(1);
      assert.equal(state.impactSerial,hit);
      assert.equal(state.health,200-hit*25);
      assert.equal(state.hullHealth,hit<=4?100:200-hit*25);
      assert.equal(state.armorMask,hit<4?15&~((1<<hit)-1):0);
      assert.equal(game.crashed,hit===8);
      if(hit<8) { placeOnRoad(game,-48,12.8); stepFor(game,1.5); }
    }
  } finally {game.dispose();}
});

test('reserve doubles boost duration and power increases both acceleration and boosted top speed',()=>{
  const plain=new GamePhysics(-48);
  const reserve=new GamePhysics(-48,{id:'machine-gun',xp:0,carUpgrades:{'boost-reserve':4}});
  const power=new GamePhysics(-48,{id:'machine-gun',xp:0,carUpgrades:{'boost-power':4}});
  try {
    for(const game of [plain,reserve,power]) stepFor(game,.65,{...idle,boost:true});
    const base=plain.snapshot(1); const larger=reserve.snapshot(1); const stronger=power.snapshot(1);
    assert.ok(Math.abs((1-base.boost)-2*(1-larger.boost))<1e-9,'twice the tank should consume half the percentage');
    assert.ok(stronger.speed>base.speed+4);
    assert.ok(stronger.speed>27,'power upgrades must raise the former boost speed ceiling');
    const oldFuel=base.boost;
    plain.upgradeCar({'boost-reserve':1});
    assert.ok(Math.abs(plain.snapshot(1).boost-(oldFuel+.25)/1.25)<1e-9,'only newly unlocked fuel capacity is added');
    const remaining=plain.snapshot(1).boost;
    plain.upgradeCar({'boost-reserve':1,'boost-power':1});
    assert.equal(plain.snapshot(1).boost,remaining,'reapplying upgrades cannot refill fuel');
  } finally {plain.dispose();reserve.dispose();power.dispose();}
});
