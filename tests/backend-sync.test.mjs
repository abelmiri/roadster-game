import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let GameSync;
before(async () => {
  const outfile = path.resolve('node_modules/.cache/roadster-backend-test.mjs');
  await build({ entryPoints: ['src/backend.ts'], bundle: true, platform: 'node', format: 'esm', outfile,
    define: { 'import.meta.env.VITE_ROADSTER_API_URL': '"https://api.example"' } });
  ({ GameSync } = await import(pathToFileURL(outfile).href));
});

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test('cloud save wins at login; run creation and writes carry sequential revisions', async () => {
  const local = storage({
    'roadster-api-session': JSON.stringify({ playerId: 'p', token: 'secret', expiresAt: Date.now() + 100000 }),
    'roadster-progress': JSON.stringify({ version: 1, coins: 2, score: 10 }),
    'roadster-xp': '5',
  });
  globalThis.localStorage = local;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body);
    calls.push({ url, method: options.method, body, auth: options.headers?.Authorization });
    if (url.endsWith('/v1/me/progress') && options.method === 'GET') return response(200, { revision: 4, progress: { version: 1, coins: 100, score: 30 }, xp: 80 });
    if (url.endsWith('/v1/runs')) return response(201, { runId: 'r', revision: 5 });
    if (url.endsWith('/v1/me/progress') && options.method === 'PUT') return response(200, { revision: body.revision + 1 });
    throw new Error(`Unexpected ${url}`);
  };
  const sync = new GameSync(local);
  assert.equal(await sync.initialize(), true);
  assert.equal(JSON.parse(local.getItem('roadster-progress')).coins, 100);
  assert.equal(local.getItem('roadster-xp'), '80');
  await sync.beginRun();
  local.setItem('roadster-progress', JSON.stringify({ version: 1, coins: 110, score: 20 }));
  sync.changed('roadster-progress');
  await sync.flush();
  await sync.finishRun();
  const posts = calls.filter(call => call.method === 'POST');
  const puts = calls.filter(call => call.method === 'PUT');
  assert.equal(posts.length, 1);
  assert.ok(posts[0].body.idempotencyKey);
  assert.deepEqual(puts.map(call => [call.body.revision, call.body.runId, call.body.runStatus]), [[5, 'r', 'active'], [6, 'r', 'finished']]);
  assert.ok(calls.every(call => call.auth === 'Bearer secret'));
});

test('revision conflict blocks later writes until player loads cloud save', async () => {
  const local = storage({
    'roadster-api-session': JSON.stringify({ playerId: 'p', token: 'secret', expiresAt: Date.now() + 100000 }),
    'roadster-progress': JSON.stringify({ version: 1, coins: 10, score: 0 }),
  });
  globalThis.localStorage = local;
  let puts = 0;
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'PUT') {
      puts++;
      return response(409, { error: 'revision_conflict', current: { revision: 3, progress: { version: 1, coins: 50, score: 0 }, xp: 8 } });
    }
    return response(200, { revision: 3, progress: { version: 1, coins: 50, score: 0 }, xp: 8 });
  };
  const sync = new GameSync(local);
  await sync.initialize();
  local.setItem('roadster-progress', JSON.stringify({ version: 1, coins: 11, score: 0 }));
  sync.changed('roadster-progress');
  await assert.rejects(sync.flush(), { code: 'revision_conflict' });
  assert.equal(sync.hasConflict, true);
  await sync.flush();
  assert.equal(puts, 1);
  await sync.refreshFromServer();
  assert.equal(sync.hasConflict, false);
  assert.equal(JSON.parse(local.getItem('roadster-progress')).coins, 50);
});

test('a lost run response retries with the original idempotency key', async () => {
  const local = storage({
    'roadster-api-session': JSON.stringify({ playerId: 'p', token: 'secret', expiresAt: Date.now() + 100000 }),
    'roadster-progress': JSON.stringify({ version: 1, coins: 0, score: 0 }),
  });
  globalThis.localStorage = local;
  const keys = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/v1/me/progress')) return response(200, { revision: 1, progress: { version: 1, coins: 0, score: 0 }, xp: 0 });
    const key = JSON.parse(options.body).idempotencyKey;
    keys.push(key);
    if (keys.length === 1) throw new Error('response_lost');
    return response(200, { runId: 'r', revision: 2 });
  };
  const sync = new GameSync(local);
  await sync.initialize();
  await assert.rejects(sync.beginRun(), /response_lost/);
  await sync.beginRun();
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test('an unsent save survives reload and uploads before reading the cloud', async () => {
  const local = storage({
    'roadster-api-session': JSON.stringify({ playerId: 'p', token: 'secret', expiresAt: Date.now() + 100000 }),
    'roadster-api-sync': JSON.stringify({ playerId: 'p', revision: 7, dirty: true, runId: 'r', runStatus: 'finished' }),
    'roadster-progress': JSON.stringify({ version: 1, coins: 70, score: 300 }),
    'roadster-xp': '20',
  });
  globalThis.localStorage = local;
  const methods = [];
  globalThis.fetch = async (_url, options = {}) => {
    methods.push(options.method);
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      assert.equal(body.revision, 7);
      assert.equal(body.runStatus, 'finished');
      return response(200, { revision: 8 });
    }
    return response(200, { revision: 8, progress: { version: 1, coins: 70, score: 300 }, xp: 20 });
  };
  const sync = new GameSync(local);
  assert.equal(await sync.initialize(), true);
  assert.deepEqual(methods, ['PUT', 'GET']);
  assert.equal(JSON.parse(local.getItem('roadster-api-sync')).dirty, false);
});
