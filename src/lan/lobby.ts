import { carPaintPalette } from '../game/carPaint';
import { formatNumber, getLanguage, t, type MessageKey } from '../i18n';
import { PeerGuest, PeerHost, readSignal } from './peer';
import { driverName, MAX_PLAYERS } from './room-engine.mjs';
import type { ClientMessage, DriveState, LanError, LanRoom, RoomPlayer, ServerMessage } from './protocol';

const codePattern = /^[2-9A-HJ-NP-Z]{6}$/;
const errors: Record<LanError, MessageKey> = {
  name: 'lanNameRequired', missing: 'lanMissing', closed: 'lanClosed', full: 'lanFull',
};

export type LanInvitation = { type: 'relay'; code: string } | { type: 'peer'; token: string };

export function invitedRoom(): LanInvitation | undefined {
  const url = window.location;
  if (!url) return;
  if (url.hash.startsWith('#lan=')) return { type: 'peer', token: url.hash.slice(5) };
  const code = (new URLSearchParams(url.search).get('room') ?? '').toUpperCase();
  if (codePattern.test(code)) return { type: 'relay', code };
}

export class LanLobby {
  private readonly opener: HTMLButtonElement;
  private readonly dialog: HTMLDivElement;
  private readonly roomPanel: HTMLElement;
  private readonly entry: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly code: HTMLInputElement;
  private readonly invite: HTMLInputElement;
  private readonly hud: HTMLElement;
  private readonly notice: HTMLElement;
  private socket: WebSocket | null = null;
  private peer: PeerHost | PeerGuest | null = null;
  private incoming: LanInvitation | undefined;
  private transfer = '';
  private pairing: 'idle' | 'preparing' | 'connecting' = 'idle';
  private inviteTask = 0;
  private timeout: number | undefined;
  private pending = false;
  private receivedAt = 0;
  private lastDriveAt = -Infinity;
  private sentCrash = false;
  private message: MessageKey | null = null;
  private address: string | null = null;
  id = 0;
  room: LanRoom | null = null;

  constructor(private readonly element: <T extends HTMLElement>(id: string) => T,
    private readonly onRoomChange: (room: LanRoom | null) => void) {
    this.opener = element('lan-button');
    this.dialog = element('lan-dialog');
    this.roomPanel = element('lan-room');
    this.entry = element('lan-entry');
    this.name = element('lan-name');
    this.code = element('lan-code');
    this.invite = element('lan-invite');
    this.hud = element('lan-hud');
    this.notice = element('lan-race-notice');
    this.dialog.hidden = this.hud.hidden = true;
    element('lan-close').addEventListener('click', () => this.leave());
    element('lan-leave').addEventListener('click', () => this.leave());
    element('lan-lobby-leave').addEventListener('click', () => this.leave());
    element('lan-create').addEventListener('click', () => this.enter('create'));
    this.entry.addEventListener('submit', event => {
      event.preventDefault();
      this.enter(this.directMode && this.incoming?.type !== 'peer' ? 'create' : 'join');
    });
    element('lan-copy').addEventListener('click', () => {
      void this.copyField(this.invite, 'lanCopied', 'lanCopyManual');
    });
    element('lan-copy-reply').addEventListener('click', () => {
      void this.copyField(element('lan-reply-out'), 'lanDirectReplyCopied', 'lanDirectSendReply');
    });
    element('lan-new-link').addEventListener('click', () => { void this.prepareInvitation(); });
    element('lan-host-reply').addEventListener('submit', event => {
      event.preventDefault();
      void this.connectPlayer();
    });
    element('lan-start').addEventListener('click', () => this.send({ type: 'start' }));
    element('lan-rematch').addEventListener('click', () => this.send({ type: 'rematch' }));
  }

  get isOpen(): boolean { return !this.dialog.hidden; }

  private get directMode(): boolean {
    return this.incoming?.type === 'peer' || (this.incoming?.type !== 'relay' && window.location?.protocol === 'https:');
  }

  open(defaultName: string, invite = invitedRoom()): void {
    if (invite?.type === 'peer' && (this.incoming?.type !== 'peer' || invite.token !== this.incoming.token)) {
      this.disconnect();
      this.message = null;
    }
    this.incoming = invite;
    if (!this.name.value) this.name.value = defaultName;
    if (invite?.type === 'relay') this.code.value = invite.code;
    this.dialog.hidden = false;
    this.opener.setAttribute('aria-expanded', 'true');
    this.render();
    (invite?.type === 'relay' && this.name.value ? this.code : this.name).focus();
  }

  leave(restoreFocus = true): void {
    this.disconnect();
    this.message = null;
    this.setRoom(null);
    this.dialog.hidden = true;
    this.opener.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.opener.focus();
  }

