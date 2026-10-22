import RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_STEP, GamePhysics, type Controls, type GameSnapshot } from './game/physics';
import { GameVisuals } from './game/visuals';
import { GameAudio } from './game/audio';
import { formatNumber, formatPercent, getLanguage, setLanguage, t, type MessageKey } from './i18n';
import './styles.css';

type GameStatus = 'loading' | 'ready' | 'running' | 'paused' | 'crashed' | 'error';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing app element');

app.innerHTML = `
  <div class="game-shell">
    <div id="scene" class="scene"></div>
    <div class="vignette" aria-hidden="true"></div>
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span data-i18n="brand"></span><span class="brand-edition" data-i18n="edition"></span></div>
      <div class="topbar-tools">
        <div class="hud" aria-live="off">
          <div class="hud-stat"><span class="hud-label" data-i18n="distance"></span><strong id="distance"></strong></div>
          <div class="hud-divider"></div>
          <div class="hud-stat"><span class="hud-label" data-i18n="best"></span><strong id="best"></strong></div>
          <button id="pause-button" class="icon-button" type="button"><span class="pause-icon" aria-hidden="true"></span></button>
        </div>
        <div class="settings-controls">
          <button id="sound-button" class="icon-button sound-button" type="button" aria-pressed="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4Z"/><path class="sound-waves" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-slash" d="m15 9 6 6m0-6-6 6"/></svg>
          </button>
          <button id="language-button" class="language-button" type="button"><span id="language-en" lang="en" dir="ltr">EN</span><span class="language-separator" aria-hidden="true">/</span><span id="language-fa" lang="fa" dir="rtl">فارسی</span></button>
        </div>
      </div>
    </header>
    <div class="district-tag"><span class="district-dot"></span><span id="district"></span></div>
    <div class="bottom-hud">
      <div class="boost-panel"><div class="boost-heading"><span data-i18n="boostReserve"></span><span id="boost-value"></span></div><div id="boost-meter" class="boost-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div id="boost-fill" class="boost-fill"></div></div></div>
      <div class="speed-panel"><span data-i18n="speed"></span><strong id="speed"></strong><small data-i18n="speedUnit"></small></div>
    </div>
    <div class="keyboard-guide" aria-hidden="true"><span><kbd data-i18n="spaceKey"></kbd><span data-i18n="jumpGuide"></span></span><span><kbd>↓</kbd><span data-i18n="suction"></span></span><span><kbd data-i18n="shiftKey"></kbd><span data-i18n="airBoost"></span></span></div>
    <div class="touch-controls">
      <button id="touch-suction" class="touch-button touch-suction" type="button"><span class="touch-glyph" aria-hidden="true">↓</span><span data-i18n="suction"></span></button>
      <div class="touch-right"><button id="touch-boost" class="touch-button touch-boost" type="button"><span class="touch-glyph" aria-hidden="true">↗</span><span data-i18n="boost"></span></button><button id="touch-jump" class="touch-button touch-jump" type="button"><span class="touch-glyph" aria-hidden="true">↑</span><span data-i18n="jump"></span></button></div>
    </div>
    <div id="overlay" class="overlay is-visible">
      <div class="intro-grid" aria-hidden="true"></div>
      <div class="overlay-card">
        <span id="eyebrow" class="eyebrow"></span>
        <h1 id="overlay-title"></h1>
        <p id="overlay-description" class="overlay-description"></p>
        <div id="overlay-controls" class="control-summary"><div><span data-number="1"></span><strong data-i18n="jump"></strong><small data-i18n="jumpSummary"></small></div><div><span data-number="2"></span><strong data-i18n="suction"></strong><small data-i18n="suctionSummary"></small></div><div><span data-number="3"></span><strong data-i18n="boost"></strong><small data-i18n="boostSummary"></small></div></div>
        <button id="primary-button" class="primary-button" type="button"><span id="primary-label"></span><span class="button-arrow" aria-hidden="true">↗</span></button>
        <div id="overlay-foot" class="overlay-foot"></div>
      </div>
      <div class="overlay-side" aria-hidden="true"><span data-i18n="sideIndex"></span><span data-i18n="sideMotto"></span></div>
    </div>
    <div id="rotate-overlay" class="rotate-overlay"><div class="rotate-symbol" aria-hidden="true">▯</div><strong data-i18n="rotateTitle"></strong><p data-i18n="rotateDescription"></p></div>
    <div id="loading" class="loading"><span><span data-i18n="loading"></span><span class="loading-dots" aria-hidden="true">...</span></span></div>
  </div>
`;

