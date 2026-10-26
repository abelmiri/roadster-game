const API_URL = (import.meta.env?.VITE_ROADSTER_API_URL || 'https://roadster-api.vercel.app').replace(/\/$/, '');
const SESSION_KEY = 'roadster-api-session';
const DEVICE_KEY = 'roadster-device-id';
const SYNC_KEY = 'roadster-api-sync';

export type RemoteSave = { revision: number; progress: Record<string, unknown> | null; xp: number };
type Session = { playerId: string; token: string; expiresAt: number };
type AuthResponse = { playerId: string; token: string; expiresIn: number };

export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, readonly current?: RemoteSave) {
    super(code);
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as { error?: string; current?: RemoteSave };
    throw new ApiError(error.error || 'request_failed', response.status, error.current);
  }
  return data as T;
}

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function readSession(): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as Session | null;
    if (value?.token && value.playerId && value.expiresAt > Date.now()) return value;
  } catch { /* A damaged session is treated as signed out. */ }
  return null;
}

function saveSession(auth: AuthResponse): Session {
  const session = { playerId: auth.playerId, token: auth.token, expiresAt: Date.now() + auth.expiresIn * 1000 };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function health(): Promise<void> {
  const result = await request<{ status: string }>('/health');
  if (result.status !== 'ok') throw new Error('api_unhealthy');
}

export async function passkey(mode: 'register' | 'login'): Promise<Session> {
  if (!window.PublicKeyCredential || !PublicKeyCredential.parseCreationOptionsFromJSON ||
      !PublicKeyCredential.parseRequestOptionsFromJSON) throw new Error('passkey_unsupported');
  const begin = await request<{ ceremonyId: string; options: { publicKey: PublicKeyCredentialCreationOptionsJSON & PublicKeyCredentialRequestOptionsJSON } }>(
    `/v1/auth/${mode}/options`, 'POST', { deviceId: deviceId() });
  const credential = mode === 'register'
    ? await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(begin.options.publicKey) })
    : await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(begin.options.publicKey) });
  if (!credential) throw new Error('passkey_cancelled');
  const auth = await request<AuthResponse>(`/v1/auth/${mode}/verify`, 'POST', {
    ceremonyId: begin.ceremonyId,
    credential: (credential as PublicKeyCredential).toJSON(),
  });
  return saveSession(auth);
}

export function clearSession(): void { localStorage.removeItem(SESSION_KEY); }
export async function logout(token: string): Promise<void> {
  await request<void>('/v1/auth/logout', 'POST', undefined, token);
  clearSession();
}
export const getProgress = (token: string): Promise<RemoteSave> => request('/v1/me/progress', 'GET', undefined, token);
export const putProgress = (token: string, save: RemoteSave & { runId?: string; runStatus?: 'active' | 'finished' }): Promise<{ revision: number }> =>
  request('/v1/me/progress', 'PUT', save, token);
export const createRun = (token: string, idempotencyKey: string): Promise<{ runId: string; revision: number }> =>
  request('/v1/runs', 'POST', { idempotencyKey }, token);
export const redeem = (token: string, code: string): Promise<{ coinsAdded: number; coins: number; revision: number }> =>
  request('/v1/me/redeem', 'POST', { code }, token);
export const getTelegram = (token: string): Promise<{ linked: boolean; botUsername: string }> =>
  request('/v1/me/telegram', 'GET', undefined, token);
export const linkTelegram = (token: string): Promise<{ url: string; expiresIn: number }> =>
  request('/v1/me/telegram/link', 'POST', undefined, token);
export const unlinkTelegram = (token: string): Promise<void> =>
  request('/v1/me/telegram', 'DELETE', undefined, token);

/** Serializes writes so every PUT uses the revision returned by its predecessor. */
export class GameSync {
  private session = readSession();
  private revision = 0;
  private runId: string | null = null;
  private runStatus: 'active' | 'finished' | null = null;
  private dirty = false;
  private blocked = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private pendingRunKey: string | null = null;
  onError: (error: unknown) => void = () => {};

  constructor(private readonly storage: Storage) {}
  get signedIn(): boolean { return Boolean(this.session); }
  get playerId(): string | null { return this.session?.playerId ?? null; }
  get token(): string | null { return this.session?.token ?? null; }
  get hasConflict(): boolean { return this.blocked; }
  markUnavailable(): void { this.blocked = true; }

  private saveState(): void {
    if (!this.session) return;
    this.storage.setItem(SYNC_KEY, JSON.stringify({ playerId: this.session.playerId, revision: this.revision,
      dirty: this.dirty, runId: this.runId, runStatus: this.runStatus, pendingRunKey: this.pendingRunKey }));
  }