  handleKey(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this.leave();
    } else if (event.code === 'Tab') {
      const controls = [...this.dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input')]
        .filter(control => !control.hidden && !control.closest('[hidden]'));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  drive(state: DriveState, now: number): void {
    if (this.room?.phase !== 'racing' || this.sentCrash || (!state.crashed && now - this.lastDriveAt < 50)) return;
    if (this.send({ type: 'drive', round: this.room.round, ...state })) {
      this.lastDriveAt = now;
      this.sentCrash = state.crashed;
    }
  }

  updateClock(now: number, crashed: boolean): void {
    const room = this.room;
    if (!room || this.hud.hidden) return;
    const countdown = room.phase === 'countdown';
    const serverNow = room.serverTime + now - this.receivedAt;
    const seconds = Math.max(0, Math.ceil(((countdown ? room.startsAt : room.endsAt) - serverNow) / 1000));
    const timer = countdown ? t('lanCountdown', { seconds: formatNumber(Math.max(1, seconds)) })
      : t('lanRaceClock', { minutes: formatNumber(Math.floor(seconds / 60)), seconds: formatNumber(seconds % 60, 2) });
    this.element('lan-clock').hidden = countdown;
    if (!countdown) this.text('lan-clock', timer);
    this.notice.hidden = !countdown && !crashed;
    if (!this.notice.hidden) this.text('lan-race-notice', countdown ? timer : t('lanEliminated'));
  }

  updateLanguage(): void {
    const title = t('multiplayer');
    this.opener.title = title;
    this.opener.setAttribute('aria-label', title);
    this.dialog.dir = this.hud.dir = getLanguage() === 'fa' ? 'rtl' : 'ltr';
    this.hud.setAttribute('aria-label', title);
    this.element('lan-close').setAttribute('aria-label', t('closeSettings'));
    this.name.placeholder = t('lanGuest');
    if (this.isOpen || this.room) this.render();
  }

  private enter(type: 'create' | 'join'): void {
    if (this.pending || this.room) return;
    const name = driverName(this.name.value) || t('lanGuest');
    if (this.directMode) {
      void this.enterDirect(name);
      return;
    }
    const code = this.code.value.trim().toUpperCase();
    if (type === 'join' && !codePattern.test(code)) {
      this.message = 'lanInvalidCode';
      this.render();
      this.code.focus();
      return;
    }
    const message: ClientMessage = type === 'create' ? { type, name } : { type, name, code };
    this.pending = true;
    this.message = 'lanConnecting';
    this.render();
    const url = new URL('/roadster-lan', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket;
    try { socket = new WebSocket(url); }
    catch { this.connectionLost(false); return; }
    this.socket = socket;
    this.timeout = window.setTimeout(() => {
      if (this.socket === socket && this.pending) this.connectionLost(false);
    }, 5000);
    socket.addEventListener('open', () => { if (this.socket === socket) this.send(message); });
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      let data: ServerMessage;
      try { data = JSON.parse(event.data) as ServerMessage; } catch { return; }
      this.receive(data);
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.connectionLost(Boolean(this.room));
    });
  }

  private receive(data: ServerMessage): void {
    if (data.type === 'hello') {
      this.id = data.id;
      this.address = data.address;
      return;
    }
    window.clearTimeout(this.timeout);
    this.timeout = undefined;
    this.pending = false;
    if (data.type === 'error') {
      this.disconnect();
      this.message = errors[data.code];
      this.render();
      return;
    }
    this.message = null;
    const previous = this.room;
    if (this.peer instanceof PeerGuest) this.transfer = '';
    this.setRoom(data);
    if (!(this.peer instanceof PeerHost)) return;
    if (data.phase !== 'lobby' || data.players.length >= MAX_PLAYERS) {
      this.transfer = '';
      this.pairing = 'idle';
    } else if (previous?.phase !== 'lobby' || data.players.length > previous.players.length ||
        previous.players.length >= MAX_PLAYERS) {
      void this.prepareInvitation();
    }
  }

  private async enterDirect(name: string): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') {
      this.message = 'lanDirectUnsupported';
      this.render();
      return;
    }
    if (this.incoming?.type !== 'peer') {
      const host = new PeerHost(data => this.receive(data), () => {
        if (this.peer !== host) return;
        this.transfer = '';
        this.pairing = 'idle';
        this.message = 'lanDirectFailed';
        this.render();
      });
      this.id = host.id;
      this.peer = host;
      host.start(name);
      return;
    }
    const offer = readSignal(this.incoming.token, 'offer');
    if (!offer) {
      this.message = 'lanDirectInvalidInvite';
      this.render();
      return;
    }
    this.pending = true;
    this.message = 'lanDirectPreparing';
    this.render();
    try {
      const guest = new PeerGuest(offer, name, data => {
        if (this.peer === guest) this.receive(data);
      }, () => {
        if (this.peer === guest) this.directLost();
      });
      this.peer = guest;
      const reply = await guest.prepareReply();
      if (this.peer !== guest || this.room) return;
      this.transfer = reply;
      this.message = null;
      this.render();
      this.element('lan-copy-reply').focus();
    } catch {
      if (this.pending) this.directLost();
    }
  }

  private async prepareInvitation(): Promise<void> {
    const host = this.peer;
    if (!(host instanceof PeerHost) || this.room?.phase !== 'lobby' || this.room.players.length >= MAX_PLAYERS) return;
    const task = ++this.inviteTask;
    this.transfer = '';
    this.element<HTMLInputElement>('lan-reply-in').value = '';
    this.pairing = 'preparing';
    this.message = 'lanDirectPreparing';
    this.render();
    try {
      const token = await host.createInvitation();
      if (this.peer !== host || task !== this.inviteTask || this.room?.phase !== 'lobby') return;
      this.transfer = token;
      this.message = null;
    } catch {
      if (this.peer !== host || task !== this.inviteTask || this.room?.phase !== 'lobby') return;
      this.message = 'lanDirectFailed';
    }
    this.pairing = 'idle';
    this.render();
  }

  private async connectPlayer(): Promise<void> {
    const host = this.peer;
    if (!(host instanceof PeerHost) || !this.transfer || this.pairing !== 'idle') return;
    const field = this.element<HTMLInputElement>('lan-reply-in');
    const answer = readSignal(field.value, 'answer');
    if (answer) {
      this.pairing = 'connecting';
      this.message = 'lanDirectConnecting';
      this.render();
      const task = this.inviteTask;
      if (await host.acceptReply(answer) || this.peer !== host || task !== this.inviteTask) return;
      this.pairing = 'idle';
    }
    this.message = 'lanDirectInvalidReply';
    this.render();
    field.focus();
  }

  private directLost(): void {
    const wasInRoom = Boolean(this.room);
    this.disconnect();
    this.message = wasInRoom ? 'lanDirectLost' : 'lanDirectFailed';
    this.dialog.hidden = false;
    this.setRoom(null);
    this.element('lan-close').focus();
  }

  private send(message: ClientMessage): boolean {
    if (this.peer) return this.peer.send(message);
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 64 * 1024) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  private disconnect(): void {
    if (this.timeout !== undefined) window.clearTimeout(this.timeout);
    this.timeout = undefined;
    this.pending = false;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    const peer = this.peer;
    this.peer = null;
    peer?.close();
    this.transfer = '';
    this.pairing = 'idle';
    this.id = 0;
    this.address = null;
  }

  private connectionLost(inRoom: boolean): void {
    this.disconnect();
    this.message = inRoom ? 'lanLost' : 'lanUnavailable';
    this.dialog.hidden = false;
    this.setRoom(null);
    this.element('lan-close').focus();
  }

  private setRoom(room: LanRoom | null): void {
    const previous = this.room;
    this.room = room;
    this.receivedAt = performance.now();
    if (room?.round !== previous?.round || room?.phase === 'lobby') {
      this.lastDriveAt = -Infinity;
      this.sentCrash = false;
    }
    const onTrack = room?.phase === 'countdown' || room?.phase === 'racing';
    if (room) this.dialog.hidden = onTrack;
    this.hud.hidden = !onTrack;
    if (!onTrack) this.notice.hidden = true;
    this.onRoomChange(room);
    this.render();
    if (room && !onTrack && previous?.phase !== room.phase) this.element('lan-close').focus();
    const focused = document.activeElement;
    if (onTrack && focused instanceof HTMLElement && this.dialog.contains(focused)) focused.blur();
  }

  private inviteUrl(code: string, peerToken = ''): string {
    const url = new URL(window.location.href);
    if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname) && this.address) {
      url.hostname = this.address;
    }
    url.search = '';
    url.hash = '';
    if (peerToken) url.hash = `lan=${peerToken}`;
    else url.searchParams.set('room', code);
    return url.href;
  }

  private async copyField(field: HTMLInputElement, success: MessageKey, manual: MessageKey): Promise<void> {
    const value = field.value;
    if (!value) return;
    let copied = false;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch { /* HTTP LAN addresses may require copying a selection. */ }
    if (!this.isOpen || field.value !== value) return;
    if (!copied) {
      field.focus();
      field.select();
      try { copied = document.execCommand('copy'); } catch { /* The value stays selected for manual copying. */ }
    }
    this.message = copied ? success : manual;
    this.render();
  }

  private render(): void {
    const room = this.room;
    const results = room?.phase === 'results';
    const host = room?.host === this.id;
    const direct = this.directMode;
    const guest = this.incoming?.type === 'peer';
    const hasReply = this.peer instanceof PeerGuest && Boolean(this.transfer);
    const share = room?.phase === 'lobby' && (!direct || (host && room.players.length < MAX_PLAYERS));
    const sharingDirect = direct && share;
    this.entry.hidden = Boolean(room) || hasReply;
    this.roomPanel.hidden = !room;
    this.element('lan-guest-reply').hidden = !hasReply;
    const reply = this.element<HTMLInputElement>('lan-reply-out');
    const replyValue = hasReply ? this.transfer : '';
    if (reply.value !== replyValue) reply.value = replyValue;
    this.element('lan-share').hidden = !share;
    this.element('lan-share-code').hidden = direct;
    this.element('lan-share-help').hidden = !sharingDirect;
    this.element('lan-host-reply').hidden = !sharingDirect;
    this.element('lan-new-link').hidden = !sharingDirect;
    this.element<HTMLButtonElement>('lan-new-link').disabled = this.pairing === 'preparing';
    this.element<HTMLButtonElement>('lan-copy').disabled = sharingDirect && !this.transfer;
    this.element<HTMLButtonElement>('lan-connect').disabled = !this.transfer || this.pairing !== 'idle';
    this.element('lan-target').hidden = results;
    this.element('lan-intro').hidden = Boolean(room) || hasReply;
    this.text('lan-intro', t(direct ? guest ? 'lanDirectGuestIntro' : 'lanDirectIntro' : 'lanIntro'));
    this.element('lan-relay-entry').hidden = direct;
    this.element('lan-direct-join-actions').hidden = !guest;
    this.element('lan-create').hidden = guest;
    for (const id of ['lan-create', 'lan-join', 'lan-direct-join']) this.element<HTMLButtonElement>(id).disabled = this.pending;
    this.text('lan-status', this.message ? t(this.message) : '');
    if (!room) {
      this.text('lan-title', t('lanTitle'));
      return;
    }
    const ranked = [...room.players].sort((a, b) => Number(b.id === room.winner) - Number(a.id === room.winner) ||
      Number(b.connected) - Number(a.connected) || (b.drive?.distance ?? 0) - (a.drive?.distance ?? 0));
    if (!this.hud.hidden) {
      this.text('lan-finish-distance', t('lanFinishDistance', { distance: formatNumber(room.target) }));
      this.renderPlayers('lan-standing', ranked, true);
      this.updateClock(performance.now(), Boolean(room.players.find(player => player.id === this.id)?.drive?.crashed));
      return;
    }
    this.text('lan-title', t(results ? 'lanResults' : 'lanLobby'));
    this.text('lan-room-code', room.code);
    const invite = direct && !this.transfer ? '' : this.inviteUrl(room.code, direct ? this.transfer : '');
    if (this.invite.value !== invite) this.invite.value = invite;
    this.element('lan-start').hidden = results || !host;
    this.element<HTMLButtonElement>('lan-start').disabled = room.players.length < 2;
    this.element('lan-rematch').hidden = !results || !host;
    const winner = room.players.find(player => player.id === room.winner);
    this.text('lan-room-message', results ? (winner ? t('lanWinner', { name: winner.name }) : t('lanDraw'))
      : room.players.length < 2 ? t('lanNeedPlayers') : t(host ? 'lanRoomReady' : 'lanWaitHost'));
    this.text('lan-target', t('lanDistanceGoal', { distance: formatNumber(room.target) }));
    this.renderPlayers('lan-roster', results ? ranked : room.players, results, room.host);
  }

  private renderPlayers(id: string, players: RoomPlayer[], showDistance: boolean, host?: number): void {
    const list = this.element(id);
    for (let i = 0; i < 4; i++) {
      const row = this.element(`${id}-${i}`);
      const player = players[i];
      row.hidden = !player;
      if (!player) continue;
      const suffix = player.id === this.id ? t('lanYou') : '';
      const role = player.id === host ? t('lanHost') : '';
      const state = !player.connected ? t('lanDisconnected') : player.drive?.crashed ? t('lanCrashed') : '';
      const detail = [suffix, role, state].filter(Boolean).join(' · ');
      this.text(`${id}-name-${i}`, player.name + (detail ? ` · ${detail}` : ''));
      this.text(`${id}-distance-${i}`, showDistance ? `${formatNumber(Math.floor(player.drive?.distance ?? 0))} ${t('meter')}` : '');
      row.style.setProperty('--lan-paint', carPaintPalette(player.paint).base);
    }
    list.hidden = players.length === 0;
  }

  private text(id: string, value: string): void {
    const node = this.element(id);
    if (node.textContent !== value) node.textContent = value;
  }
}
