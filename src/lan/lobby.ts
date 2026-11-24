import { carPaintPalette } from '../game/carPaint';
import { formatNumber, getLanguage, t, type MessageKey } from '../i18n';
import type { ClientMessage, DriveState, LanError, LanRoom, RoomPlayer, ServerMessage } from './protocol';

const codePattern = /^[2-9A-HJ-NP-Z]{6}$/;
const errors: Record<LanError, MessageKey> = {
  name: 'lanNameRequired', missing: 'lanMissing', closed: 'lanClosed', full: 'lanFull',
};

export function invitedRoom(): string {
  const url = window.location;
  const code = url ? (new URLSearchParams(url.search).get('room') ?? '').toUpperCase() : '';
  return codePattern.test(code) ? code : '';
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
    this.entry.addEventListener('submit', event => { event.preventDefault(); this.enter('join'); });
    element('lan-copy').addEventListener('click', () => { void this.copyInvite(); });
    element('lan-start').addEventListener('click', () => this.send({ type: 'start' }));
    element('lan-rematch').addEventListener('click', () => this.send({ type: 'rematch' }));
  }

  get isOpen(): boolean { return !this.dialog.hidden; }

  open(defaultName: string, code = ''): void {
    if (!this.name.value) this.name.value = defaultName;
    if (code) this.code.value = code;
    this.dialog.hidden = false;
    this.opener.setAttribute('aria-expanded', 'true');
    this.render();
    (code && this.name.value ? this.code : this.name).focus();
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
    const name = this.name.value.trim() || t('lanGuest');
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
      if (data.type === 'hello') {
        this.id = data.id;
        this.address = data.address;
      } else if (data.type === 'room' || data.type === 'error') {
        window.clearTimeout(this.timeout);
        this.pending = false;
        this.timeout = undefined;
        if (data.type === 'room') {
          this.message = null;
          this.setRoom(data);
        } else {
          this.disconnect();
          this.message = errors[data.code];
          this.render();
        }
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.connectionLost(Boolean(this.room));
    });
  }

  private send(message: ClientMessage): boolean {
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

  private inviteUrl(code: string): string {
    const url = new URL(window.location.href);
    if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname) && this.address) {
      url.hostname = this.address;
    }
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', code);
    return url.href;
  }

  private async copyInvite(): Promise<void> {
    const room = this.room;
    if (!room) return;
    let copied = false;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(this.invite.value);
        copied = true;
      }
    } catch { /* HTTP LAN addresses may require copying a selection. */ }
    if (!copied) {
      this.invite.focus();
      this.invite.select();
      try { copied = document.execCommand('copy'); } catch { /* The link stays selected for manual copying. */ }
    }
    if (this.room === room) {
      this.message = copied ? 'lanCopied' : 'lanCopyManual';
      this.render();
    }
  }

  private render(): void {
    const room = this.room;
    const results = room?.phase === 'results';
    const host = room?.host === this.id;
    this.entry.hidden = Boolean(room);
    this.roomPanel.hidden = !room;
    this.element('lan-share').hidden = !room || results;
    this.element('lan-target').hidden = results;
    this.element('lan-intro').hidden = Boolean(room);
    this.element<HTMLButtonElement>('lan-create').disabled = this.pending;
    this.element<HTMLButtonElement>('lan-join').disabled = this.pending;
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
    const invite = this.inviteUrl(room.code);
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
