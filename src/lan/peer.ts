import { addWifiCandidates, isPrivateWifiAddress } from './wifi';
import type { ClientMessage, LanError, LanRoom, ServerMessage } from './protocol';
import { driverName, MAX_PLAYERS, RaceRoom, ROOM_ALPHABET } from './room-engine.mjs';

const CHANNEL = 'roadster-lan';
const HOST_ID = 1;
const TOKEN_PREFIX = 'rd1.';
const TOKEN_LIMIT = 12_000;
const codePattern = /^[2-9A-HJ-NP-Z]{6}$/;

interface Signal {
  id: string;
  code: string;
  sdp: string;
  type: 'offer' | 'answer';
  wifiAddress?: string;
}

export function readSignal(token: string, type: Signal['type']): Signal | null {
  const value = token.trim();
  if (!value.startsWith(TOKEN_PREFIX) || value.length > TOKEN_LIMIT) return null;
  try {
    const signal: Signal = JSON.parse(atob(value.slice(TOKEN_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')));
    if (signal.type !== type || typeof signal.code !== 'string' || !codePattern.test(signal.code) ||
        typeof signal.id !== 'string' || !/^[\da-f-]{36}$/i.test(signal.id) ||
        (signal.wifiAddress !== undefined && !isPrivateWifiAddress(signal.wifiAddress)) ||
        typeof signal.sdp !== 'string' || !/^m=application .*webrtc-datachannel\r?$/m.test(signal.sdp) ||
        /^m=(?!application )/m.test(signal.sdp) || !/^a=candidate:.* typ host\b/m.test(signal.sdp)) return null;
    return signal;
  } catch {
    return null;
  }
}

function signalToken(signal: Signal): string {
  return TOKEN_PREFIX + btoa(JSON.stringify(signal)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function remoteDescription(signal: Signal): RTCSessionDescriptionInit {
  const { type, sdp, wifiAddress } = signal;
  return { type, sdp: wifiAddress ? addWifiCandidates(sdp, wifiAddress) : sdp };
}

function parseMessage(data: unknown, limit: number): unknown {
  if (typeof data !== 'string' || data.length > limit) return null;
  try { return JSON.parse(data); } catch { return null; }
}

// Gather only local candidates. The invite and reply carry the entire exchange.
class PeerLink {
  readonly pc = new RTCPeerConnection({ iceServers: [] });
  private readonly abort = new AbortController();
  private channel: RTCDataChannel | null = null;
  private timer: number | undefined;

  constructor(offerer: boolean, onMessage: (data: unknown) => void, onOpen: () => void, onLost: () => void) {
    const lost = () => {
      if (this.abort.signal.aborted) return;
      this.close();
      onLost();
    };
    const attach = (channel: RTCDataChannel) => {
      if (channel.label !== CHANNEL || this.channel || this.abort.signal.aborted) { channel.close(); return; }
      this.channel = channel;
      channel.addEventListener('message', event => onMessage(event.data));
      channel.addEventListener('close', lost);
      channel.addEventListener('error', lost);
      let opened = false;
      const ready = () => {
        if (opened || this.abort.signal.aborted) return;
        opened = true;
        window.clearTimeout(this.timer);
        onOpen();
      };
      channel.addEventListener('open', ready);
      if (channel.readyState === 'open') queueMicrotask(ready);
    };
    if (offerer) attach(this.pc.createDataChannel(CHANNEL));
    else this.pc.addEventListener('datachannel', event => attach(event.channel));
    this.pc.addEventListener('connectionstatechange', () => {
      window.clearTimeout(this.timer);
      const state = this.pc.connectionState;
      if (state === 'failed' || state === 'closed') lost();
      if (state === 'disconnected') this.timer = window.setTimeout(lost, 5000);
    });
  }

  async makeSignal(id: string, code: string, type: Signal['type'], wifiAddress?: string): Promise<Signal> {
    const local = await (type === 'offer' ? this.pc.createOffer() : this.pc.createAnswer());
    await this.pc.setLocalDescription(local);
    if (this.pc.iceGatheringState !== 'complete') await this.waitForGathering();
    const sdp = this.pc.localDescription?.sdp ?? '';
    if (!/^a=candidate:.* typ host\b/m.test(sdp)) throw new Error('No local network candidates');
    return { id, code, type, sdp, wifiAddress: wifiAddress || undefined };
  }

  private waitForGathering(): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this.abort.signal;
      const cleanup = () => {
        window.clearTimeout(timer);
        this.pc.removeEventListener('icegatheringstatechange', gathered);
        signal.removeEventListener('abort', cancelled);
      };
      const cancelled = () => { cleanup(); reject(new Error('Connection closed')); };
      const gathered = () => {
        if (this.pc.iceGatheringState !== 'complete') return;
        cleanup();
        resolve();
      };
      // Some browsers keep gathering after their first usable host candidate.
      const timer = window.setTimeout(() => { cleanup(); resolve(); }, 5000);
      if (signal.aborted) { cancelled(); return; }
      signal.addEventListener('abort', cancelled, { once: true });
      this.pc.addEventListener('icegatheringstatechange', gathered);
      gathered();
    });
  }

  send(message: ClientMessage | ServerMessage): boolean {
    const channel = this.channel;
    if (channel?.readyState !== 'open' || channel.bufferedAmount > 64 * 1024) return false;
    try {
      channel.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    window.clearTimeout(this.timer);
    this.channel?.close();
    this.pc.close();
  }
}

interface PendingInvite {
  id: string;
  link: PeerLink;
  accepted: boolean;
  timer?: number;
}

function clock(): number { return Math.floor(performance.timeOrigin + performance.now()); }

export class PeerHost {
  readonly id = HOST_ID;
  private readonly room: RaceRoom;
  private readonly guests = new Map<number, PeerLink>();
  private nextId = HOST_ID + 1;
  private readonly tick: number;
  private pending: PendingInvite | null = null;

  constructor(private readonly receive: (message: ServerMessage) => void,
    private readonly invitationFailed: () => void) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)),
      value => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join('');
    this.room = new RaceRoom(code, HOST_ID, state => this.publish(state));
    this.tick = window.setInterval(() => this.room.tick(clock()), 40);
  }

  start(name: string): void { this.room.join(HOST_ID, name, clock()); }

  async createInvitation(wifiAddress?: string): Promise<string> {
    this.cancelInvitation();
    const id = crypto.randomUUID();
    const guestId = this.nextId++;
    const link = new PeerLink(true, data => {
      const message = parseMessage(data, 2048) as ClientMessage | null;
      if (!message) return;
      if (this.guests.get(guestId) === link) this.room.receive(guestId, message, clock());
      else if (this.pending?.link === link && this.pending.accepted && message.type === 'join') {
        const name = driverName(message.name);
        if (!name || message.code !== this.room.code) { this.failInvitation(); return; }
        window.clearTimeout(this.pending.timer);
        this.pending = null;
        this.guests.set(guestId, link);
        const failure = this.room.join(guestId, name, clock());
        if (failure) {
          link.send({ type: 'error', code: failure });
          this.guests.delete(guestId);
          link.close();
          this.invitationFailed();
        }
      }
    }, () => {
      link.send({ type: 'hello', id: guestId, address: null });
    }, () => {
      if (this.pending?.link === link) this.failInvitation();
      else this.removeGuest(guestId);
    });
    const pending = { id, link, accepted: false };
    this.pending = pending;
    try {
      const offer = await link.makeSignal(id, this.room.code, 'offer', wifiAddress);
      if (this.pending !== pending) throw new Error('Invitation closed');
      return signalToken(offer);
    } catch (error) {
      if (this.pending === pending) this.cancelInvitation();
      throw error;
    }
  }

  async acceptReply(answer: Signal): Promise<boolean> {
    const pending = this.pending;
    if (!pending || pending.accepted || pending.id !== answer.id || this.room.code !== answer.code) return false;
    pending.accepted = true;
    try {
      await pending.link.pc.setRemoteDescription(remoteDescription(answer));
    } catch {
      if (this.pending === pending) pending.accepted = false;
      return false;
    }
    if (this.pending === pending) pending.timer = window.setTimeout(() => this.failInvitation(), 15_000);
    return true;
  }

  send(message: ClientMessage): boolean {
    this.room.receive(HOST_ID, message, clock());
    return true;
  }

  close(): void {
    window.clearInterval(this.tick);
    this.cancelInvitation();
    for (const link of this.guests.values()) link.close();
    this.guests.clear();
  }

  private publish(state: LanRoom): void {
    if (state.phase !== 'lobby' || state.players.length >= MAX_PLAYERS) this.cancelInvitation();
    const lost = [];
    for (const [id, link] of this.guests) {
      if (!link.send(state)) lost.push(id);
    }
    this.receive(state);
    for (const id of lost) this.removeGuest(id);
  }

  private removeGuest(id: number): void {
    const link = this.guests.get(id);
    if (!link) return;
    this.guests.delete(id);
    link.close();
    this.room.leave(id, clock());
  }

  private cancelInvitation(): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.link.close();
  }

  private failInvitation(): void {
    this.cancelInvitation();
    this.invitationFailed();
  }
}

export class PeerGuest {
  private readonly link: PeerLink;

  constructor(private readonly offer: Signal, name: string, receive: (message: ServerMessage) => void,
    onLost: () => void) {
    this.link = new PeerLink(false, data => {
      const message = parseMessage(data, 8192) as ServerMessage | null;
      if (message?.type === 'error' && (['name', 'missing', 'closed', 'full'] as LanError[]).includes(message.code)) receive(message);
      if (message?.type === 'hello' && Number.isSafeInteger(message.id)) {
        receive(message);
        this.send({ type: 'join', code: offer.code, name });
      }
      if (message?.type === 'room' && message.code === offer.code && Array.isArray(message.players) &&
          message.players.length <= MAX_PLAYERS) receive(message);
    }, () => {}, onLost);
  }

  async prepareReply(wifiAddress?: string): Promise<string> {
    await this.link.pc.setRemoteDescription(remoteDescription(this.offer));
    return signalToken(await this.link.makeSignal(this.offer.id, this.offer.code, 'answer', wifiAddress));
  }

  send(message: ClientMessage): boolean { return this.link.send(message); }
  close(): void { this.link.close(); }
}
