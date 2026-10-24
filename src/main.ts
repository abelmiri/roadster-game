import RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_STEP, GamePhysics, type Controls, type GameSnapshot } from './game/physics';
import { GameVisuals } from './game/visuals';
import { GameAudio } from './game/audio';
import { HudFeedback } from './game/hudFeedback';
import { ExperienceProgress, LEVEL_XP } from './game/experience';
import { loopsBetween } from './game/track';
import { ImpactPause, IMPACT_DAMAGE, IMPACT_PAUSE_SECONDS, ExplosionSlowMotion, RESTART_DELAY_SECONDS, WRECK_TIME_SCALE, MAX_HEALTH } from './game/damage';
import { WeaponLoadout, WEAPONS, weaponSpec, type AimDirection } from './game/weapons';
import { weaponIcon } from './game/weaponIcon';
import { formatNumber, formatPercent, getLanguage, setLanguage, t, type MessageKey } from './i18n';
import './styles.css';
import './hud.css';

type GameStatus = 'loading' | 'ready' | 'running' | 'paused' | 'crashed' | 'error';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing app element');

app.innerHTML = `
  <div class="game-shell">
    <div id="scene" class="scene"></div>
    <div class="vignette" aria-hidden="true"></div>
    ${import.meta.env.DEV ? '<div id="fps-counter" class="fps-counter" aria-hidden="true" lang="en" dir="ltr">-- FPS</div>' : ''}
    <header class="topbar">
      <div class="brand"><img class="brand-mark app-icon" src="/icons/icon-192.png" width="32" height="32" alt="" /><span data-i18n="brand"></span><span class="brand-edition" data-i18n="edition"></span></div>
      <div class="topbar-tools">
        <div class="hud" aria-live="off">
          <div class="hud-stat"><span class="hud-label" data-i18n="distance"></span><strong id="distance"></strong></div>
          <div class="hud-divider"></div>
          <div class="hud-stat"><span class="hud-label" data-i18n="best"></span><strong id="best"></strong></div>
          <button id="pause-button" class="icon-button" type="button"><span class="pause-icon" aria-hidden="true"></span></button>
        </div>
        <div class="settings-controls">
          <button id="armory-button" class="icon-button armory-button" type="button" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h9v7H4zM13 10h8v3h-8M7 15v4m-4 0h12M6 6h5"/></svg></button>
          <button id="sound-button" class="icon-button sound-button" type="button" aria-pressed="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4Z"/><path class="sound-waves" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-slash" d="m15 9 6 6m0-6-6 6"/></svg>
          </button>
          <button id="language-button" class="language-button" type="button"><span id="language-en" lang="en" dir="ltr">EN</span><span class="language-separator" aria-hidden="true">/</span><span id="language-fa" lang="fa" dir="rtl">فارسی</span></button>
        </div>
      </div>
    </header>
    <div class="district-tag"><span class="district-dot"></span><span id="district"></span></div>
    <div id="pursuit-glow" class="pursuit-glow" aria-hidden="true"></div>
    <div id="impact-flash" class="impact-flash" aria-hidden="true"></div>
    <div id="challenge-hint" class="challenge-hint" role="status"></div>
    <div id="xp-toast" class="xp-toast" role="status"></div>
    <div class="resources-panel">
        <div id="health-panel" class="health-panel"><div class="boost-heading"><span data-i18n="health"></span><span id="health-value"></span></div><div id="health-meter" class="health-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div id="health-trail" class="health-trail" aria-hidden="true"></div><div id="health-fill" class="health-fill"></div></div></div>
        <div id="boost-panel" class="boost-panel"><div class="boost-heading"><span data-i18n="boostReserve"></span><span id="boost-value"></span></div><div id="boost-meter" class="boost-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div id="boost-fill" class="boost-fill"></div></div></div>
    </div>
    <div id="weapon-panel" class="weapon-panel">
      <div class="weapon-heading"><span id="weapon-name"></span><strong id="weapon-ammo" dir="ltr"></strong></div>
      <div id="ammo-meter" class="ammo-track" role="progressbar" aria-valuemin="0"><span id="ammo-fill"></span></div>
      <div class="weapon-status-row"><button id="weapon-aim" class="aim-button" type="button"><span id="weapon-direction"></span><kbd lang="en" dir="ltr">Q</kbd></button><span id="weapon-status" role="status"></span></div>
    </div>
    <div class="bottom-hud">
      <div class="experience-panel"><div><span id="xp-level"></span><strong id="xp-total"></strong></div><div id="xp-meter" class="xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span id="xp-fill"></span></div></div>
      <div class="speed-panel"><span data-i18n="speed"></span><strong id="speed"></strong><small data-i18n="speedUnit"></small></div>
    </div>
    <div class="keyboard-guide" aria-hidden="true"><span><kbd lang="en" dir="ltr" data-i18n="spaceKey"></kbd><span data-i18n="jumpGuide"></span></span><span><kbd lang="en" dir="ltr">↓</kbd><span data-i18n="suction"></span></span><span><kbd lang="en" dir="ltr" data-i18n="shiftKey"></kbd><span data-i18n="airBoost"></span></span><span><kbd lang="en" dir="ltr">← / →</kbd><span data-i18n="turnWeapon"></span></span><span><kbd lang="en" dir="ltr">F</kbd><span data-i18n="fire"></span></span><span><kbd lang="en" dir="ltr">1–8</kbd><span data-i18n="selectWeapon"></span></span></div>
    <div class="touch-controls">
      <div class="touch-left"><button id="touch-fire" class="touch-button touch-fire" type="button"><span class="touch-glyph" aria-hidden="true">⌖</span><span data-i18n="fire"></span></button><div class="touch-left-bottom"><button id="touch-suction" class="touch-button touch-suction" type="button"><span class="touch-glyph" aria-hidden="true">↓</span><span data-i18n="suction"></span></button><button id="touch-aim" class="touch-button touch-aim" type="button"><span class="touch-glyph" aria-hidden="true">↔</span></button></div></div>
      <div class="touch-right"><button id="touch-boost" class="touch-button touch-boost" type="button"><span class="touch-glyph" aria-hidden="true">↗</span><span data-i18n="boost"></span></button><button id="touch-jump" class="touch-button touch-jump" type="button"><span class="touch-glyph" aria-hidden="true">↑</span><span data-i18n="jump"></span></button></div>
    </div>
    <div id="armory" class="armory" role="dialog" aria-modal="true" aria-labelledby="armory-title" hidden>
      <div class="armory-card">
        <div class="armory-heading"><div><span class="eyebrow" data-i18n="armory"></span><h2 id="armory-title" data-i18n="armoryTitle"></h2></div><button id="armory-close" class="armory-close" type="button" data-i18n="closeArmory"></button></div>
        <p class="armory-description" data-i18n="armoryDescription"></p>
        <p class="armory-help" data-i18n="armoryHelp"></p>
        <div class="weapon-grid">${WEAPONS.map((spec, index) => `<button id="equip-${spec.id}" class="weapon-card" type="button" aria-pressed="false">
          <span class="weapon-card-index" dir="ltr">0${index + 1}</span>${weaponIcon(spec.id)}
          <strong data-i18n="weapon${index}"></strong><small class="weapon-english" lang="en" dir="ltr">${spec.name}</small>
          <span class="weapon-power" aria-hidden="true">${Array.from({ length: 6 }, (_, dot) => `<i${dot < spec.power ? ' class="is-filled"' : ''}></i>`).join('')}</span>
          <span id="weapon-stats-${spec.id}" class="weapon-stats"></span><span id="weapon-unlock-${spec.id}" class="weapon-unlock"></span>
        </button>`).join('')}</div>
        <p class="armory-note" data-i18n="armoryAmmoNote"></p>
      </div>
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
        <footer class="app-credits">
          <a href="https://github.com/abelmiri" target="_blank" rel="noopener noreferrer" dir="ltr">© 2026 abelmiri</a>
          <a href="mailto:miri1888@gmail.com" dir="ltr">miri1888@gmail.com</a>
          <a href="/legal/index.html" target="_blank" rel="noopener noreferrer" data-i18n="legalCredits"></a>
        </footer>
      </div>
      <div class="overlay-side" aria-hidden="true"><span data-i18n="sideIndex"></span><span data-i18n="sideMotto"></span></div>
    </div>
    <div id="rotate-overlay" class="rotate-overlay"><div class="rotate-symbol" aria-hidden="true">▯</div><strong data-i18n="rotateTitle"></strong><p data-i18n="rotateDescription"></p></div>
    <div id="loading" class="loading"><span><span data-i18n="loading"></span><span class="loading-dots" aria-hidden="true">...</span></span></div>
  </div>
`;

