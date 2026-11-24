import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachLanServer } from '../server/lan.mjs';

test('the LAN server handles room capacity, synchronized rounds, and race results', { timeout: 12_000 }, async t => {
  const server = createServer();
  const stop = attachLanServer(server);
  t.after(() => {
    stop();
    return new Promise(resolve => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const host = `127.0.0.1:${server.address().port}`;

  async function connect() {
    const socket = new WebSocket(`ws://${host}/roadster-lan`, { origin: `http://${host}` });
    socket.on('error', () => {});
    const messages = [];
    let wake;
    socket.on('message', data => {
      messages.push(JSON.parse(data.toString()));
      wake?.();
    });
    async function receive(predicate) {
      for (;;) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(0, index + 1).at(-1);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('No matching LAN message received')), 4000);
          wake = () => { clearTimeout(timer); resolve(); };
        });
        wake = undefined;
      }
    }
    const { id } = await receive(message => message.type === 'hello');
    return { id, receive, send: message => socket.send(JSON.stringify(message)), close: () => socket.close() };
  }

  const [owner, guest, third, fourth, extra] = await Promise.all(Array.from({ length: 5 }, connect));
  const room = (client, phase, condition = () => true) =>
    client.receive(message => message.type === 'room' && message.phase === phase && condition(message));
  const error = client => client.receive(message => message.type === 'error');

  extra.send({ type: 'join', name: 'Extra', code: 'AAAAAA' });
  assert.equal((await error(extra)).code, 'missing');
  owner.send({ type: 'create', name: 'Owner' });
  const { code } = await room(owner, 'lobby');
  owner.send({ type: 'start' });
  for (const [i, client] of [guest, third, fourth].entries()) {
    client.send({ type: 'join', name: `Guest ${i + 1}`, code });
    await room(client, 'lobby', state => state.players.length === i + 2);
  }
  const full = await room(owner, 'lobby', state => state.players.length === 4);
  assert.equal(new Set(full.players.map(player => player.paint)).size, 4);
  assert.equal(full.round, 0);
  extra.send({ type: 'join', name: 'Extra', code });
  assert.equal((await error(extra)).code, 'full');
  guest.send({ type: 'start' });
  await room(guest, 'lobby', state => state.players.length === 4);
  owner.send({ type: 'start' });
  const waiting = await room(owner, 'countdown');
  assert.equal(waiting.round, 1);
  assert.equal((await room(guest, 'countdown')).startsAt, waiting.startsAt);
  extra.send({ type: 'join', name: 'Extra', code });
  assert.equal((await error(extra)).code, 'closed');

  const firstRound = await room(owner, 'racing');
  const drive = (client, round, distance, crashed = false) => {
    const car = { x: distance + 7, y: 2, angle: 0.1 };
    client.send({ type: 'drive', round, car, wheels: [car, car], distance, crashed });
  };
  drive(owner, firstRound.round, 100);
  drive(owner, firstRound.round, 111, true);
  drive(guest, firstRound.round, 120, true);
  third.close();
  fourth.close();
  const results = await room(owner, 'results');
  assert.equal(results.players.find(player => player.id === owner.id).drive.crashed, true);
  assert.equal(results.players.find(player => player.id === owner.id).drive.distance, 111);
  assert.equal(results.winner, guest.id);

  owner.send({ type: 'rematch' });
  const lobby = await room(owner, 'lobby', state => state.players.length === 2);
  assert.ok(lobby.players.every(player => player.drive === null && player.connected));
  owner.close();
  assert.equal((await room(guest, 'lobby', state => state.players.length === 1)).host, guest.id);
  extra.send({ type: 'join', name: 'Extra', code });
  await room(extra, 'lobby');
  guest.send({ type: 'start' });
  const secondRound = await room(guest, 'racing');
  assert.equal(secondRound.round, firstRound.round + 1);
  drive(extra, firstRound.round, secondRound.target);
  drive(extra, secondRound.round, 12);
  await room(guest, 'racing', state => state.players.find(player => player.id === extra.id).drive?.distance === 12);
  drive(guest, secondRound.round, secondRound.target);
  assert.equal((await room(extra, 'results')).winner, guest.id);
});