const element = <T extends HTMLElement>(id: string): T => {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing #${id}`);
  return result as T;
};

const sceneElement = element<HTMLDivElement>('scene');
const overlay = element<HTMLDivElement>('overlay');
const title = element<HTMLHeadingElement>('overlay-title');
const eyebrow = element<HTMLSpanElement>('eyebrow');
const description = element<HTMLParagraphElement>('overlay-description');
const controlsSummary = element<HTMLDivElement>('overlay-controls');
const primaryButton = element<HTMLButtonElement>('primary-button');
const primaryLabel = element<HTMLSpanElement>('primary-label');
const overlayFoot = element<HTMLDivElement>('overlay-foot');
const loading = element<HTMLDivElement>('loading');
const distanceLabel = element<HTMLSpanElement>('distance');
const bestLabel = element<HTMLSpanElement>('best');
const boostFill = element<HTMLDivElement>('boost-fill');
const boostValue = element<HTMLSpanElement>('boost-value');
const boostMeter = element<HTMLDivElement>('boost-meter');
const speedLabel = element<HTMLSpanElement>('speed');
const districtLabel = element<HTMLSpanElement>('district');
const pauseButton = element<HTMLButtonElement>('pause-button');
const soundButton = element<HTMLButtonElement>('sound-button');
const languageButton = element<HTMLButtonElement>('language-button');
const audio = new GameAudio();

let status: GameStatus = 'loading';
let physics: GamePhysics;
let visuals: GameVisuals;
let accumulator = 0;
let lastFrame = performance.now();
let jumpQueued = false;
let currentDistrict = 0;
const warnedChallenges = new Set<string>();
let failureKey: 'bootError' | 'runtimeError' | null = null;
const held = { jump: new Set<string>(), suction: new Set<string>(), boost: new Set<string>() };
let best = 0;
try { best = Number(localStorage.getItem('roadster-best') || 0) || 0; } catch { /* Storage may be disabled. */ }

const formatDistance = (meters: number): string => `${formatNumber(meters, 4)} <small>${t('meter')}</small>`;
const districtKeys: MessageKey[] = ['districtMorning', 'districtDowntown', 'districtNight'];

function updateAudioButton(): void {
  soundButton.classList.toggle('is-muted', audio.muted);
  soundButton.setAttribute('aria-pressed', String(!audio.muted));
  soundButton.setAttribute('aria-label', t(audio.muted ? 'unmute' : 'mute'));
  soundButton.title = t(audio.muted ? 'unmuteTitle' : 'muteTitle');
}

function updatePauseButton(): void {
  const paused = status === 'paused';
  pauseButton.classList.toggle('is-paused', paused);
  pauseButton.setAttribute('aria-label', t(paused ? 'resume' : 'pause'));
  pauseButton.title = t(paused ? 'resumeTitle' : 'pauseTitle');
  pauseButton.disabled = status !== 'running' && status !== 'paused';
}

function updateHud(snapshot?: GameSnapshot): void {
  distanceLabel.innerHTML = formatDistance(snapshot?.distance ?? 0);
  bestLabel.innerHTML = formatDistance(best);
  const charge = snapshot?.boost ?? 1;
  const percentage = Math.round(charge * 100);
  boostFill.style.width = `${percentage}%`;
  boostValue.textContent = formatPercent(charge);
  boostMeter.setAttribute('aria-valuenow', String(percentage));
  boostMeter.setAttribute('aria-label', t('boostReserve'));
  boostMeter.setAttribute('aria-valuetext', t('boostMeter', { charge: formatPercent(charge) }));
  speedLabel.textContent = formatNumber(Math.round(Math.max(0, snapshot?.speed ?? 0) * 3.6), 2);
  districtLabel.textContent = t(districtKeys[currentDistrict]);
}

function setOverlay(mode: 'ready' | 'paused' | 'crashed'): void {
  overlay.classList.add('is-visible');
  overlay.classList.toggle('is-compact', mode !== 'ready');
  controlsSummary.hidden = mode !== 'ready';
  const prefix = mode === 'ready' ? 'ready' : mode === 'paused' ? 'paused' : 'crashed';
  eyebrow.innerHTML = `<span class="eyebrow-line"></span>${t(`${prefix}Eyebrow`)}`;
  title.innerHTML = t(`${prefix}Title`);
  description.textContent = mode === 'crashed'
    ? t('crashedDescription', { distance: formatNumber(physics.distance), best: formatNumber(best) })
    : t(mode === 'ready' ? 'readyDescription' : 'pausedDescription');
  primaryLabel.textContent = t(mode === 'ready' ? 'start' : mode === 'paused' ? 'resumeRun' : 'runAgain');
  overlayFoot.innerHTML = t(`${prefix}Foot`);
  updatePauseButton();
}

