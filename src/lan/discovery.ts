const API = (import.meta.env?.VITE_ROADSTER_API_URL || 'https://roadster-api.vercel.app').replace(/\/$/, '');

export interface NearbyPlayer { id: string; name: string }
export interface NearbyInvite {
  id: string; hostId: string; guestId: string; hostName: string; guestName: string;
  state: 'pending' | 'accepted';
}
export interface NearbySignal { kind: 'offer' | 'answer'; signalId: string; code: string; sdp: string; wifiAddress?: string }
export interface NearbyState { id: string; peers: NearbyPlayer[]; invites: NearbyInvite[]; signal: NearbySignal | null }

export class DiscoveryApi {
  id = '';
  private token = '';

  private async request<T>(path: string, method = 'GET', body?: object): Promise<T> {
    const response = await fetch(`${API}/v1/lan/${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      keepalive: method === 'DELETE',
    });
    if (!response.ok) throw new Error(`Discovery ${response.status}`);
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }

  async begin(name: string): Promise<void> {
    const session = await this.request<{ id: string; token: string }>('session', 'POST', { name });
    this.id = session.id;
    this.token = session.token;
  }

  state(): Promise<NearbyState> { return this.request('state'); }
  invite(peerId: string): Promise<{ id: string }> { return this.request('invite', 'POST', { peerId }); }
  respond(inviteId: string, accept: boolean): Promise<void> { return this.request('respond', 'POST', { inviteId, accept }); }
  cancel(inviteId: string): Promise<void> { return this.request('cancel', 'POST', { inviteId }); }
  signal(inviteId: string, signal: NearbySignal): Promise<void> {
    return this.request('signal', 'POST', { inviteId, ...signal });
  }
  async close(): Promise<void> {
    if (!this.token) return;
    try { await this.request('session', 'DELETE'); } finally { this.token = ''; this.id = ''; }
  }
  reset(): void { this.token = ''; this.id = ''; }
}
