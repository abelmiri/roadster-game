import { carPaintPalette } from '../game/carPaint';
import { formatNumber, getLanguage, t } from '../i18n';
import { DiscoveryApi, type NearbyInvite, type NearbyPlayer, type NearbySignal } from './discovery';
import { PeerGuest, PeerHost, readSignal, type Signal } from './peer';
import { isPrivateWifiAddress } from './wifi';
import type { ClientMessage, DriveState, LanRoom, RoomPlayer, ServerMessage } from './protocol';

export class LanLobby {
  private readonly dialog: HTMLDivElement;
  private readonly hud: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly api = new DiscoveryApi();
  private readonly dismissed = new Set<string>();
  private peers: NearbyPlayer[] = [];
  private active: NearbyInvite | null = null;
  private peer: PeerHost | PeerGuest | null = null;
  private name = '';
  private status = '';
  private failedPeerId = '';
  private polling = false;
  private connecting = false;
  private signaling = false;
  private answerApplied = false;
  private connectTimer: number | undefined;
  private readonly ignoredInvites = new Set<string>();
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
    element('lan-accept').addEventListener('click', () => void this.respond(true));
    element('lan-decline').addEventListener('click', () => void this.respond(false));
    element('lan-start').addEventListener('click', () => this.send({ type: 'start' }));
    element('lan-rematch').addEventListener('click', () => this.send({ type: 'rematch' }));
    element('lan-retry-button').addEventListener('click', () => void this.retry());
    window.addEventListener('pagehide', () => { void this.api.close().catch(() => {}); });
  }

  get isOpen(): boolean { return !this.dialog.hidden; }

  begin(name: string): void {
    this.name = name.trim().slice(0, 24) || t('lanGuest');
    void this.connectDiscovery();
  }

  private async connectDiscovery(): Promise<void> {
    if (this.connecting || this.api.id) return;
    this.connecting = true;
    try { await this.api.begin(this.name); this.status = ''; }
    catch { this.status = t('lanDiscoveryUnavailable'); }
    this.connecting = false;
    this.render();
    window.setTimeout(() => void this.poll(), 3000);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    if (!this.api.id) { void this.connectDiscovery(); return; }
    this.polling = true;
    try {
      const state = await this.api.state();
      this.peers = state.peers;
      for (const id of this.dismissed) if (!this.peers.some(peer => peer.id === id)) this.dismissed.delete(id);
      const wasActive = Boolean(this.active);
      this.active = state.invites.find(item => item.id === this.active?.id) ??
        state.invites.find(item => !this.ignoredInvites.has(item.id)) ?? null;
      if (wasActive && !this.active && !this.peer) this.status = '';
      const invite = this.active;
      if (invite?.state === 'accepted' && !this.signaling) {
        this.signaling = true;
        this.connectTimer = window.setTimeout(() => this.connectionLost(), 25_000);
        if (invite.hostId === this.api.id) void this.host(invite);
      }
      if (invite?.state === 'accepted' && state.signal?.kind === 'offer' && !this.peer && invite.guestId === this.api.id)
        void this.guest(invite, state.signal);
      if (invite?.state === 'accepted' && state.signal?.kind === 'answer' && !this.answerApplied && this.peer instanceof PeerHost) {
        this.answerApplied = true;
        const answer: Signal = { id: state.signal.signalId, type: 'answer', ...state.signal };
        if (!await this.peer.acceptReply(answer)) this.connectionLost();
      }
      if (!this.room && !this.peer && !this.isOpen && !this.active && this.peers.some(peer => !this.dismissed.has(peer.id))) this.onProposal();
      if (!this.room && !this.isOpen && invite?.guestId === this.api.id && invite.state === 'pending') this.onProposal();
      if (this.status === t('lanDiscoveryUnavailable')) this.status = '';
      this.render();
    } catch (error) {
      if (error instanceof Error && error.message === 'Discovery 401') this.api.reset();
      this.status = t('lanDiscoveryUnavailable');
      this.render();
    } finally {
      this.polling = false;
      if (this.api.id) window.setTimeout(() => void this.poll(), 3000);
      else void this.connectDiscovery();
    }
  }

  private async host(invite: NearbyInvite): Promise<void> {
    const host = new PeerHost(data => this.receive(data), () => this.connectionLost());
    this.peer = host;
    this.id = host.id;
    host.start(this.name);
    this.status = t('lanDirectPreparing');
    this.render();
    try {
      const offer = readSignal(await host.createInvitation(this.savedWifiAddress()), 'offer');
      if (!offer || this.peer !== host) return;
      await this.api.signal(invite.id, { kind: 'offer', signalId: offer.id, code: offer.code, sdp: offer.sdp,
        wifiAddress: offer.wifiAddress });
      this.status = t('lanDirectConnecting');
    } catch { if (this.peer === host) this.connectionLost(); }
    this.render();
  }

  private async guest(invite: NearbyInvite, offer: NearbySignal): Promise<void> {
    const signal: Signal = { id: offer.signalId, type: 'offer', ...offer };
    const guest = new PeerGuest(signal, this.name, data => this.receive(data), () => this.connectionLost());
    this.peer = guest;
    this.status = t('lanDirectPreparing');
    this.render();
    try {
      const answer = readSignal(await guest.prepareReply(this.savedWifiAddress()), 'answer');
      if (!answer || this.peer !== guest) return;
      await this.api.signal(invite.id, { kind: 'answer', signalId: answer.id, code: answer.code, sdp: answer.sdp,
        wifiAddress: answer.wifiAddress });
      this.status = t('lanDirectConnecting');
    } catch { if (this.peer === guest) this.connectionLost(); }
    this.render();
  }

  private async invite(peerId: string): Promise<void> {
    if (this.active || !this.api.id) return;
    try {
      this.failedPeerId = '';
      const result = await this.api.invite(peerId);
      this.active = { id: result.id, hostId: this.api.id, guestId: peerId,
        hostName: this.name, guestName: this.peers.find(peer => peer.id === peerId)?.name ?? '', state: 'pending' };
      this.status = t('lanWaitingAnswer');
    } catch { this.status = t('lanPeerUnavailable'); }
    this.render();
  }

  private savedWifiAddress(): string | undefined {
    try {
      const address = localStorage.getItem('roadster-lan-wifi-address');
      return isPrivateWifiAddress(address) ? address : undefined;
    } catch { return undefined; }
  }

  private async retry(): Promise<void> {
    const field = this.element<HTMLInputElement>('lan-retry-address');
    const address = field.value.trim()
      .replace(/[۰-۹]/g, character => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(character)))
      .replace(/[٠-٩]/g, character => String('٠١٢٣٤٥٦٧٨٩'.indexOf(character)));
    if (address && !isPrivateWifiAddress(address)) {
      this.status = t('lanWifiInvalid');
      this.render();
      field.focus();
      return;
    }
    try {
      if (address) localStorage.setItem('roadster-lan-wifi-address', address);
      else localStorage.removeItem('roadster-lan-wifi-address');
    } catch { /* The connection can continue without saved preferences. */ }
    const peerId = this.failedPeerId;
    if (!peerId) return;
    this.failedPeerId = '';
    this.status = '';
    this.dismissed.delete(peerId);
    await this.invite(peerId);
  }

  private async respond(accept: boolean): Promise<void> {
    const invite = this.active;
    if (!invite || invite.guestId !== this.api.id || invite.state !== 'pending') return;
    try {
      await this.api.respond(invite.id, accept);
      if (accept) { this.active = { ...invite, state: 'accepted' }; this.status = t('lanDirectConnecting'); }
      else { this.active = null; this.dismissed.add(invite.hostId); }
    } catch { this.status = t('lanPeerUnavailable'); }
    this.render();
  }

  open(): void {
    if (this.room?.phase === 'racing') return;
    this.dialog.hidden = false;
    this.render();
    this.element('lan-close').focus();
  }

  leave(restoreFocus = true): void {
    this.failedPeerId = '';
    if (!this.room && !this.active) for (const peer of this.peers) this.dismissed.add(peer.id);
    if (this.active) {
      this.dismissed.add(this.active.hostId === this.api.id ? this.active.guestId : this.active.hostId);
      this.ignoredInvites.add(this.active.id);
      void this.api.cancel(this.active.id).catch(() => {});
    }
    window.clearTimeout(this.connectTimer);
    this.peer?.close();
    this.peer = null;
    this.active = null;
    this.signaling = this.answerApplied = false;
    this.id = 0;
    this.setRoom(null);
    this.dialog.hidden = true;
    if (restoreFocus) this.element('primary-button').focus();
  }

  private connectionLost(): void {
    const peerId = this.active?.hostId === this.api.id ? this.active?.guestId : this.active?.hostId;
    this.leave(false);
    this.failedPeerId = peerId ?? '';
    this.element<HTMLInputElement>('lan-retry-address').value = this.savedWifiAddress() ?? '';
    this.status = t('lanDirectFailed');
    this.dialog.hidden = false;
    this.render();
  }

  handleKey(event: KeyboardEvent): void {
    if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) this.leave(); }
  }

  private receive(data: ServerMessage): void {
    if (data.type === 'hello') { this.id = data.id; return; }
    if (data.type === 'error') { this.connectionLost(); return; }
    this.status = '';
    this.setRoom(data);
  }

  private send(message: ClientMessage): boolean { return this.peer?.send(message) ?? false; }

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
    this.dialog.dir = this.hud.dir = getLanguage() === 'fa' ? 'rtl' : 'ltr';
    this.hud.setAttribute('aria-label', t('lanTitle'));
    this.element('lan-close').setAttribute('aria-label', t('closeSettings'));
    this.render();
  }

  private setRoom(room: LanRoom | null): void {
    const previous = this.room;
    this.room = room;
    if (room && room.players.length === 2) window.clearTimeout(this.connectTimer);
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

  private render(): void {
    const room = this.room;
    const results = room?.phase === 'results';
    const incoming = this.active?.guestId === this.api.id && this.active.state === 'pending';
    this.element('lan-discovery').hidden = Boolean(room || this.active);
    this.element('lan-incoming').hidden = !incoming;
    this.element('lan-room').hidden = !room;
    this.text('lan-title', t(results ? 'lanResults' : room ? 'lanLobby' : 'lanTitle'));
    this.text('lan-intro', incoming ? t('lanIncoming', { name: this.active!.hostName }) :
      this.active ? this.status || t('lanWaitingAnswer') : t('lanNearbyIntro'));
    this.text('lan-status', this.active ? '' : this.status);
    this.element('lan-retry').hidden = !this.failedPeerId || Boolean(room || this.active);
    this.text('lan-presence', this.status === t('lanDiscoveryUnavailable') ? this.status :
      this.room || this.active ? '' : this.peers.some(peer => !this.dismissed.has(peer.id)) ? t('lanFound') : t('lanSearching'));
    const list = this.element('lan-peers');
    const visible = this.peers.filter(peer => !this.dismissed.has(peer.id));
    const old = [...list.querySelectorAll<HTMLButtonElement>('button')];
    if (visible.length !== old.length || visible.some((peer, i) =>
      old[i]?.dataset.peerId !== peer.id || old[i].textContent !== t('lanPlayWith', { name: peer.name }))) {
      list.replaceChildren();
      for (const peer of visible) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.peerId = peer.id;
        button.textContent = t('lanPlayWith', { name: peer.name });
        button.addEventListener('click', () => void this.invite(peer.id));
        list.append(button);
      }
    }
    if (!room) return;
    const ranked = [...room.players].sort((a, b) => Number(b.id === room.winner) - Number(a.id === room.winner) ||
      Number(b.connected) - Number(a.connected) || (b.drive?.distance ?? 0) - (a.drive?.distance ?? 0));
    if (!this.hud.hidden) {
      this.text('lan-finish-distance', t('lanFinishDistance', { distance: formatNumber(room.target) }));
      this.renderPlayers('lan-standing', ranked, true);
      this.updateClock(performance.now(), Boolean(room.players.find(player => player.id === this.id)?.drive?.crashed));
      return;
    }
    this.element('lan-target').hidden = results;
    this.text('lan-target', t('lanDistanceGoal', { distance: formatNumber(room.target) }));
    this.element('lan-start').hidden = results || room.host !== this.id;
    this.element<HTMLButtonElement>('lan-start').disabled = room.players.length < 2;
    this.element('lan-rematch').hidden = !results || room.host !== this.id;
    const winner = room.players.find(player => player.id === room.winner);
    this.text('lan-room-message', results ? (winner ? t('lanWinner', { name: winner.name }) : t('lanDraw'))
      : room.players.length < 2 ? t('lanNeedPlayers') : t(room.host === this.id ? 'lanRoomReady' : 'lanWaitHost'));
    this.renderPlayers('lan-roster', results ? ranked : room.players, results, room.host);
  }

  private renderPlayers(id: string, players: RoomPlayer[], showDistance: boolean, host?: number): void {
    const list = this.element(id);
    for (let i = 0; i < 2; i++) {
      const row = this.element(`${id}-${i}`);
      const player = players[i];
      row.hidden = !player;
      if (!player) continue;
      const detail = [player.id === this.id ? t('lanYou') : '', player.id === host ? t('lanHost') : '',
        !player.connected ? t('lanDisconnected') : player.drive?.crashed ? t('lanCrashed') : ''].filter(Boolean).join(' · ');
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