function updateLanguage(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((label) => {
    label.textContent = t(label.dataset.i18n as MessageKey);
  });
  document.querySelectorAll<HTMLElement>('[data-number]').forEach((label) => {
    label.textContent = formatNumber(Number(label.dataset.number), 2);
  });
  sceneElement.setAttribute('aria-label', t('sceneLabel'));
  element('touch-jump').setAttribute('aria-label', t('jumpLabel'));
  element('touch-suction').setAttribute('aria-label', t('suctionLabel'));
  element('touch-boost').setAttribute('aria-label', t('boostLabel'));
  languageButton.setAttribute('aria-label', t('switchLanguage'));
  languageButton.title = t('switchLanguage');
  element('language-en').classList.toggle('is-active', getLanguage() === 'en');
  element('language-fa').classList.toggle('is-active', getLanguage() === 'fa');
  updateAudioButton();
  updatePauseButton();
  updateHud(physics?.snapshot(Math.min(1, accumulator / FIXED_STEP)));
  if (status === 'ready' || status === 'paused' || status === 'crashed') setOverlay(status);
  else if (status === 'loading') setOverlay('ready');
  if (failureKey) renderFailure();
}

function clearHeld(): void {
  Object.values(held).forEach((set) => set.clear());
  document.querySelectorAll('.touch-button').forEach((button) => button.classList.remove('is-pressed'));
}

function start(): void {
  if (status === 'loading' || status === 'error' || status === 'running') return;
  const resuming = status === 'paused';
  if (status === 'crashed') {
    physics.dispose();
    physics = new GamePhysics();
    audio.reset();
    accumulator = 0;
    jumpQueued = false;
    currentDistrict = 0;
    warnedChallenges.clear();
    clearHeld();
  }
  status = 'running';
  overlay.classList.remove('is-visible');
  lastFrame = performance.now();
  primaryButton.blur();
  updatePauseButton();
  void audio.unlock().then(() => audio.play(resuming ? 'resume' : 'start'));
}

function pause(): void {
  if (status !== 'running') { audio.suspend(); return; }
  status = 'paused';
  jumpQueued = false;
  clearHeld();
  audio.play('pause');
  audio.suspend();
  setOverlay('paused');
}

function crash(): void {
  if (status !== 'running') return;
  status = 'crashed';
  clearHeld();
  audio.play('crash');
  const distance = Math.floor(physics.distance);
  if (distance > best) {
    best = distance;
    try { localStorage.setItem('roadster-best', String(best)); } catch { /* Storage may be disabled. */ }
    bestLabel.innerHTML = formatDistance(best);
    audio.play('record');
  }
  setOverlay('crashed');
}

function jumpDown(source: string): void {
  if (held.jump.has(source)) return;
  held.jump.add(source);
  if (status === 'ready' || status === 'crashed' || status === 'paused') {
    start();
    return;
  }
  if (status === 'running') jumpQueued = true;
}

