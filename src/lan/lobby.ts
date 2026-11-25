import { API_URL } from '../backend';
import { carPaintPalette } from '../game/carPaint';
import { formatNumber, getLanguage, t, type MessageKey } from '../i18n';
import type { ClientMessage, DriveState, LanRoom, OnlinePlayer, RoomPlayer, ServerMessage } from './protocol';

const notices: Record<string, MessageKey> = {
  invitation_sent: 'onlineInviteSent', invitation_declined: 'onlineInviteDeclined',
  invitation_expired: 'onlineInviteExpired', player_unavailable: 'lanPeerUnavailable',
  room_closed: 'lanClosed', invalid_name: 'lanNameRequired', server_error: 'lanDiscoveryUnavailable',
};

export class LanLobby {
  private readonly dialog: HTMLDivElement;
  private readonly hud: HTMLElement;
  private readonly notice: HTMLElement;
  private socket: WebSocket | null = null;
  private retryTimer: number | undefined;
  private retryDelay = 1000;
  private online: OnlinePlayer[] = [];
  private incoming: { room: string; host: number; name: string } | null = null;
  private dismissed = new Set<number>();
  private name = '';
  private status = '';
  private receivedAt = 0;
  private lastDriveAt = -Infinity;
  private sentCrash = false;
  id = 0;
  room: LanRoom | null = null;

  constructor(private readonly element: <T extends HTMLElement>(id: string) => T,
    private readonly onRoomChange: (room: LanRoom | null) => void,
    private readonly onProposal: () => void) {
    this.dialog = element('lan-dialog');
    this.hud = element('lan-hud');
    this.notice = element('lan-race-notice');
    this.dialog.hidden = this.hud.hidden = true;
    for (const id of ['lan-close', 'lan-leave', 'lan-lobby-leave'])
      element(id).addEventListener('click', () => this.leave());
    element('lan-presence').addEventListener('click', () => this.onProposal());
    element('lan-distance').addEventListener('change', () => this.send({type:'configure', distanceGoal: Number(this.element<HTMLSelectElement>('lan-distance').value)}));
    element('lan-accept').addEventListener('click', () => this.respond(true));
    element('lan-decline').addEventListener('click', () => this.respond(false));
    element('lan-start').addEventListener('click', () => this.send({ type: 'start' }));
    element('lan-rematch').addEventListener('click', () => this.send({ type: 'rematch' }));
  }

  get isOpen(): boolean { return !this.dialog.hidden; }

  begin(name: string): void {
    this.name = name.trim().slice(0, 24) || t('lanGuest');
    this.connect();
  }