  changed(key: string): void {
    if (key !== 'roadster-progress' && key !== 'roadster-xp') return;
    this.dirty = true;
    this.saveState();
    if (!this.session || this.blocked || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(error => this.onError(error));
    }, this.runStatus === 'active' ? 8000 : 400);
  }

  private snapshot(): RemoteSave {
    const saved = JSON.parse(this.storage.getItem('roadster-progress') || 'null') as Record<string, unknown> | null;
    const xp = Number(this.storage.getItem('roadster-xp') || 0);
    return { revision: this.revision, progress: saved, xp: Number.isSafeInteger(xp) && xp >= 0 ? xp : 0 };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  private async write(): Promise<void> {
    if (!this.session || !this.dirty || this.blocked) return;
    this.dirty = false;
    const save = this.snapshot();
    try {
      const result = await putProgress(this.session.token, {
        ...save,
        ...(this.runId && this.runStatus ? { runId: this.runId, runStatus: this.runStatus } : {}),
      });
      this.revision = result.revision;
      if (this.runStatus === 'finished') { this.runId = null; this.runStatus = null; }
      this.saveState();
    } catch (error) {
      this.dirty = true;
      if (error instanceof ApiError && error.status === 409) this.blocked = true;
      if (error instanceof ApiError && error.status === 401) { clearSession(); this.session = null; }
      this.saveState();
      throw error;
    }
  }

  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    return this.enqueue(() => this.write());
  }

  async initialize(): Promise<boolean> {
    if (!this.session) return false;
    let pending: {
      playerId?: string; revision?: number; dirty?: boolean; runId?: string | null;
      runStatus?: 'active' | 'finished' | null; pendingRunKey?: string | null;
    } | null = null;
    try {
      pending = JSON.parse(this.storage.getItem(SYNC_KEY) || 'null');
    } catch { /* A malformed marker must not prevent loading a healthy save. */ }
    if (pending?.playerId === this.session.playerId && Number.isSafeInteger(pending.revision) && pending.revision! >= 0) {
      this.revision = pending.revision!;
      this.runId = pending.runId ?? null;
      this.runStatus = pending.runStatus ?? null;
      this.pendingRunKey = pending.pendingRunKey ?? null;
      if (pending.dirty) { this.dirty = true; await this.flush(); }
    }
    const remote = await getProgress(this.session.token);
    this.revision = remote.revision;
    if (remote.progress) {
      this.storage.setItem('roadster-progress', JSON.stringify(remote.progress));
      this.storage.setItem('roadster-best', String((remote.progress.record as { distance?: number } | undefined)?.distance ?? 0));
      this.storage.setItem('roadster-xp', String(remote.xp));
      this.dirty = false;
      this.saveState();
      return true;
    }
    this.dirty = true;
    this.saveState();
    await this.flush();
    return false;
  }

  async signedInNow(): Promise<boolean> {
    this.session = readSession();
    this.blocked = false;
    return this.initialize();
  }

  async beginRun(): Promise<void> {
    if (!this.session) return;
    if (this.blocked) throw new Error('sync_unavailable');
    await this.flush();
    const key = this.pendingRunKey ?? crypto.randomUUID();
    this.pendingRunKey = key;
    this.saveState();
    await this.enqueue(async () => {
      const result = await createRun(this.session!.token, key);
      this.revision = result.revision;
      this.runId = result.runId;
      this.runStatus = 'active';
      this.pendingRunKey = null;
      this.saveState();
    });
  }

  finishRun(): Promise<void> {
    if (!this.session) return Promise.resolve();
    this.runStatus = 'finished';
    this.dirty = true;
    this.saveState();
    return this.flush();
  }

  async refreshFromServer(): Promise<void> {
    if (!this.session) return;
    await this.enqueue(async () => {
      const remote = await getProgress(this.session!.token);
      if (!remote.progress) return;
      this.storage.setItem('roadster-progress', JSON.stringify(remote.progress));
      this.storage.setItem('roadster-best', String((remote.progress.record as { distance?: number } | undefined)?.distance ?? 0));
      this.storage.setItem('roadster-xp', String(remote.xp));
      this.revision = remote.revision;
      this.dirty = false;
      this.blocked = false;
      this.runId = null;
      this.runStatus = null;
      this.pendingRunKey = null;
      this.saveState();
    });
  }

  async redeemCode(code: string): Promise<void> {
    if (!this.session) return;
    if (this.blocked) throw new ApiError('revision_conflict', 409);
    await this.flush();
    await redeem(this.session.token, code);
    await this.refreshFromServer();
  }

  signOut(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.session = null;
    this.runId = null;
    this.runStatus = null;
    this.pendingRunKey = null;
    this.blocked = false;
    this.storage.removeItem(SYNC_KEY);
  }
}