function bindTouch(id: string, action: keyof typeof held): void {
  const button = element<HTMLButtonElement>(id);
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    void audio.unlock();
    button.setPointerCapture(event.pointerId);
    button.classList.add('is-pressed');
    const source = `pointer-${event.pointerId}`;
    if (action === 'jump') jumpDown(source);
    else held[action].add(source);
  });
  const release = (event: PointerEvent): void => {
    button.classList.remove('is-pressed');
    held[action].delete(`pointer-${event.pointerId}`);
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

bindTouch('touch-jump', 'jump');
bindTouch('touch-suction', 'suction');
bindTouch('touch-boost', 'boost');

const actionForKey = (code: string): keyof typeof held | null => {
  if (['Space', 'ArrowUp', 'KeyW'].includes(code)) return 'jump';
  if (['ArrowDown', 'KeyS'].includes(code)) return 'suction';
  if (['ShiftLeft', 'ShiftRight', 'KeyX'].includes(code)) return 'boost';
  return null;
};

function toggleSound(): void {
  void audio.unlock();
  audio.toggleMuted();
  updateAudioButton();
  audio.play('click');
  soundButton.blur();
}

window.addEventListener('keydown', (event) => {
  const action = actionForKey(event.code);
  if (action) {
    event.preventDefault();
    if (event.repeat) return;
    void audio.unlock();
    if (action === 'jump') jumpDown(`key-${event.code}`);
    else held[action].add(`key-${event.code}`);
  } else if (event.code === 'KeyP' || event.code === 'Escape') {
    event.preventDefault();
    if (event.repeat) return;
    if (status === 'running') pause();
    else if (status === 'paused') start();
  } else if (event.code === 'KeyM' && !event.repeat) {
    event.preventDefault();
    toggleSound();
  }
});

window.addEventListener('keyup', (event) => {
  const action = actionForKey(event.code);
  if (action) held[action].delete(`key-${event.code}`);
});
window.addEventListener('blur', pause);
window.addEventListener('pagehide', () => audio.suspend());
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
primaryButton.addEventListener('click', start);
pauseButton.addEventListener('click', () => { if (status === 'running') pause(); else if (status === 'paused') start(); });
soundButton.addEventListener('click', toggleSound);
languageButton.addEventListener('click', () => {
  setLanguage(getLanguage() === 'en' ? 'fa' : 'en');
  updateLanguage();
  void audio.unlock().then(() => audio.play('click'));
  languageButton.blur();
});

function renderFailure(): void {
  if (!failureKey) return;
  loading.innerHTML = `<div class="loading-card"><p>${t(failureKey)}</p><button class="primary-button" type="button">${t('reload')}</button></div>`;
  loading.querySelector('button')?.addEventListener('click', () => location.reload());
  document.querySelector('.game-shell')?.appendChild(loading);
}

function fail(key: 'bootError' | 'runtimeError'): void {
  status = 'error';
  failureKey = key;
  clearHeld();
  audio.suspend();
  updatePauseButton();
  renderFailure();
}

function frame(now: number): void {
  try { renderFrame(now); }
  catch (error) {
    console.error('Roadster frame failed', error);
    fail('runtimeError');
  }
}

function renderFrame(now: number): void {
  const delta = Math.min((now - lastFrame) / 1000, 0.06);
  lastFrame = now;
  if (status === 'running') {
    accumulator = Math.min(accumulator + delta, 0.15);
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 10) {
      const controls: Controls = {
        jumpPressed: jumpQueued,
        jumpHeld: held.jump.size > 0,
        suction: held.suction.size > 0,
        boost: held.boost.size > 0,
      };
      physics.step(controls);
      jumpQueued = false;
      accumulator -= FIXED_STEP;
      steps++;
      if (physics.crashed) { crash(); break; }
    }
  }

  const snapshot = physics.snapshot(Math.min(1, accumulator / FIXED_STEP));
  visuals.render(snapshot, physics, delta, status === 'running');
  audio.update(snapshot, status === 'running');
  if (status === 'running') {
    const warningDistance = Math.max(7, snapshot.speed * 0.85);
    for (const hazard of physics.hazardStates) {
      const ahead = hazard.x - snapshot.car.x;
      if (ahead > 2 && ahead < warningDistance && !warnedChallenges.has(hazard.id)) {
        warnedChallenges.add(hazard.id);
        audio.play('warning');
      }
    }
    for (const [index, chunk] of physics.chunks) {
      const id = `gap-${index}`;
      const ahead = chunk.spec.gap ? chunk.spec.gap.start - snapshot.car.x : Infinity;
      if (ahead > 2 && ahead < warningDistance && !warnedChallenges.has(id)) {
        warnedChallenges.add(id);
        audio.play('warning');
      }
    }
  }
  const district = Math.min(2, Math.floor(snapshot.distance / 360));
  if (district !== currentDistrict && status === 'running') audio.play('district');
  currentDistrict = district;
  updateHud(snapshot);
  document.body.classList.toggle('fans-on', snapshot.suctionActive);
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  try {
    await RAPIER.init();
    physics = new GamePhysics();
    visuals = new GameVisuals(sceneElement);
    const snapshot = physics.snapshot(0);
    visuals.render(snapshot, physics, 0, false);
    updateHud(snapshot);
    status = 'ready';
    loading.remove();
    setOverlay('ready');
    requestAnimationFrame(frame);
  } catch (error) {
    console.error('Roadster could not start', error);
    fail('bootError');
  }
}

updateLanguage();
void boot();