  private connect(): void {
    if (this.socket || !this.name) return;
    const url = new URL('/v1/game/socket', API_URL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket;
    try { socket = new WebSocket(url); }
    catch { this.scheduleRetry(); return; }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.retryDelay = 1000;
      this.status = '';
      this.send({ type: 'identify', name: this.name });
      this.render();
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      let data: ServerMessage;
      try { data = JSON.parse(event.data) as ServerMessage; } catch { return; }
      this.receive(data);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.id = 0;
      this.online = [];
      this.incoming = null;
      this.status = t('lanDiscoveryUnavailable');
      if (this.room) this.setRoom(null);
      this.render();
      this.scheduleRetry();
    });
    socket.addEventListener('error', () => { if (this.socket === socket) socket.close(); });
  }

  private scheduleRetry(): void {
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }

  private receive(data: ServerMessage): void {
    if (data.type === 'hello') { this.id = data.id; return; }
    if (data.type === 'presence') {
      const current = new Set(data.players.map(player => player.id));
      for (const id of this.dismissed) if (!current.has(id)) this.dismissed.delete(id);
      this.online = data.players.filter(player => player.id !== this.id);
      if (!this.room && !this.incoming && !this.isOpen && this.online.some(player => !this.dismissed.has(player.id))) this.onProposal();
      this.render();
      return;
    }
    if (data.type === 'invitation') {
      this.incoming = data;
      this.status = '';
      if (!this.isOpen) this.onProposal();
      this.render();
      return;
    }
    if (data.type === 'notice') {
      this.status = t(notices[data.code] ?? 'lanPeerUnavailable');
      this.render();
      return;
    }
    if (data.type === 'drive') {
      if (this.room?.round !== data.round || this.room.phase !== 'racing') return;
      const player = this.room.players.find(item => item.id === data.id);
      if (!player) return;
      player.drive = data.drive;
      if (this.isOpen || !this.hud.hidden) this.renderPlayers('lan-standing', this.hudPlayers(this.room.players), true);
      return;
    }
    if (data.type === 'room') {
      this.incoming = null;
      this.status = '';
      this.setRoom(data);
    }
  }

  private send(message: ClientMessage): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 64 * 1024) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  private invite(id: number): void {
    if (!this.send({ type: 'invite', target: id })) return;
    this.status = t('onlineInviteSent');
    this.render();
  }

  private respond(accept: boolean): void {
    const invite = this.incoming;
    if (!invite) return;
    if (!this.send({ type: accept ? 'accept' : 'decline', room: invite.room })) return;
    if (!accept) this.dismissed.add(invite.host);
    this.incoming = null;
    this.status = accept ? t('lanDirectConnecting') : '';
    this.render();
  }

  open(): void {
    if (this.room?.phase === 'racing') return;
    this.dialog.hidden = false;
    this.render();
    this.element('lan-close').focus();
  }

  leave(restoreFocus = true): void {
    if (this.incoming) this.respond(false);
    if (this.room) this.send({ type: 'leave' });
    else for (const player of this.online) this.dismissed.add(player.id);
    this.incoming = null;
    this.setRoom(null);
    this.dialog.hidden = true;
    this.status = '';
    if (restoreFocus) this.element('primary-button').focus();
  }

  handleKey(event: KeyboardEvent): void {
    if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) this.leave(); }
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
    this.element('lan-clock').hidden = countdown || room.target === 0;
    if (!countdown) this.text('lan-clock', timer);
    this.notice.hidden = !countdown && !crashed;
    if (!this.notice.hidden) this.text('lan-race-notice', countdown ? timer : t('lanEliminated'));
  }

  updateLanguage(): void {
    this.dialog.dir = this.hud.dir = getLanguage() === 'fa' ? 'rtl' : 'ltr';
    this.hud.setAttribute('aria-label', t('lanTitle'));
    this.element('lan-close').setAttribute('aria-label', t('closeSettings'));
    this.render();
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
  }

  private rank(players: RoomPlayer[]): RoomPlayer[] {
    return [...players].sort((a, b) => (b.drive?.distance ?? 0) - (a.drive?.distance ?? 0));
  }

  private hudPlayers(players: RoomPlayer[]): RoomPlayer[] {
    const ranked = this.rank(players);
    const visible = ranked.slice(0, 5);
    const own = ranked.find(player => player.id === this.id);
    if (own && !visible.includes(own)) visible.push(own);
    return visible;
  }

  private render(): void {
    const room = this.room;
    const results = room?.phase === 'results';
    const canInvite = !room || room.phase === 'lobby' && room.host === this.id;
    this.element('lan-discovery').hidden = Boolean(this.incoming);
    this.element('lan-incoming').hidden = !this.incoming;
    this.element('lan-room').hidden = !room;
    this.text('lan-title', t(results ? 'lanResults' : room ? 'lanLobby' : 'lanTitle'));
    this.text('lan-intro', this.incoming ? t('lanIncoming', { name: this.incoming.name }) :
      room ? t(canInvite ? 'onlineInviteMore' : 'lanWaitHost') : t('onlineNearbyIntro'));
    this.text('lan-status', this.status);
    this.text('lan-presence', this.socket?.readyState !== WebSocket.OPEN ? t('lanDiscoveryUnavailable') :
      this.online.length ? t('onlineFound') : t('onlineSearching'));
    this.renderOnline();
    if (!room) return;
    const ranked = this.rank(room.players);
    if (!this.hud.hidden) {
      this.text('lan-finish-distance', room.target === 0 ? t('onlineEndless') : t('lanFinishDistance', { distance: formatNumber(room.target) }));
      this.renderPlayers('lan-standing', this.hudPlayers(room.players), true);
      this.updateClock(performance.now(), Boolean(room.players.find(player => player.id === this.id)?.drive?.crashed));
      return;
    }
    this.element('lan-target').hidden = results;
    this.element('lan-distance-control').hidden = results;
    this.element<HTMLSelectElement>('lan-distance').disabled = room.host !== this.id;
    this.element<HTMLSelectElement>('lan-distance').value = String(room.target);
    this.text('lan-target', room.target === 0 ? t('onlineEndlessGoal') : t('lanDistanceGoal', { distance: formatNumber(room.target) }));
    this.element('lan-start').hidden = results || room.host !== this.id;
    this.element<HTMLButtonElement>('lan-start').disabled = room.players.length < 2;
    this.element('lan-rematch').hidden = !results || room.host !== this.id;
    const winner = room.players.find(player => player.id === room.winner);
    this.text('lan-room-message', results ? (winner ? t('lanWinner', { name: winner.name }) : t('lanDraw'))
      : room.players.length < 2 ? t('lanNeedPlayers') : t(room.host === this.id ? 'lanRoomReady' : 'lanWaitHost'));
    this.renderPlayers('lan-roster', results ? ranked : room.players, results, room.host);
  }

  private renderOnline(): void {
    const list = this.element('lan-peers');
    const visible = this.online;
    list.replaceChildren();
    for (const player of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.peerId = String(player.id);
      const sameRoom = Boolean(this.room && this.room.code === player.room);
      const canJoin = !this.room && player.phase === 'lobby';
      button.textContent = t(canJoin ? 'onlineJoinPlayer' : player.phase === 'idle' ? 'lanPlayWith' : 'onlinePlayerStatus', { name: player.name, status: t(player.phase === 'lobby' ? 'lanLobby' : 'onlineRacing') });
      button.disabled = sameRoom || (Boolean(this.room) && (this.room!.host !== this.id || this.room!.phase !== 'lobby')) || (!canJoin && player.phase !== 'idle');
      button.addEventListener('click', () => canJoin ? this.send({type:'join',room:player.room}) : this.invite(player.id));
      list.append(button);
    }
  }

  private renderPlayers(id: string, players: RoomPlayer[], showDistance: boolean, host?: number): void {
    const list = this.element<HTMLOListElement>(id);
    const existing = new Map([...list.children].map(row => [Number((row as HTMLElement).dataset.playerId), row as HTMLElement]));
    for (const player of players) {
      let row = existing.get(player.id);
      if (!row) {
        row = document.createElement('li');
        row.dataset.playerId = String(player.id);
        row.append(document.createElement('bdi'), document.createElement('span'));
      }
      const detail = [player.id === this.id ? t('lanYou') : '', player.id === host ? t('lanHost') : '',
        !player.connected ? t('lanDisconnected') : player.drive?.crashed ? t('lanCrashed') : ''].filter(Boolean).join(' · ');
      row.children[0].textContent = player.name + (detail ? ` · ${detail}` : '');
      row.children[1].textContent = showDistance ? `${formatNumber(Math.floor(player.drive?.distance ?? 0))} ${t('meter')}` : '';
      row.style.setProperty('--lan-paint', carPaintPalette(player.paint).base);
      list.append(row);
      existing.delete(player.id);
    }
    for (const row of existing.values()) row.remove();
    list.hidden = players.length === 0;
  }

  private text(id: string, value: string): void {
    const node = this.element(id);
    if (node.textContent !== value) node.textContent = value;
  }
}
