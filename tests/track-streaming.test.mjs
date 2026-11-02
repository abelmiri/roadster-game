import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('procedural scenery stays bounded after streaming and regenerates on revisit or restart', async () => {
  const outdir = path.resolve('node_modules/.cache/roadster-track-streaming-tests');
  await build({ entryPoints: ['src/game/track.ts'], bundle: true, platform: 'node', format: 'esm',
    outdir, outExtension: { '.js': '.mjs' } });
  const track = await import(pathToFileURL(path.join(outdir, 'track.mjs')).href);
  const { loopsBetween, rampsBetween, ragdollsBetween, gapSpectatorsBetween,
    trimTrackCaches, resetTrackCaches, trackCacheSizes } = track;

  resetTrackCaches();
  const far = {
    loops: loopsBetween(19_500, 20_000),
    ramps: rampsBetween(19_500, 20_000),
    ragdolls: ragdollsBetween(19_500, 20_000),
    spectators: gapSpectatorsBetween(19_500, 20_000),
  };
  const near = {
    loops: loopsBetween(0, 500),
    ramps: rampsBetween(0, 500),
    ragdolls: ragdollsBetween(0, 500),
    spectators: gapSpectatorsBetween(0, 500),
  };
  assert.ok(trackCacheSizes().spectators > 100);
  trimTrackCaches(19_500);
  const sizes = trackCacheSizes();
  assert.ok(sizes.loops < 5 && sizes.ramps < 5 && sizes.ragdolls < 7 && sizes.spectators < 10,
    `old scenery remained cached: ${JSON.stringify(sizes)}`);
  assert.deepEqual(loopsBetween(19_500, 20_000), far.loops);
  assert.deepEqual(rampsBetween(19_500, 20_000), far.ramps);
  assert.deepEqual(ragdollsBetween(19_500, 20_000), far.ragdolls);
  assert.deepEqual(gapSpectatorsBetween(19_500, 20_000), far.spectators);
  assert.deepEqual(loopsBetween(0, 500), near.loops);
  assert.deepEqual(rampsBetween(0, 500), near.ramps);
  assert.deepEqual(ragdollsBetween(0, 500), near.ragdolls);
  assert.deepEqual(gapSpectatorsBetween(0, 500), near.spectators);

  resetTrackCaches();
  assert.deepEqual(trackCacheSizes(), { loops: 0, ramps: 0, ragdolls: 0, spectators: 0 });
  assert.deepEqual(ragdollsBetween(0, 500), near.ragdolls);
  assert.deepEqual(gapSpectatorsBetween(0, 500), near.spectators);
});