const elementCache = new Map<string, HTMLElement>();
const element = <T extends HTMLElement>(id: string): T => {
  const result = elementCache.get(id) ?? document.getElementById(id);
  if (!result) throw new Error(`Missing #${id}`);
  elementCache.set(id, result);
  return result as T;
};

const sceneElement = element<HTMLDivElement>('scene');
const updateFps = import.meta.env.DEV ? (() => {
  const label = element('fps-counter');
  let previousFrame: number | undefined;
  let elapsed = 0;
  let frames = 0;
  return (now: number): void => {
    const duration = previousFrame === undefined ? 0 : now - previousFrame;
    previousFrame = now;
    if (duration <= 0 || duration > 1000 || document.hidden) {
      elapsed = frames = 0;
      return;
    }
    elapsed += duration;
    frames++;
    if (elapsed >= 500) {
      label.textContent = `${Math.round(frames * 1000 / elapsed)} FPS`;
      elapsed = frames = 0;
    }
  };
})() : undefined;
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
let progressStorage: Storage | undefined;
try { progressStorage = localStorage; } catch { /* Session-only XP if storage is unavailable. */ }
const experience = new ExperienceProgress(progressStorage);
const loadout = new WeaponLoadout(experience.total, progressStorage);
const armory = element('armory');
const armoryButton = element<HTMLButtonElement>('armory-button');
const armoryClose = element<HTMLButtonElement>('armory-close');
armory.hidden = true;
let resumeAfterArmory = false;
let displayedArmoryXp = -1;
const xpLevel = element('xp-level');
const xpTotal = element('xp-total');
const xpFill = element('xp-fill');
const xpMeter = element('xp-meter');
const xpToast = element('xp-toast');
const challengeHint = element('challenge-hint');
const pursuitGlow = element('pursuit-glow');
const impactFlash = element('impact-flash');
const healthPanel = element('health-panel');
const healthValue = element('health-value');
const healthFill = element('health-fill');
const healthTrail = element('health-trail');
const healthMeter = element('health-meter');
const hudFeedback = new HudFeedback({
  health: healthValue, healthPanel, air: boostValue, airPanel: element('boost-panel'), speed: speedLabel,
  xp: xpTotal, level: xpLevel, xpFill, distance: distanceLabel, best: bestLabel,
  ammo: element('weapon-ammo'), weaponPanel: element('weapon-panel'),
});
const impactPause = new ImpactPause();
const explosionSlowMotion = new ExplosionSlowMotion();
let lastImpactSerial = 0;
let lastExplosionSerial = 0;
let rewardTime = 0;
let lastReward = 0;
let lastRewardMessage: MessageKey = 'loopReward';

