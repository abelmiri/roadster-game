import { randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';

const PATH = '/roadster-lan';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const TARGET = 1000;
const COUNTDOWN_MS = 3000;
const RACE_MS = 180_000;
const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PAINTS = ['blue', 'orange', 'pink', 'lime'];

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

function readPose(pose) {
  if (!pose || ![pose.x, pose.y, pose.angle].every(Number.isFinite)) return null;
  if (Math.abs(pose.x) > TARGET + 50 || Math.abs(pose.y) > 300 || Math.abs(pose.angle) > 10_000) return null;
  return { x: pose.x, y: pose.y, angle: pose.angle };
}

function readDrive(message) {
  if (!Number.isFinite(message.distance) || message.distance < 0 || !Array.isArray(message.wheels) ||
      message.wheels.length !== 2 || typeof message.crashed !== 'boolean') return null;
  const car = readPose(message.car);
  const wheels = message.wheels.map(readPose);
  if (!car || wheels.some(wheel => !wheel)) return null;
  return { distance: Math.min(TARGET, message.distance), car, wheels, crashed: message.crashed };
}

export function attachLanServer(httpServer) {
  const relay = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const rooms = new Map();
  const responsive = new WeakSet();
  let nextPlayerId = 1;

  function send(socket, message) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount >= 64 * 1024) socket.terminate();
    else socket.send(JSON.stringify(message));
  }

  function updateRoom(room) {
    const message = {
      type: 'room', code: room.code, host: room.host, phase: room.phase, round: room.round,
      serverTime: Date.now(), startsAt: room.startsAt, endsAt: room.endsAt, target: TARGET, winner: room.winner,
      players: [...room.players.values()].map(({ id, name, paint, drive, connected }) => ({
        id, name, paint, drive, connected,
      })),
    };
    for (const player of room.players.values()) if (player.connected) send(player.socket, message);
    room.dirty = false;
  }

  function attach(player, room) {
    const used = new Set([...room.players.values()].map(member => member.paint));
    player.paint = PAINTS.find(paint => !used.has(paint));
    player.drive = null;
    player.room = room;
    room.players.set(player.id, player);
    updateRoom(room);
  }

  function finish(room, winner) {
    const standing = [...room.players.values()].filter(player => player.connected)
      .sort((a, b) => (b.drive?.distance ?? 0) - (a.drive?.distance ?? 0));
    const [first, second] = standing;
    const tied = second && (first.drive?.distance ?? 0) === (second.drive?.distance ?? 0);
    room.winner = winner ?? (tied ? null : first?.id ?? null);
    room.phase = 'results';
    updateRoom(room);
  }

  function leave(player) {
    const room = player.room;
    if (!room) return;
    player.room = null;
    player.connected = false;
    if (room.phase === 'lobby' || room.phase === 'countdown') room.players.delete(player.id);
    const remaining = [...room.players.values()].filter(member => member.connected);
    if (!remaining.length) {
      rooms.delete(room.code);
      return;
    }
    if (room.host === player.id) room.host = remaining[0].id;
    if (room.phase === 'countdown') room.phase = 'lobby';
    if (room.phase === 'racing' && (remaining.length < MIN_PLAYERS ||
        remaining.every(member => member.drive?.crashed))) {
      finish(room, remaining.length === 1 ? remaining[0].id : undefined);
    } else {
      updateRoom(room);
    }
  }

  function handle(player, message, now) {
    if (!message || typeof message !== 'object') return;
    const room = player.room;
    const error = code => send(player.socket, { type: 'error', code });
    if (message.type === 'create' || message.type === 'join') {
      if (room) return;
      if (typeof message.name !== 'string') return error('name');
      const name = Array.from(message.name.trim().replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 24).join('');
      if (!name) return error('name');
      player.name = name;

      if (message.type === 'create') {
        let code;
        do {
          code = Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
        } while (rooms.has(code));
        const newRoom = { code, host: player.id, phase: 'lobby', round: 0, startsAt: 0, endsAt: 0,
          winner: null, players: new Map(), dirty: false };
        rooms.set(code, newRoom);
        attach(player, newRoom);
      } else {
        const target = rooms.get(message.code);
        if (!target) return error('missing');
        if (target.phase !== 'lobby') return error('closed');
        if (target.players.size >= MAX_PLAYERS) return error('full');
        attach(player, target);
      }
      return;
    }
    if (!room) return;
    if (message.type === 'start' && player.id === room.host && room.phase === 'lobby' &&
        room.players.size >= MIN_PLAYERS) {
      room.round++;
      room.phase = 'countdown';
      room.startsAt = now + COUNTDOWN_MS;
      room.endsAt = room.startsAt + RACE_MS;
      for (const member of room.players.values()) member.lastDriveAt = 0;
      updateRoom(room);
    } else if (message.type === 'rematch' && player.id === room.host && room.phase === 'results') {
      room.phase = 'lobby';
      room.winner = null;
      for (const [id, member] of room.players) {
        if (member.connected) member.drive = null;
        else room.players.delete(id);
      }
      updateRoom(room);
    } else if (message.type === 'drive' && message.round === room.round && room.phase === 'racing' &&
        !player.drive?.crashed && (message.crashed === true || now - player.lastDriveAt >= 25)) {
      const drive = readDrive(message);
      if (!drive) return;
      player.lastDriveAt = now;
      drive.distance = Math.max(drive.distance, player.drive?.distance ?? 0);
      player.drive = drive;
      room.dirty = true;
      if (drive.distance >= TARGET) finish(room, player.id);
      else if ([...room.players.values()].every(member => !member.connected || member.drive?.crashed)) finish(room);
    }
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
    const player = { id: nextPlayerId++, socket, connected: true, room: null };
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
    socket.once('close', () => leave(player));
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
    for (const room of rooms.values()) {
      if (room.phase === 'countdown' && now >= room.startsAt) {
        room.phase = 'racing';
        updateRoom(room);
      } else if (room.phase === 'racing' && now >= room.endsAt) {
        finish(room);
      } else if (room.dirty) updateRoom(room);
    }
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
