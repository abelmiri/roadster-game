import { randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';

import { driverName, RaceRoom, ROOM_ALPHABET } from '../src/lan/room-engine.mjs';

const PATH = '/roadster-lan';

function privateAddress(address) {
  return typeof address === 'string' &&
    /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.replace(/^::ffff:/, ''));
}

function lanAddress(localAddress) {
  const direct = localAddress?.replace(/^::ffff:/, '');
  const interfaces = Object.values(networkInterfaces()).flat().filter(info =>
    info?.family === 'IPv4' && !info.internal && privateAddress(info.address));
  if (interfaces.some(info => info.address === direct)) return direct;
  return interfaces[0]?.address ?? null;
}

export function attachLanServer(httpServer) {
  const relay = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const rooms = new Map();
  const clients = new Map();
  const responsive = new WeakSet();
  let nextPlayerId = 1;

  function send(socket, message) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount >= 64 * 1024) socket.terminate();
    else socket.send(JSON.stringify(message));
  }

  function broadcast(room) {
    for (const member of room.players) {
      const socket = clients.get(member.id);
      if (member.connected && socket) send(socket, room);
    }
  }

  function handle(player, message, now) {
    if (!message || typeof message !== 'object') return;
    if (message.type !== 'create' && message.type !== 'join') {
      player.room?.receive(player.id, message, now);
      return;
    }
    if (player.room) return;
    const name = driverName(message.name);
    const error = code => send(player.socket, { type: 'error', code });
    if (!name) return error('name');
    let room;
    if (message.type === 'create') {
      let code;
      do {
        code = Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
      } while (rooms.has(code));
      room = new RaceRoom(code, player.id, broadcast);
      rooms.set(code, room);
    } else {
      room = rooms.get(message.code);
      if (!room) return error('missing');
    }
    const failure = room.join(player.id, name, now);
    if (failure) error(failure);
    else player.room = room;
  }

  function upgrade(request, socket, head) {
    if (request.url !== PATH) return;
    const origin = request.headers.origin;
    const scheme = request.socket.encrypted ? 'https' : 'http';
    if (origin !== `${scheme}://${request.headers.host}` || relay.clients.size >= 64) {
      socket.destroy();
      return;
    }
    relay.handleUpgrade(request, socket, head, ws => relay.emit('connection', ws, request));
  }

  relay.on('connection', (socket, request) => {
    const player = { id: nextPlayerId++, socket, room: null };
    clients.set(player.id, socket);
    let windowStart = 0;
    let messages = 0;
    responsive.add(socket);
    socket.on('pong', () => responsive.add(socket));
    socket.on('message', (data, binary) => {
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; messages = 0; }
      if (++messages > 60) { socket.close(1008); return; }
      if (binary) return;
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      handle(player, message, now);
    });
    socket.once('close', () => {
      clients.delete(player.id);
      player.room?.leave(player.id, Date.now());
      if (player.room?.empty) rooms.delete(player.room.code);
    });
    socket.on('error', () => socket.terminate());
    send(socket, { type: 'hello', id: player.id, address: lanAddress(request.socket.localAddress) });
  });

  const heartbeat = setInterval(() => {
    for (const socket of relay.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (responsive.delete(socket)) socket.ping();
      else socket.terminate();
    }
  }, 10_000);
  const tick = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) room.tick(now);
  }, 40);
  heartbeat.unref();
  tick.unref();

  httpServer.on('upgrade', upgrade);
  function close() {
    clearInterval(tick);
    clearInterval(heartbeat);
    httpServer.off('upgrade', upgrade);
    httpServer.off('close', close);
    for (const socket of relay.clients) socket.terminate();
    relay.close();
  }
  httpServer.once('close', close);
  return close;
}

export function roadsterLan() {
  return {
    name: 'roadster-lan',
    configureServer(server) {
      if (server.httpServer) attachLanServer(server.httpServer);
    },
    configurePreviewServer(server) {
      attachLanServer(server.httpServer);
    },
  };
}