let status: GameStatus = 'loading';
let physics: GamePhysics;
let visuals: GameVisuals;
let accumulator = 0;
let holdInterpolation = false;
let lastFrame = performance.now();
let restartAvailableAt = 0;
let jumpQueued = false;
let currentDistrict = 0;
const warnedChallenges = new Set<string>();
let failureKey: 'bootError' | 'runtimeError' | null = null;
const held = { jump: new Set<string>(), suction: new Set<string>(), boost: new Set<string>(), fire: new Set<string>() };
let aimDirection: AimDirection = 1;
let best = 0;
try { best = Number(localStorage.getItem('roadster-best') || 0) || 0; } catch { /* Storage may be disabled. */ }

const formatDistance = (meters: number): string => `${formatNumber(meters, 4)} <small>${t('meter')}</small>`;
const districtKeys: MessageKey[] = ['districtMorning', 'districtDowntown', 'districtNight'];
const weaponName = (id: string): string => t(`weapon${WEAPONS.findIndex(spec => spec.id === id)}` as MessageKey);

function refreshArmory(): void {
  displayedArmoryXp = experience.total;
  for (const spec of WEAPONS) {
    const button = element<HTMLButtonElement>(`equip-${spec.id}`);
    const unlocked = experience.total >= spec.xp;
    const selected = loadout.selected === spec.id;
    button.disabled = !unlocked;
    button.classList.toggle('is-locked', !unlocked);
    button.classList.toggle('is-equipped', selected);
    button.setAttribute('aria-pressed', String(selected));
    element(`weapon-stats-${spec.id}`).textContent = `${t('ammo')}: ${formatNumber(physics?.weaponAmmo(spec.id) ?? spec.ammo)} · ${t('turnTime', { ms: formatNumber(spec.turnSeconds * 1000) })}`;
    element(`weapon-unlock-${spec.id}`).textContent = unlocked ? t(selected ? 'equipped' : 'equip') : t('unlockAt', { xp: formatNumber(spec.xp) });
    button.setAttribute('aria-label', `${weaponName(spec.id)} · ${t('power')} ${formatNumber(spec.power)} / ${formatNumber(6)} · ${element(`weapon-unlock-${spec.id}`).textContent}`);
  }
}

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

