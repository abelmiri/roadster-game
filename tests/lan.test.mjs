import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PLAYERS, RaceRoom } from '../src/lan/room-engine.mjs';

test('a race room admits exactly two drivers and produces shared results', () => {
  let state;
  const room = new RaceRoom('ABC234', 1, next => { state = next; });
  assert.equal(MAX_PLAYERS, 2);
  assert.equal(room.join(1, 'Laptop', 1000), null);
  assert.equal(room.join(2, 'Phone', 1000), null);
  assert.equal(room.join(3, 'Third', 1000), 'full');
  room.receive(2, { type: 'start' }, 1100);
  assert.equal(state.phase, 'lobby');
  room.receive(1, { type: 'start' }, 1200);
  assert.equal(state.phase, 'countdown');
  room.tick(state.startsAt);
  assert.equal(state.phase, 'racing');
  const pose = { x: 10, y: 2, angle: 0 };
  room.receive(2, { type: 'drive', round: state.round, car: pose, wheels: [pose, pose], distance: 1000, crashed: false }, state.startsAt + 100);
  assert.equal(state.phase, 'results');
  assert.equal(state.winner, 2);
  assert.equal(state.players.length, 2);
});