function textIfChanged(node: HTMLElement, value: string): void { if (node.textContent !== value) node.textContent = value; }
function htmlIfChanged(node: HTMLElement, value: string): void { if (node.innerHTML !== value) node.innerHTML = value; }
function fillIfChanged(node: HTMLElement, value: number): void {
  const transform = `scaleX(${Math.max(0, Math.min(1, value))})`;
  if (node.style.transform !== transform) node.style.transform = transform;
}
function attributeIfChanged(node: HTMLElement, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function updateHud(snapshot?: GameSnapshot): void {
  const charge = snapshot?.boost ?? 1;
  const health = snapshot?.health ?? MAX_HEALTH;
  const weapon = snapshot?.weapon;
  const spec = weaponSpec(weapon?.id ?? loadout.selected);
  const ammo = weapon?.ammo ?? spec.ammo;
  const speed = hudFeedback.update({ health, boost: Math.round(charge * 100),
    speed: Math.max(0, snapshot?.speed ?? 0) * 3.6, xp: experience.total, level: experience.level,
    progress: experience.levelProgress / LEVEL_XP, distance: snapshot?.distance ?? 0, best,
    ammo, capacity: spec.ammo, weapon: spec.id }, performance.now(), status === 'running' || status === 'crashed');
  htmlIfChanged(distanceLabel, formatDistance(snapshot?.distance ?? 0));
  htmlIfChanged(bestLabel, formatDistance(best));
  const percentage = Math.round(charge * 100);
  fillIfChanged(boostFill, charge);
  textIfChanged(boostValue, formatPercent(charge));
  attributeIfChanged(boostMeter, 'aria-valuenow', String(percentage));
  attributeIfChanged(boostMeter, 'aria-label', t('boostReserve'));
  attributeIfChanged(boostMeter, 'aria-valuetext', t('boostMeter', { charge: formatPercent(charge) }));
  fillIfChanged(healthFill, health / MAX_HEALTH);
  fillIfChanged(healthTrail, health / MAX_HEALTH);
  textIfChanged(healthValue, formatPercent(health / MAX_HEALTH));
  attributeIfChanged(healthMeter, 'aria-valuenow', String(health));
  attributeIfChanged(healthMeter, 'aria-label', t('health'));
  attributeIfChanged(healthMeter, 'aria-valuetext', t('healthMeter', { health: formatPercent(health / MAX_HEALTH) }));
  healthPanel.classList.toggle('is-low', health <= IMPACT_DAMAGE);
  impactFlash.style.opacity = String(status === 'running' && impactPause.active
    ? 0.55 * Math.sqrt(impactPause.remaining / IMPACT_PAUSE_SECONDS) : 0);
  textIfChanged(speedLabel, formatNumber(speed, 2));
  textIfChanged(districtLabel, t(districtKeys[currentDistrict]));
  textIfChanged(xpLevel, t('xpLevel', { level: formatNumber(experience.level) }));
  textIfChanged(xpTotal, `${formatNumber(experience.total)} XP`);
  fillIfChanged(xpFill, experience.levelProgress / LEVEL_XP);
  attributeIfChanged(xpMeter, 'aria-valuenow', String(experience.levelProgress));
  attributeIfChanged(xpMeter, 'aria-label', t('xpProgress', { xp: formatNumber(experience.levelProgress), target: formatNumber(LEVEL_XP) }));
  const rewardText = t(lastRewardMessage, { xp: formatNumber(lastReward) });
  if (xpToast.textContent !== rewardText) textIfChanged(xpToast, rewardText);
  const police = snapshot?.police;
  pursuitGlow.style.opacity = String(status === 'running' ? (police?.pressure ?? 0) * 0.7 : 0);
  pursuitGlow.classList.toggle('is-ahead', Boolean(police && police.gap < 0));
  const nextLoop = snapshot ? loopsBetween(snapshot.car.x, snapshot.car.x + 35)[0] : undefined;
  let hint = '';
  if (status === 'running') {
    if (impactPause.active) hint = t('impactNotice', { damage: formatPercent(IMPACT_DAMAGE / MAX_HEALTH) });
    else if (snapshot && snapshot.invincibilityRemaining > 0) hint = t('invincibleNotice');
    else if (snapshot?.loop) hint = t('loopHold');
    else if (police && police.visibility > 0.3 && Math.abs(police.gap) < 23) hint = t(police.gap < 0 ? 'policeAhead' : 'policeWarning');
    else if (nextLoop) hint = t('loopAhead');
  }
  // Keep live-region announcements stable instead of changing every frame.
  if (challengeHint.textContent !== hint) textIfChanged(challengeHint, hint);
  challengeHint.classList.toggle('is-visible', Boolean(hint));
  challengeHint.classList.toggle('is-danger', impactPause.active || Boolean(!snapshot?.loop && police && Math.abs(police.gap) < 14));
  xpToast.classList.toggle('is-visible', rewardTime > 0);
  xpToast.hidden = rewardTime <= 0;
  challengeHint.hidden = !hint;
  textIfChanged(element('weapon-name'), weaponName(spec.id));
  textIfChanged(element('weapon-ammo'), `${formatNumber(ammo)} / ${formatNumber(spec.ammo)}`);
  fillIfChanged(element('ammo-fill'), ammo / spec.ammo);
  attributeIfChanged(element('ammo-meter'), 'aria-valuemax', String(spec.ammo));
  attributeIfChanged(element('ammo-meter'), 'aria-valuenow', String(ammo));
  attributeIfChanged(element('ammo-meter'), 'aria-label', `${t('ammo')} · ${weaponName(spec.id)}`);
  textIfChanged(element('weapon-direction'), t(aimDirection === 1 ? 'aimFront' : 'aimBack'));
  const weaponStatus = t(!ammo ? 'ammoEmpty' : weapon && weapon.turnRemaining > .001 ? 'turning' : 'weaponReady');
  if (element('weapon-status').textContent !== weaponStatus) textIfChanged(element('weapon-status'), weaponStatus);
  element('weapon-status').classList.toggle('is-empty', ammo === 0);
  element('touch-fire').classList.toggle('is-empty', ammo === 0);
  if (!armory.hidden && displayedArmoryXp !== experience.total) refreshArmory();
}

function setOverlay(mode: 'ready' | 'paused' | 'crashed'): void {
  overlay.classList.add('is-visible');
  overlay.classList.toggle('is-game-over', mode === 'crashed');
  overlay.classList.toggle('is-compact', mode !== 'ready');
  controlsSummary.hidden = mode !== 'ready';
  const prefix = mode === 'ready' ? 'ready' : mode === 'paused' ? 'paused' : 'crashed';
  eyebrow.innerHTML = `<span class="eyebrow-line"></span>${t(mode === 'crashed' && physics.snapshot(1).health === 0 ? 'carDestroyed' : `${prefix}Eyebrow`)}`;
  title.innerHTML = t(`${prefix}Title`);
  description.textContent = mode === 'crashed'
    ? `${physics.snapshot(1).crashReason === 'police' ? t('policeCaught') + ' ' : ''}${t('crashedDescription', { distance: formatNumber(physics.distance), best: formatNumber(best) })} · ${t('runXp', { xp: formatNumber(physics.snapshot(1).runXp) })}`
    : t(mode === 'ready' ? 'readyDescription' : 'pausedDescription');
  primaryLabel.textContent = t(mode === 'ready' ? 'start' : mode === 'paused' ? 'resumeRun' : 'runAgain');
  overlayFoot.innerHTML = t(`${prefix}Foot`);
  updateRestartUi();
  updatePauseButton();
}

function updateRestartUi(now = performance.now()): void {
  const seconds = Math.max(0, Math.ceil((restartAvailableAt - now) / 1000));
  const locked = status === 'crashed' && seconds > 0;
  if (primaryButton.disabled !== locked) primaryButton.disabled = locked;
  if (status !== 'crashed') return;
  textIfChanged(primaryLabel, locked ? t('restartIn', { seconds: formatNumber(seconds) }) : t('runAgain'));
  htmlIfChanged(overlayFoot, locked ? '' : t('crashedFoot'));
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
  element('touch-fire').setAttribute('aria-label', t('fireLabel'));
  element('touch-aim').setAttribute('aria-label', t('turnWeapon'));
  element('weapon-aim').setAttribute('aria-label', t('turnWeapon'));
  element('weapon-aim').title = t('turnWeapon');
  armoryButton.setAttribute('aria-label', t('armory'));
  armoryButton.title = t('armory');
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
  refreshArmory();
}

function clearHeld(): void {
  Object.values(held).forEach((set) => set.clear());
  document.querySelectorAll('.touch-button').forEach((button) => button.classList.remove('is-pressed'));
}

function start(): void {
  if (status === 'loading' || status === 'error' || status === 'running') return;
  if (status === 'crashed' && performance.now() < restartAvailableAt) return;
  const resuming = status === 'paused';
  if (status === 'crashed') {
    restartAvailableAt = 0;
    primaryButton.disabled = false;
    physics.dispose();
    physics = new GamePhysics(7, { id: loadout.selected, xp: experience.total });
    audio.reset();
    accumulator = 0;
    holdInterpolation = false;
    jumpQueued = false;
    currentDistrict = 0;
    warnedChallenges.clear();
    experience.resetRun();
    rewardTime = 0;
    impactPause.reset();
    explosionSlowMotion.reset();
    lastImpactSerial = 0;
    lastExplosionSerial = 0;
    clearHeld();
    aimDirection = 1;
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
  restartAvailableAt = performance.now() + RESTART_DELAY_SECONDS * 1000;
  impactPause.reset();
  explosionSlowMotion.reset();
  accumulator = 0;
  holdInterpolation = false;
  clearHeld();
  // The final obstacle hit already played its impact sound before hit stop.
  if (physics.snapshot(1).health > 0) audio.play('crash');
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
bindTouch('touch-fire', 'fire');

function turnWeapon(direction: AimDirection = aimDirection === 1 ? -1 : 1): void {
  aimDirection = direction;
  updateHud(physics?.snapshot(Math.min(1, accumulator / FIXED_STEP)));
}
element('touch-aim').addEventListener('click', () => turnWeapon());
element('weapon-aim').addEventListener('click', () => { turnWeapon(); element('weapon-aim').blur(); });

function openArmory(): void {
  if (status === 'loading' || status === 'error') return;
  resumeAfterArmory = status === 'running';
  if (resumeAfterArmory) pause();
  clearHeld(); jumpQueued = false;
  armory.hidden = false;
  armoryButton.setAttribute('aria-expanded', 'true');
  refreshArmory();
  armoryClose.focus();
}
function closeArmory(): void {
  armory.hidden = true;
  armoryButton.setAttribute('aria-expanded', 'false');
  if (resumeAfterArmory && status === 'paused') start();
  else armoryButton.focus();
  resumeAfterArmory = false;
}
armoryButton.addEventListener('click', openArmory);
armoryClose.addEventListener('click', closeArmory);
function selectWeapon(index: number): void {
  const spec = WEAPONS[index];
  if (!physics || !spec || !loadout.select(spec.id, experience.total)) return;
  physics.equipWeapon(spec.id, experience.total);
  refreshArmory(); updateHud(physics.snapshot(1));
  void audio.unlock().then(() => audio.play('click'));
}
for (const [index, spec] of WEAPONS.entries()) {
  element(`equip-${spec.id}`).setAttribute('aria-keyshortcuts', String(index + 1));
  element(`equip-${spec.id}`).addEventListener('click', () => selectWeapon(index));
}

const actionForKey = (code: string): keyof typeof held | null => {
  if (['Space', 'ArrowUp', 'KeyW'].includes(code)) return 'jump';
  if (['ArrowDown', 'KeyS'].includes(code)) return 'suction';
  if (['ShiftLeft', 'ShiftRight', 'KeyX'].includes(code)) return 'boost';
  if (code === 'KeyF') return 'fire';
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
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLElement &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
  const slot = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
  const keySlot = event.key?.length === 1 ? Math.max('12345678'.indexOf(event.key),
    '۱۲۳۴۵۶۷۸'.indexOf(event.key), '١٢٣٤٥٦٧٨'.indexOf(event.key)) : -1;
  const weaponSlot = slot ? Number(slot[1]) - 1 : keySlot;
  if (weaponSlot >= 0) {
    event.preventDefault();
    if (!event.repeat) selectWeapon(weaponSlot);
    return;
  }
  if (!armory.hidden) {
    if (event.code === 'Escape') { event.preventDefault(); closeArmory(); }
    if (event.code === 'Tab') {
      const buttons = [...armory.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = buttons[0]; const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    return;
  }
  if (event.target instanceof HTMLElement && ['BUTTON', 'INPUT', 'SELECT'].includes(event.target.tagName) &&
      (event.code === 'Space' || event.code === 'Enter')) return;
  const action = actionForKey(event.code);
  if (action) {
    event.preventDefault();
    if (event.repeat) return;
    void audio.unlock();
    if (action === 'jump') jumpDown(`key-${event.code}`);
    else held[action].add(`key-${event.code}`);
  } else if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyQ'].includes(event.code)) {
    event.preventDefault();
    if (!event.repeat) turnWeapon(['ArrowLeft', 'KeyA'].includes(event.code) ? -1 : ['ArrowRight', 'KeyD'].includes(event.code) ? 1 : undefined);
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
  updateFps?.(now);
  const wallDelta = Math.max(0, (now - lastFrame) / 1000);
  const delta = Math.min(wallDelta, 0.06);
  lastFrame = now;
  let playDelta = 0;
  if (status === 'running') {
    playDelta = Math.min(impactPause.consume(wallDelta), explosionSlowMotion.consume(wallDelta), 0.06);
    if (physics.crashed) crash();
  }
  if (status === 'running' && playDelta > 0) {
    accumulator = Math.min(accumulator + playDelta, 0.15);
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 10) {
      const controls: Controls = {
        jumpPressed: jumpQueued,
        jumpHeld: held.jump.size > 0,
        suction: held.suction.size > 0,
        boost: held.boost.size > 0,
        fire: held.fire.size > 0,
        aim: aimDirection,
      };
      physics.step(controls);
      holdInterpolation = false;
      jumpQueued = false;
      accumulator -= FIXED_STEP;
      steps++;
      const impacted = physics.impactSerial > lastImpactSerial;
      const exploded = physics.explosionSerial > lastExplosionSerial;
      if (impacted) {
        lastImpactSerial = physics.impactSerial;
        audio.play('impact');
      }
      if (exploded) {
        lastExplosionSerial = physics.explosionSerial;
        audio.play('explosion');
      }
      // A fatal hit shows the menu immediately and starts the loose wreck;
      // it must not inherit hit stop or explosion slow motion from the living car.
      if (physics.crashed) { crash(); break; }
      if (exploded) explosionSlowMotion.start();
      if (impacted) {
        impactPause.start();
        accumulator = 0;
        holdInterpolation = true;
        break;
      }
    }
  }

  if (status === 'crashed') {
    updateRestartUi();
    accumulator = Math.min(accumulator + delta * WRECK_TIME_SCALE, 0.15);
    while (accumulator >= FIXED_STEP) {
      physics.stepWreck();
      accumulator -= FIXED_STEP;
    }
  }
  const frozen = impactPause.active;
  const snapshot = physics.snapshot(frozen || holdInterpolation ? 1 : Math.min(1, accumulator / FIXED_STEP));
  const simulating = status === 'running' && !frozen;
  const gained = experience.collect(snapshot.loopCompletions, snapshot.obstaclesDestroyed, snapshot.policeDestroyed);
  if (gained) {
    lastReward = gained;
    lastRewardMessage = ({ loop: 'loopReward', obstacle: 'obstacleReward', police: 'policeReward', mixed: 'xpReward' } as const)[experience.lastRewardKind];
    rewardTime = 3;
    audio.play('record');
  } else if (simulating) rewardTime = Math.max(0, rewardTime - playDelta);
  const sceneDelta = status === 'crashed' ? delta * WRECK_TIME_SCALE : status === 'running' ? playDelta : delta;
  const cameraDelta = status === 'running' || status === 'crashed' ? wallDelta : 0;
  visuals.render(snapshot, physics, sceneDelta,
    simulating || status === 'crashed', frozen, cameraDelta);
  audio.update(snapshot, simulating);
  if (simulating) {
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
  if (district !== currentDistrict && simulating) audio.play('district');
  currentDistrict = district;
  updateHud(snapshot);
  document.body.classList.toggle('fans-on', snapshot.suctionActive);
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  try {
    await RAPIER.init();
    physics = new GamePhysics(7, { id: loadout.selected, xp: experience.total });
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
