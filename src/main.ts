import RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_STEP, GamePhysics, type Controls, type GameSnapshot } from './game/physics';
import { GameVisuals } from './game/visuals';
import { GameAudio } from './game/audio';
import { HudFeedback } from './game/hudFeedback';
import { ExperienceProgress, LEVEL_XP } from './game/experience';
import { PlayerProgress } from './game/playerProgress';
import { CAR_UPGRADE_IDS, MAX_CAR_UPGRADE, carUpgradeCost, carUpgradeRequiredLevel, carUpgradeStats, type CarUpgradeId } from './game/carUpgrades';
import { DISTANCE_COIN_REWARDS, FINAL_DISTANCE_REWARD, distanceCoinProgress } from './game/coinRewards';
import { carGarageIcon } from './game/carGarageIcon';
import { loopsBetween } from './game/track';
import { ImpactPause, IMPACT_DAMAGE, IMPACT_PAUSE_SECONDS, ExplosionSlowMotion, RESTART_DELAY_SECONDS, WRECK_TIME_SCALE } from './game/damage';
import { WeaponLoadout, WEAPONS, MAX_WEAPON_UPGRADE, weaponSpec, weaponUpgradeCost, type AimDirection } from './game/weapons';
import { weaponIcon } from './game/weaponIcon';
import { formatNumber, formatDecimal, formatPercent, getLanguage, setLanguage, t, type MessageKey } from './i18n';
import { TouchLayoutEditor } from './touchLayout';
import { touchIcon } from './touchIcons';
import './styles.css';
import './hud.css';
import './touchLayout.css';
import './progress.css';
import './coins.css';
import './mobile.css';

type GameStatus = 'loading' | 'ready' | 'running' | 'paused' | 'crashed' | 'error';
const carUpgradeNames: Record<CarUpgradeId, MessageKey> = { armor:'carArmor', 'boost-reserve':'carBoostReserve', 'boost-power':'carBoostPower' };

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
          <div class="hud-stat"><span id="distance-title" class="hud-label" data-i18n="distance"></span><strong id="distance"></strong></div>
          <div class="hud-divider"></div>
          <div class="hud-stat"><span class="hud-label" data-i18n="best"></span><strong id="best"></strong><small id="best-player" class="best-player"></small></div>
          <button id="pause-button" class="icon-button" type="button"><span class="pause-icon" aria-hidden="true"></span></button>
        </div>
        <div class="settings-controls">
          <button id="touch-layout-button" class="icon-button touch-layout-button" type="button" aria-controls="touch-layout-editor" aria-expanded="false"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg></button>
          <button id="armory-button" class="icon-button armory-button" type="button" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h9v7H4zM13 10h8v3h-8M7 15v4m-4 0h12M6 6h5"/></svg></button>
          <button id="sound-button" class="icon-button sound-button" type="button" aria-pressed="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4Z"/><path class="sound-waves" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-slash" d="m15 9 6 6m0-6-6 6"/></svg>
          </button>
          <button id="language-button" class="language-button" type="button"><span id="language-en" lang="en" dir="ltr">EN</span><span class="language-separator" aria-hidden="true">/</span><span id="language-fa" lang="fa" dir="rtl">فارسی</span></button>
        </div>
      </div>
    </header>
    <div id="distance-rewards" class="distance-rewards">
      <div class="distance-reward-heading"><span id="distance-reward-next"></span><strong id="distance-reward-earned"></strong></div>
      <div id="distance-reward-meter" class="distance-reward-track" role="progressbar" aria-valuemin="0" aria-valuemax="${FINAL_DISTANCE_REWARD}"><span id="distance-reward-fill"></span>${DISTANCE_COIN_REWARDS.map((reward,index)=>`<i id="distance-reward-mark-${index}" class="distance-reward-mark" style="left:${reward.distance/FINAL_DISTANCE_REWARD*100}%" aria-hidden="true"></i>`).join('')}</div>
    </div>
    <div class="district-tag"><span class="district-dot"></span><span id="district"></span></div>
    <div id="pursuit-glow" class="pursuit-glow" aria-hidden="true"></div>
    <div id="impact-flash" class="impact-flash" aria-hidden="true"></div>
    <div id="challenge-hint" class="challenge-hint" role="status"></div>
    <div id="xp-toast" class="xp-toast" role="status"></div>
    <div id="coin-toast" class="coin-toast" role="status" hidden></div>
    <div id="weapon-panel" class="weapon-panel">
      <div class="weapon-heading"><span id="weapon-name"></span><strong id="weapon-ammo" dir="ltr"></strong></div>
      <div id="ammo-meter" class="ammo-track" role="progressbar" aria-valuemin="0"><span id="ammo-fill"></span></div>
      <div class="weapon-status-row"><button id="weapon-aim" class="aim-button" type="button"><span id="weapon-direction"></span><kbd lang="en" dir="ltr">Q</kbd></button><span id="weapon-status" role="status"></span></div>
    </div>
    <div class="bottom-hud">
      <div class="progress-stack">
      <div class="resources-panel">
        <div id="health-panel" class="health-panel"><div class="boost-heading"><span data-i18n="health"></span><span id="health-value"></span></div><div id="health-meter" class="health-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div id="health-trail" class="health-trail" aria-hidden="true"></div><div id="health-fill" class="health-fill"></div></div></div>
        <div id="boost-panel" class="boost-panel"><div class="boost-heading"><span data-i18n="boostReserve"></span><span id="boost-value"></span></div><div id="boost-meter" class="boost-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div id="boost-fill" class="boost-fill"></div></div></div>
      </div>
      <div class="experience-panel"><div><span id="xp-level"></span><strong id="xp-total"></strong></div><div id="xp-meter" class="xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span id="xp-fill"></span></div><button id="coin-wallet-button" class="coin-wallet" type="button" aria-haspopup="dialog" aria-controls="coin-dialog" aria-expanded="false"><span class="coin-symbol" aria-hidden="true">●</span><span data-i18n="coins"></span><strong id="coin-total"></strong></button></div>
      </div>
      <div class="speed-panel"><span data-i18n="speed"></span><strong id="speed"></strong><small data-i18n="speedUnit"></small></div>
    </div>
    <div class="keyboard-guide" aria-hidden="true"><span><kbd lang="en" dir="ltr" data-i18n="spaceKey"></kbd><span data-i18n="jumpGuide"></span></span><span><kbd lang="en" dir="ltr">↓</kbd><span data-i18n="suction"></span></span><span><kbd lang="en" dir="ltr" data-i18n="shiftKey"></kbd><span data-i18n="airBoost"></span></span><span><kbd lang="en" dir="ltr">← / →</kbd><span data-i18n="turnWeapon"></span></span><span><kbd lang="en" dir="ltr">F</kbd><span data-i18n="fire"></span></span><span><kbd lang="en" dir="ltr">1–8</kbd><span data-i18n="selectWeapon"></span></span><span><kbd lang="en" dir="ltr">G</kbd><span data-i18n="armory"></span></span><span><kbd lang="en" dir="ltr">Z / X</kbd><span data-i18n="airJets"></span></span></div>
    <div id="touch-controls" class="touch-controls">
      <button id="touch-fire" class="touch-button touch-fire" type="button"><svg class="touch-meter" viewBox="0 0 100 100" aria-hidden="true"><circle class="touch-meter-track" cx="50" cy="50" r="46"/><circle id="touch-ammo-ring" class="touch-meter-fill" cx="50" cy="50" r="46" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></svg>${touchIcon('fire')}<span class="touch-meter-value" id="touch-ammo-value" aria-hidden="true"></span><span class="touch-meter-label" data-i18n="fire"></span></button>
      <button id="touch-suction" class="touch-button touch-suction" type="button">${touchIcon('suction')}<span data-i18n="suction"></span></button>
      <button id="touch-aim" class="touch-button touch-aim" type="button">${touchIcon('aim')}</button>
      <button id="touch-boost" class="touch-button touch-boost" type="button"><svg class="touch-meter" viewBox="0 0 100 100" aria-hidden="true"><circle class="touch-meter-track" cx="50" cy="50" r="46"/><circle id="touch-boost-ring" class="touch-meter-fill" cx="50" cy="50" r="46" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></svg>${touchIcon('boost')}<span class="touch-meter-value" id="touch-boost-value" aria-hidden="true"></span><span class="touch-meter-label" data-i18n="boost"></span></button>
      <button id="touch-front-jet" class="touch-button touch-front-jet" type="button">${touchIcon('front-jet')}<span data-i18n="frontJet"></span></button>
      <button id="touch-rear-jet" class="touch-button touch-rear-jet" type="button">${touchIcon('rear-jet')}<span data-i18n="rearJet"></span></button>
      <button id="touch-jump" class="touch-button touch-jump" type="button">${touchIcon('jump')}<span data-i18n="jump"></span></button>
    </div>
    <div id="touch-layout-editor" class="touch-layout-editor" role="region" aria-labelledby="touch-layout-title" hidden>
      <div class="touch-layout-heading"><strong id="touch-layout-title" data-i18n="touchLayout"></strong><span data-i18n="touchLayoutHelp"></span></div>
      <div class="touch-layout-options">
        <label><span data-i18n="touchControl"></span><select id="touch-layout-control"><option value="jump" data-i18n="jump"></option><option value="fire" data-i18n="fire"></option><option value="boost" data-i18n="boost"></option><option value="aim" data-i18n="touchAim"></option><option value="suction" data-i18n="suction"></option><option value="front-jet" data-i18n="frontJet"></option><option value="rear-jet" data-i18n="rearJet"></option></select></label>
        <label class="touch-layout-sizing"><span data-i18n="touchSize"></span><input id="touch-layout-size" type="range" min="44" max="128" step="1" /><output id="touch-layout-size-value" for="touch-layout-size"></output></label>
        <button id="touch-layout-visibility" class="touch-layout-visibility" type="button" aria-pressed="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="touch-visibility-slash" d="m3 3 18 18"/></svg><span id="touch-layout-visibility-status"></span></button>
        <button id="touch-layout-reset" type="button" data-i18n="touchLayoutReset"></button>
        <button id="touch-layout-cancel" type="button" data-i18n="touchLayoutCancel"></button>
        <button id="touch-layout-save" class="touch-layout-save" type="button" data-i18n="touchLayoutSave"></button>
      </div>
    </div>
    <div id="armory" class="armory" role="dialog" aria-modal="true" aria-labelledby="armory-title" hidden>
      <div class="armory-card">
        <div class="armory-heading"><div><span class="eyebrow" data-i18n="armory"></span><h2 id="armory-title" data-i18n="armoryTitle"></h2></div><button id="armory-close" class="armory-close" type="button" data-i18n="closeArmory"></button></div>
        <div id="armory-tabs" class="armory-tabs" role="tablist">
          <button id="armory-tab-weapons" type="button" role="tab" aria-controls="weapons-pane" aria-selected="true" data-i18n="weaponsTab"></button>
          <button id="armory-tab-car" type="button" role="tab" aria-controls="car-pane" aria-selected="false" tabindex="-1" data-i18n="carTab"></button>
        </div>
        <button id="armory-wallet-button" class="armory-wallet" type="button" aria-haspopup="dialog" aria-controls="coin-dialog" aria-expanded="false"><span class="coin-symbol" aria-hidden="true">●</span><span data-i18n="coinBalance"></span><strong id="armory-coins"></strong><span class="coin-info-label" data-i18n="coinDetails"></span></button>
        <section id="weapons-pane" role="tabpanel" aria-labelledby="armory-tab-weapons">
        <p class="armory-description" data-i18n="armoryDescription"></p>
        <p class="armory-help" data-i18n="armoryHelp"></p>
        <p class="armory-coin-help" data-i18n="coinHelp"></p>
        <p class="armory-upgrade-help" data-i18n="weaponUpgradeHelp"></p>
        <div class="weapon-grid">${WEAPONS.map((spec, index) => `<div class="weapon-slot"><button id="equip-${spec.id}" class="weapon-card" type="button" aria-pressed="false">
          <span class="weapon-card-index" dir="ltr">0${index + 1}</span>${weaponIcon(spec.id)}
          <strong data-i18n="weapon${index}"></strong><small class="weapon-english" lang="en" dir="ltr">${spec.name}</small>
          <span class="weapon-power" aria-hidden="true">${Array.from({ length: 6 }, (_, dot) => `<i${dot < spec.power ? ' class="is-filled"' : ''}></i>`).join('')}</span>
          <span id="weapon-stats-${spec.id}" class="weapon-stats"></span><span id="weapon-price-${spec.id}" class="weapon-price"></span><span id="weapon-unlock-${spec.id}" class="weapon-unlock"></span>
        </button><div id="weapon-upgrades-${spec.id}" class="weapon-upgrades" hidden>
          <div class="weapon-level-row"><span id="weapon-level-${spec.id}"></span><span class="upgrade-steps" aria-hidden="true">${Array.from({ length: MAX_WEAPON_UPGRADE }, (_, step) => `<i id="upgrade-step-${spec.id}-${step}"></i>`).join('')}</span></div>
          <p id="weapon-upgrade-preview-${spec.id}" class="weapon-upgrade-preview"></p>
          <button id="upgrade-${spec.id}" class="weapon-upgrade-button" type="button"></button>
        </div></div>`).join('')}</div>
        <p class="armory-note" data-i18n="armoryAmmoNote"></p>
        </section>
        <section id="car-pane" role="tabpanel" aria-labelledby="armory-tab-car" hidden>
          <div class="garage-vehicle"><div id="garage-car-preview" class="garage-car-preview" role="img">${carGarageIcon(0)}</div><h3 data-i18n="carName"></h3><p id="garage-car-summary"></p></div>
          <div class="car-upgrade-grid">${CAR_UPGRADE_IDS.map(id=>`<article class="car-upgrade-card">
            <h3 data-i18n="${carUpgradeNames[id]}"></h3><div class="weapon-level-row"><span id="car-level-${id}"></span><span class="upgrade-steps" aria-hidden="true">${Array.from({length:MAX_CAR_UPGRADE},(_,step)=>`<i id="car-upgrade-step-${id}-${step}"></i>`).join('')}</span></div>
            <p id="car-current-${id}" class="car-current-stats"></p><p id="car-next-${id}" class="car-next-stats"></p><p id="car-requirement-${id}" class="car-level-requirement"></p><button id="upgrade-car-${id}" class="weapon-upgrade-button" type="button"></button>
          </article>`).join('')}</div>
          <p class="garage-help" data-i18n="carUpgradeHelp"></p>
        </section>
      </div>
    </div>
    <div id="overlay" class="overlay is-visible">
      <div class="intro-grid" aria-hidden="true"></div>
      <div class="overlay-card">
        <span id="eyebrow" class="eyebrow"></span>
        <h1 id="overlay-title"></h1>
        <p id="overlay-description" class="overlay-description"></p>
        <div id="overlay-controls" class="control-summary"><div><span data-number="1"></span><strong data-i18n="jump"></strong><small data-i18n="jumpSummary"></small></div><div><span data-number="2"></span><strong data-i18n="suction"></strong><small data-i18n="suctionSummary"></small></div><div><span data-number="3"></span><strong data-i18n="boost"></strong><small data-i18n="boostSummary"></small></div></div>
        <button id="menu-wallet-button" class="menu-coin-wallet" type="button" aria-haspopup="dialog" aria-controls="coin-dialog" aria-expanded="false"><span class="coin-symbol" aria-hidden="true">●</span><span data-i18n="coinBalance"></span><strong id="menu-coins"></strong><span class="coin-info-label" data-i18n="coinDetails"></span></button>
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
    <div id="coin-dialog" class="coin-dialog" role="dialog" aria-modal="true" aria-labelledby="coin-dialog-title" hidden>
      <div class="coin-dialog-card">
        <div class="coin-dialog-heading"><div><span class="coin-eyebrow" data-i18n="coinGuideEyebrow"></span><h2 id="coin-dialog-title" data-i18n="coinGuideTitle"></h2></div><button id="coin-guide-close" class="armory-close" type="button" data-i18n="coinGuideClose"></button></div>
        <div class="coin-guide-hero"><p data-i18n="coinGuideIntro"></p><div class="coin-guide-balance"><span data-i18n="coinBalance"></span><strong id="coin-guide-balance"></strong><small data-i18n="coins"></small></div></div>
        <div id="coin-guide-tabs" class="armory-tabs" role="tablist"><button id="coin-tab-earn" type="button" role="tab" aria-controls="coin-earn-pane" aria-selected="true" data-i18n="coinEarnTab"></button><button id="coin-tab-buy" type="button" role="tab" aria-controls="coin-buy-pane" aria-selected="false" tabindex="-1" data-i18n="coinBuyTab"></button></div>
        <section id="coin-earn-pane" role="tabpanel" aria-labelledby="coin-tab-earn">
          <div class="coin-milestone-guide"><div class="coin-route-heading"><span class="coin-guide-symbol" aria-hidden="true">↗</span><div><h3 data-i18n="coinMilestoneTitle"></h3><p data-i18n="coinMilestoneDescription"></p></div></div><div class="coin-milestone-grid">${DISTANCE_COIN_REWARDS.map((_,index)=>`<div id="coin-milestone-${index}" class="coin-milestone"><span id="coin-milestone-distance-${index}"></span><strong id="coin-milestone-value-${index}"></strong><small id="coin-milestone-xp-${index}" class="coin-milestone-xp"></small></div>`).join('')}</div></div>
          <div class="coin-method-grid">${[
            ['↗','coinDrivingTitle','coinDrivingDescription'],['↻','coinLoopTitle','coinLoopDescription'],
            ['⌖','coinPoliceTitle','coinPoliceDescription'],['★','coinRecordTitle','coinRecordDescription'],
            ['⟳','coinFlipTitle','coinFlipDescription'],
          ].map(([symbol,heading,copy])=>`<article class="coin-method"><span class="coin-guide-symbol" aria-hidden="true">${symbol}</span><h3 data-i18n="${heading}"></h3><p data-i18n="${copy}"></p><p class="coin-method-mobile" data-i18n="${copy}Mobile"></p></article>`).join('')}</div>
          <p class="coin-guide-note" data-i18n="coinXpNote"></p>
        </section>
        <section id="coin-buy-pane" class="coin-buy-pane" role="tabpanel" aria-labelledby="coin-tab-buy" hidden><span class="coin-buy-symbol" aria-hidden="true">●</span><h3 id="coin-buy-unavailable" data-i18n="coinBuyUnavailable"></h3><p data-i18n="coinBuyDescription"></p><button id="coin-back-earn" class="coin-back-earn" type="button" data-i18n="coinBackEarn"></button></section>
      </div>
    </div>
    <div id="record-dialog" class="record-dialog" role="dialog" aria-modal="true" aria-labelledby="record-title" aria-describedby="record-description" hidden>
      <form id="record-form" class="record-card">
        <svg class="record-medal" viewBox="0 0 80 96" fill="none" aria-hidden="true"><path d="M20 5h17l12 36-16 7z" fill="#68b9ce"/><path d="M43 5h17L47 48l-16-7z" fill="#b1f3e2"/><circle cx="40" cy="59" r="29" fill="#edbd5f" stroke="#ffe5a1" stroke-width="4"/><path d="m40 40 5.5 11.5 12.5 2-9 8.8 2 12.7-11-6-11 6 2-12.7-9-8.8 12.5-2z" fill="#fff1c9"/></svg>
        <h2 id="record-title" data-i18n="newRecord"></h2>
        <strong id="record-distance" class="record-distance"></strong>
        <p id="record-bonus" class="record-bonus" hidden></p>
        <p id="record-description" data-i18n="recordDescription"></p>
        <label for="record-name" data-i18n="playerName"></label>
        <input id="record-name" type="text" name="playerName" autocomplete="nickname" maxlength="32" required aria-describedby="record-name-error" />
        <p id="record-name-error" class="record-name-error" role="alert" hidden data-i18n="recordNameRequired"></p>
        <button id="record-save" class="primary-button" type="submit" data-i18n="saveRecord"></button>
      </form>
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
try { progressStorage = localStorage; } catch { /* Keep the game playable when browser storage is unavailable. */ }
const experience = new ExperienceProgress(progressStorage);
const player = new PlayerProgress(progressStorage);
const loadout = new WeaponLoadout(experience.total, progressStorage, id => player.ownsWeapon(id));
const recordDialog = element('record-dialog');
const recordName = element<HTMLInputElement>('record-name');
const recordSave = element<HTMLButtonElement>('record-save');
recordDialog.hidden = true;
const coinDialog = element('coin-dialog');
const coinClose = element<HTMLButtonElement>('coin-guide-close');
const walletButtons = ['coin-wallet-button','armory-wallet-button','menu-wallet-button'].map(id=>element<HTMLButtonElement>(id));
coinDialog.hidden = true;
let coinTab: 'earn' | 'buy' = 'earn';
let resumeAfterCoins = false;
let coinOpener: HTMLButtonElement | null = null;
const armory = element('armory');
const armoryButton = element<HTMLButtonElement>('armory-button');
const armoryClose = element<HTMLButtonElement>('armory-close');
const touchLayoutButton = element<HTMLButtonElement>('touch-layout-button');
const touchLayout = new TouchLayoutEditor(element('touch-controls'), progressStorage);
let resumeAfterTouchLayout = false;
armory.hidden = true;
let resumeAfterArmory = false;
let displayedArmoryXp = -1;
let displayedArmoryCoins = -1;
let displayedMaxHealth = -1;
let armoryTab: 'weapons' | 'car' = 'weapons';
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
let coinRewardTime = 0;
let lastCoinReward = 0;
let recordBonus = 0;
let displayedDistanceMilestones = 0;
let distanceRewardHighlightUntil = 0;

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
const held = { jump: new Set<string>(), suction: new Set<string>(), boost: new Set<string>(), fire: new Set<string>(),
  frontJet: new Set<string>(), rearJet: new Set<string>() };
let aimDirection: AimDirection = 1;
let best = player.record.distance;

const formatDistance = (meters: number): string => `${formatNumber(meters, 4)} <small>${t('meter')}</small>`;
const districtKeys: MessageKey[] = ['districtMorning', 'districtDowntown', 'districtNight'];
const weaponName = (id: string): string => t(`weapon${WEAPONS.findIndex(spec => spec.id === id)}` as MessageKey);

function refreshArmory(): void {
  displayedArmoryXp = experience.total;
  displayedArmoryCoins = player.coins;
  element('armory-coins').textContent = formatNumber(player.coins);
  for (const spec of WEAPONS) {
    const level = player.weaponLevel(spec.id);
    const current = weaponSpec(spec.id, level);
    const button = element<HTMLButtonElement>(`equip-${spec.id}`);
    const unlocked = experience.total >= spec.xp;
    const owned = player.ownsWeapon(spec.id);
    const selected = loadout.selected === spec.id;
    button.disabled = !unlocked || (!owned && player.coins < spec.price);
    button.classList.toggle('is-locked', !unlocked || !owned);
    button.classList.toggle('is-equipped', selected);
    button.setAttribute('aria-pressed', String(selected));
    const combatStats = t('weaponCombatStats', { damage: formatDecimal(current.damage), rate: formatDecimal(1 / current.interval),
      ammo: formatNumber(physics?.weaponAmmo(spec.id) ?? current.ammo), capacity: formatNumber(current.ammo) });
    element(`weapon-stats-${spec.id}`).textContent = `${combatStats} · ${t('turnTime', { ms: formatNumber(spec.turnSeconds * 1000) })}`;
    element(`weapon-price-${spec.id}`).textContent = owned ? t('weaponOwned') : t('weaponPrice', { coins: formatNumber(spec.price) });
    element(`weapon-unlock-${spec.id}`).textContent = !unlocked ? t('unlockAt', { xp: formatNumber(spec.xp) })
      : owned ? t(selected ? 'equipped' : 'equip')
      : player.coins >= spec.price ? t('buyWeapon', { coins: formatNumber(spec.price) })
      : t('needCoins', { coins: formatNumber(spec.price - player.coins) });
    button.setAttribute('aria-label', `${weaponName(spec.id)} · ${combatStats} · ${element(`weapon-unlock-${spec.id}`).textContent}`);
    element(`weapon-upgrades-${spec.id}`).hidden = !owned;
    element(`weapon-level-${spec.id}`).textContent = t('weaponUpgradeLevel', { level: formatNumber(level), max: formatNumber(MAX_WEAPON_UPGRADE) });
    for (let step = 0; step < MAX_WEAPON_UPGRADE; step++) element(`upgrade-step-${spec.id}-${step}`).classList.toggle('is-filled', step < level);
    const cost = weaponUpgradeCost(spec.id, level);
    const upgrade = element<HTMLButtonElement>(`upgrade-${spec.id}`);
    upgrade.disabled = !owned || cost === null || player.coins < cost;
    upgrade.textContent = cost === null ? t('weaponUpgradeMax') : t('weaponUpgradeBuy', { level: formatNumber(level + 1), coins: formatNumber(cost) });
    upgrade.title = cost !== null && player.coins < cost ? t('needCoins', { coins: formatNumber(cost - player.coins) }) : upgrade.textContent;
    upgrade.setAttribute('aria-label', `${weaponName(spec.id)} · ${upgrade.textContent} · ${upgrade.title}`);
    const preview = element(`weapon-upgrade-preview-${spec.id}`);
    preview.hidden = cost === null;
    const next = weaponSpec(spec.id, level + 1);
    preview.textContent = t('weaponUpgradeNext', { damage: formatDecimal(next.damage), rate: formatDecimal(1 / next.interval), ammo: formatNumber(next.ammo) });
  }
  refreshGarage();
}

function refreshGarage(): void {
  const stats=carUpgradeStats(player.carUpgrades);
  htmlIfChanged(element('garage-car-preview'),carGarageIcon(stats.armor));
  element('garage-car-preview').setAttribute('aria-label',`${t('carName')} · ${t('carArmorStats',{health:formatNumber(stats.maxHealth),pieces:formatNumber(stats.armor)})}`);
  textIfChanged(element('garage-car-summary'),t('carArmorStats',{health:formatNumber(stats.maxHealth),pieces:formatNumber(stats.armor)}));
  for (const id of CAR_UPGRADE_IDS) {
    const level=player.carLevel(id);
    const next=carUpgradeStats({...player.carUpgrades,[id]:level+1});
    const describe=(value:typeof stats):string=>id==='armor' ? t('carArmorStats',{health:formatNumber(value.maxHealth),pieces:formatNumber(value.armor)})
      : id==='boost-reserve' ? t('carReserveStats',{seconds:formatDecimal(value.boostCapacity/.48)})
      : t('carPowerStats',{speed:formatDecimal(9*value.boostPower*3.6)});
    textIfChanged(element(`car-level-${id}`),t('weaponUpgradeLevel',{level:formatNumber(level),max:formatNumber(MAX_CAR_UPGRADE)}));
    for(let step=0;step<MAX_CAR_UPGRADE;step++) element(`car-upgrade-step-${id}-${step}`).classList.toggle('is-filled',step<level);
    textIfChanged(element(`car-current-${id}`),describe(stats));
    textIfChanged(element(`car-next-${id}`),t('carNextStats',{stats:describe(next)}));
    const cost=carUpgradeCost(id,level);
    const required=carUpgradeRequiredLevel(id,level);
    const eligible=required!==null&&experience.level>=required;
    const requirement=element(`car-requirement-${id}`);
    requirement.hidden=required===null;
    requirement.textContent=t('carLevelRequired',{level:formatNumber(required??0),current:formatNumber(experience.level)});
    requirement.classList.toggle('is-met',eligible);
    element(`car-next-${id}`).hidden=cost===null;
    const button=element<HTMLButtonElement>(`upgrade-car-${id}`);
    button.disabled=cost===null||!eligible||player.coins<cost;
    button.textContent=cost===null?t('weaponUpgradeMax'):t('weaponUpgradeBuy',{level:formatNumber(level+1),coins:formatNumber(cost)});
    button.title=required!==null&&!eligible?requirement.textContent:cost!==null&&player.coins<cost?t('needCoins',{coins:formatNumber(cost-player.coins)}):button.textContent;
    button.setAttribute('aria-label',`${t(carUpgradeNames[id])} · ${button.textContent} · ${button.title}`);
  }
  textIfChanged(element('armory-title'),t(armoryTab==='car'?'garageTitle':'armoryTitle'));
}

function setArmoryTab(tab:'weapons'|'car',focus=false):void {
  armoryTab=tab;
  for(const name of ['weapons','car'] as const) {
    const active=name===tab;
    const button=element<HTMLButtonElement>(`armory-tab-${name}`);
    button.setAttribute('aria-selected',String(active)); button.tabIndex=active?0:-1;
    element(name==='weapons'?'weapons-pane':'car-pane').hidden=!active;
  }
  refreshArmory();
  if(focus) element(`armory-tab-${tab}`).focus();
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

function updateDistanceRewards(distance: number): void {
  const progress=distanceCoinProgress(distance);
  const reached=DISTANCE_COIN_REWARDS.filter(reward=>progress.distance>=reward.distance).length;
  if(reached<displayedDistanceMilestones) distanceRewardHighlightUntil=0;
  else if(reached>displayedDistanceMilestones) distanceRewardHighlightUntil=performance.now()+1800;
  displayedDistanceMilestones=reached;
  element('distance-rewards').classList.toggle('is-celebrating',performance.now()<distanceRewardHighlightUntil);
  const label=progress.next?t('distanceRewardNext',{distance:formatNumber(progress.next.distance),coins:formatNumber(progress.next.coins),xp:formatNumber(progress.next.xp)}):t('distanceRewardComplete');
  textIfChanged(element('distance-reward-next'),label);
  textIfChanged(element('distance-reward-earned'),t('distanceRewardEarned',{coins:formatNumber(player.runCoins),xp:formatNumber(experience.runXp)}));
  fillIfChanged(element('distance-reward-fill'),progress.fraction);
  const meter=element('distance-reward-meter');
  attributeIfChanged(meter,'aria-label',t('distanceRewardTitle'));
  attributeIfChanged(meter,'aria-valuenow',String(Math.min(FINAL_DISTANCE_REWARD,progress.distance)));
  attributeIfChanged(meter,'aria-valuetext',`${formatNumber(progress.distance)} ${t('meter')} · ${label}`);
  for(const [index,reward] of DISTANCE_COIN_REWARDS.entries()) element(`distance-reward-mark-${index}`).classList.toggle('is-reached',progress.distance>=reward.distance);
}

function updateHud(snapshot?: GameSnapshot): void {
  const showingLastScore = (status === 'ready' || status === 'loading') && player.score > 0;
  const charge = snapshot?.boost ?? 1;
  const maxHealth = snapshot?.maxHealth ?? carUpgradeStats(player.carUpgrades).maxHealth;
  const health = snapshot?.health ?? maxHealth;
  const weapon = snapshot?.weapon;
  const id = weapon?.id ?? loadout.selected;
  const spec = weaponSpec(id, weapon?.level ?? player.weaponLevel(id));
  const ammo = weapon?.ammo ?? spec.ammo;
  const speed = hudFeedback.update({ health, boost: Math.round(charge * 100),
    speed: Math.max(0, snapshot?.speed ?? 0) * 3.6, xp: experience.total, level: experience.level,
    progress: experience.levelProgress / LEVEL_XP, distance: snapshot?.distance ?? 0, best,
    ammo, capacity: spec.ammo, weapon: spec.id }, performance.now(), status === 'running' || status === 'crashed');
  htmlIfChanged(distanceLabel, formatDistance(status === 'ready' || status === 'loading' ? player.score : snapshot?.distance ?? 0));
  textIfChanged(element('distance-title'), t(showingLastScore ? 'lastScore' : 'distance'));
  htmlIfChanged(bestLabel, formatDistance(best));
  textIfChanged(element('best-player'), player.record.name);
  element('best-player').hidden = !player.record.name;
  attributeIfChanged(element('best-player'), 'title', player.record.name);
  textIfChanged(element('coin-total'), formatNumber(player.coins));
  textIfChanged(element('menu-coins'), formatNumber(player.coins));
  textIfChanged(element('coin-guide-balance'), formatNumber(player.coins));
  for(const button of walletButtons) attributeIfChanged(button,'aria-label',`${t('coinDetails')} · ${t('coinBalance')}: ${formatNumber(player.coins)}`);
  updateDistanceRewards(snapshot?.distance??0);
  textIfChanged(element('coin-toast'), t('coinReward', { coins: formatNumber(lastCoinReward) }));
  element('coin-toast').hidden = coinRewardTime <= 0;
  const percentage = Math.round(charge * 100);
  fillIfChanged(boostFill, charge);
  textIfChanged(boostValue, formatPercent(charge));
  textIfChanged(element('touch-boost-value'), formatPercent(charge));
  attributeIfChanged(element('touch-boost-ring'), 'stroke-dashoffset', String((1 - charge) * 100));
  attributeIfChanged(element('touch-boost'), 'aria-label', `${t('boost')} · ${t('boostMeter', { charge: formatPercent(charge) })}`);
  attributeIfChanged(boostMeter, 'aria-valuenow', String(percentage));
  attributeIfChanged(boostMeter, 'aria-label', t('boostReserve'));
  attributeIfChanged(boostMeter, 'aria-valuetext', t('boostMeter', { charge: formatPercent(charge) }));
  fillIfChanged(healthFill, health / maxHealth);
  fillIfChanged(healthTrail, health / maxHealth);
  textIfChanged(healthValue, formatPercent(health / maxHealth));
  attributeIfChanged(healthMeter, 'aria-valuemax', String(maxHealth));
  if(displayedMaxHealth!==maxHealth) {
    healthMeter.style.setProperty('--health-segment',`${IMPACT_DAMAGE/maxHealth*100}%`);
    displayedMaxHealth=maxHealth;
  }
  attributeIfChanged(healthMeter, 'aria-valuenow', String(health));
  attributeIfChanged(healthMeter, 'aria-label', t('health'));
  attributeIfChanged(healthMeter, 'aria-valuetext', t('healthMeter', { health: formatPercent(health / maxHealth) }));
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
  textIfChanged(element('touch-ammo-value'), formatNumber(ammo));
  attributeIfChanged(element('touch-ammo-ring'), 'stroke-dashoffset', String((1 - ammo / spec.ammo) * 100));
  attributeIfChanged(element('touch-fire'), 'aria-label', `${t('fire')} · ${weaponName(spec.id)} · ${formatNumber(ammo)} / ${formatNumber(spec.ammo)}`);
  const rewardText = t(lastRewardMessage, { xp: formatNumber(lastReward) });
  if (xpToast.textContent !== rewardText) textIfChanged(xpToast, rewardText);
  const police = snapshot?.police;
  pursuitGlow.style.opacity = String(status === 'running' ? (police?.pressure ?? 0) * 0.7 : 0);
  pursuitGlow.classList.toggle('is-ahead', Boolean(police && police.gap < 0));
  const nextLoop = snapshot ? loopsBetween(snapshot.car.x, snapshot.car.x + 35)[0] : undefined;
  let hint = '';
  if (status === 'running') {
    if (impactPause.active) hint = t('impactNotice', { damage: formatPercent(IMPACT_DAMAGE / maxHealth) });
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
  if (!armory.hidden && (displayedArmoryXp !== experience.total || displayedArmoryCoins !== player.coins)) refreshArmory();
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
    ? `${physics.snapshot(1).crashReason === 'police' ? t('policeCaught') + ' ' : ''}${t('crashedDescription', { distance: formatNumber(physics.distance), best: formatNumber(best) })} · ${t('runXp', { xp: formatNumber(experience.runXp) })} · ${t('runCoins', { coins: formatNumber(player.runCoins) })}`
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
  element('touch-front-jet').setAttribute('aria-label', t('frontJetLabel'));
  element('touch-rear-jet').setAttribute('aria-label', t('rearJetLabel'));
  element('touch-fire').setAttribute('aria-label', t('fireLabel'));
  element('touch-aim').setAttribute('aria-label', t('turnWeapon'));
  element('weapon-aim').setAttribute('aria-label', t('turnWeapon'));
  element('weapon-aim').title = t('turnWeapon');
  armoryButton.setAttribute('aria-label', t('armory'));
  element('armory-tabs').setAttribute('aria-label',t('garageTitle'));
  element('coin-guide-tabs').setAttribute('aria-label',t('coinGuideTitle'));
  for(const button of walletButtons) button.setAttribute('aria-label',t('coinDetails'));
  for(const [index,reward] of DISTANCE_COIN_REWARDS.entries()) {
    element(`coin-milestone-distance-${index}`).textContent=`${formatNumber(reward.distance)} ${t('meter')}`;
    element(`coin-milestone-value-${index}`).textContent=t('coinReward',{coins:formatNumber(reward.coins)});
    element(`coin-milestone-xp-${index}`).textContent=t('distanceXpReward',{xp:formatNumber(reward.xp)});
  }
  armoryButton.title = `${t('armory')} (G)`;
  armoryButton.setAttribute('aria-keyshortcuts', 'G');
  touchLayoutButton.setAttribute('aria-label', t('touchLayout'));
  touchLayoutButton.title = t('touchLayout');
  touchLayout.updateLanguage();
  updateRecordDialog();
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
  if (touchLayout.editing || !armory.hidden || !recordDialog.hidden || !coinDialog.hidden) return;
  if (status === 'loading' || status === 'error' || status === 'running') return;
  if (status === 'crashed' && performance.now() < restartAvailableAt) return;
  const resuming = status === 'paused';
  if (status === 'ready') player.resetRun();
  if (status === 'crashed') {
    restartAvailableAt = 0;
    primaryButton.disabled = false;
    physics.dispose();
    physics = new GamePhysics(7, { id: loadout.selected, xp: experience.total, upgrades: player.weaponUpgrades, carUpgrades: player.carUpgrades });
    audio.reset();
    accumulator = 0;
    holdInterpolation = false;
    jumpQueued = false;
    currentDistrict = 0;
    warnedChallenges.clear();
    experience.resetRun();
    player.resetRun();
    rewardTime = 0;
    coinRewardTime = 0;
    recordBonus = 0;
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
  updateHud(physics.snapshot(1));
  void audio.unlock().then(() => audio.play(resuming ? 'resume' : 'start'));
}

function saveRunScore(): void {
  if (status !== 'ready' && status !== 'loading' && status !== 'error') {
    player.trackScore(physics.distance, performance.now());
  }
  player.flushScore();
}

function pause(): void {
  saveRunScore();
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
  const snapshot = physics.snapshot(1);
  awardCoins(player.collect(snapshot.distance, snapshot.loopCompletions, snapshot.policeDestroyed, snapshot.flipCoins));
  awardExperience(snapshot);
  experience.finishRun();
  const result = player.finishRun(physics.distance);
  if (result.newRecord) {
    best = player.record.distance;
    recordBonus = result.bonus;
    bestLabel.innerHTML = formatDistance(best);
    audio.play('record');
  }
  setOverlay('crashed');
  if (result.newRecord) openRecordDialog();
}

function awardCoins(gained: number): void {
  if (!gained) return;
  lastCoinReward = gained;
  coinRewardTime = 3;
}

function awardExperience(snapshot: GameSnapshot): number {
  const gained = experience.collect(snapshot.loopCompletions, snapshot.obstaclesDestroyed, snapshot.policeDestroyed, snapshot.distance);
  if (gained) {
    lastReward = gained;
    lastRewardMessage = ({ loop: 'loopReward', obstacle: 'obstacleReward', police: 'policeReward', distance: 'distanceXpRewardNotice', mixed: 'xpReward' } as const)[experience.lastRewardKind];
    rewardTime = 3;
    audio.play('record');
  }
  return gained;
}

function updateRecordDialog(): void {
  textIfChanged(element('record-distance'), `${formatNumber(player.record.distance)} ${t('meter')}`);
  textIfChanged(element('record-bonus'), t('recordCoinBonus', { coins: formatNumber(recordBonus) }));
  element('record-bonus').hidden = recordBonus <= 0;
}

function openRecordDialog(): void {
  clearHeld(); jumpQueued = false;
  recordDialog.hidden = false;
  recordName.value = player.playerName;
  element('record-name-error').hidden = true;
  document.querySelector('.game-shell')?.classList.add('is-naming-record');
  updateRecordDialog();
  recordName.focus();
}
element('record-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!player.nameRecord(recordName.value)) {
    element('record-name-error').hidden = false;
    recordName.focus();
    return;
  }
  recordDialog.hidden = true;
  document.querySelector('.game-shell')?.classList.remove('is-naming-record');
  updateHud(physics?.snapshot(1));
  primaryButton.focus();
});

function jumpDown(source: string): void {
  if (held.jump.has(source)) return;
  held.jump.add(source);
  if (status === 'ready' || status === 'crashed' || status === 'paused') {
    start();
    return;
  }
  if (status === 'running') jumpQueued = true;
}

function syncAirJetButtons(): void {
  element('touch-front-jet').classList.toggle('is-pressed', held.frontJet.size > 0);
  element('touch-rear-jet').classList.toggle('is-pressed', held.rearJet.size > 0);
}

function holdAction(action: keyof typeof held, source: string): void {
  if (action === 'frontJet') held.rearJet.clear();
  if (action === 'rearJet') held.frontJet.clear();
  held[action].add(source);
  if (action === 'frontJet' || action === 'rearJet') syncAirJetButtons();
}

function bindTouch(id: string, action: keyof typeof held): void {
  const button = element<HTMLButtonElement>(id);
  button.addEventListener('pointerdown', (event) => {
    if (button.hidden || touchLayout.editing || !armory.hidden || !recordDialog.hidden || !coinDialog.hidden) return;
    event.preventDefault();
    void audio.unlock();
    button.setPointerCapture(event.pointerId);
    button.classList.add('is-pressed');
    const source = `pointer-${event.pointerId}`;
    if (action === 'jump') jumpDown(source);
    else holdAction(action, source);
  });
  const release = (event: PointerEvent): void => {
    button.classList.remove('is-pressed');
    held[action].delete(`pointer-${event.pointerId}`);
    if (action === 'frontJet' || action === 'rearJet') syncAirJetButtons();
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

bindTouch('touch-jump', 'jump');
bindTouch('touch-suction', 'suction');
bindTouch('touch-boost', 'boost');
bindTouch('touch-front-jet', 'frontJet');
bindTouch('touch-rear-jet', 'rearJet');
bindTouch('touch-fire', 'fire');

function turnWeapon(direction: AimDirection = aimDirection === 1 ? -1 : 1): void {
  aimDirection = direction;
  updateHud(physics?.snapshot(Math.min(1, accumulator / FIXED_STEP)));
}
element('touch-aim').addEventListener('click', () => { if (!element('touch-aim').hidden && !touchLayout.editing && armory.hidden && recordDialog.hidden && coinDialog.hidden) turnWeapon(); });
element('weapon-aim').addEventListener('click', () => { turnWeapon(); element('weapon-aim').blur(); });

function openArmory(): void {
  if (status === 'loading' || status === 'error' || !armory.hidden || touchLayout.editing || !recordDialog.hidden || !coinDialog.hidden) return;
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

function setCoinTab(tab:'earn'|'buy',focus=false):void {
  coinTab=tab;
  for(const name of ['earn','buy'] as const) {
    const active=name===tab;
    const button=element<HTMLButtonElement>(`coin-tab-${name}`);
    button.setAttribute('aria-selected',String(active)); button.tabIndex=active?0:-1;
    element(`coin-${name}-pane`).hidden=!active;
  }
  if(focus) element(`coin-tab-${tab}`).focus();
}

function openCoinGuide(opener:HTMLButtonElement):void {
  if(status==='loading'||status==='error'||touchLayout.editing||!recordDialog.hidden||!coinDialog.hidden)return;
  resumeAfterCoins=status==='running';
  if(resumeAfterCoins)pause();
  clearHeld(); jumpQueued=false;
  coinOpener=opener;
  coinDialog.hidden=false;
  armory.inert=true; overlay.inert=true;
  for(const button of walletButtons)button.setAttribute('aria-expanded','true');
  setCoinTab('earn');
  textIfChanged(element('coin-guide-balance'),formatNumber(player.coins));
  coinClose.focus();
}

function closeCoinGuide():void {
  coinDialog.hidden=true;
  armory.inert=false; overlay.inert=false;
  for(const button of walletButtons)button.setAttribute('aria-expanded','false');
  clearHeld(); jumpQueued=false;
  if(resumeAfterCoins&&status==='paused')start();
  coinOpener?.focus(); coinOpener=null; resumeAfterCoins=false;
}
for(const button of walletButtons)button.addEventListener('click',()=>openCoinGuide(button));
coinClose.addEventListener('click',closeCoinGuide);
element('coin-back-earn').addEventListener('click',()=>setCoinTab('earn',true));
for(const tab of ['earn','buy'] as const) {
  element(`coin-tab-${tab}`).addEventListener('click',()=>setCoinTab(tab,true));
  element(`coin-tab-${tab}`).addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.code))return;
    event.preventDefault();
    setCoinTab(event.code==='Home'?'earn':event.code==='End'?'buy':tab==='earn'?'buy':'earn',true);
  });
}
for (const tab of ['weapons','car'] as const) {
  element(`armory-tab-${tab}`).addEventListener('click',()=>setArmoryTab(tab,true));
  element(`armory-tab-${tab}`).addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.code))return;
    event.preventDefault();
    setArmoryTab(event.code==='Home'?'weapons':event.code==='End'?'car':tab==='car'?'weapons':'car',true);
  });
}
for (const id of CAR_UPGRADE_IDS) element(`upgrade-car-${id}`).addEventListener('click',()=>{
  if(!physics||armory.hidden||armoryTab!=='car'||!recordDialog.hidden||touchLayout.editing||!coinDialog.hidden) return;
  if(player.upgradeCar(id,experience.level)!=='upgraded') return;
  physics.upgradeCar(player.carUpgrades);
  refreshArmory(); updateHud(physics.snapshot(1));
  if(element<HTMLButtonElement>(`upgrade-car-${id}`).disabled) element('armory-tab-car').focus();
  void audio.unlock().then(()=>audio.play('click'));
});
function openTouchLayout(): void {
  if (status === 'loading' || status === 'error' || !armory.hidden || touchLayout.editing || !recordDialog.hidden || !coinDialog.hidden) return;
  resumeAfterTouchLayout = status === 'running';
  if (resumeAfterTouchLayout) pause();
  clearHeld(); jumpQueued = false;
  document.querySelector('.game-shell')?.classList.add('is-editing-touch');
  touchLayoutButton.setAttribute('aria-expanded', 'true');
  touchLayout.begin();
}
function closeTouchLayout(save: boolean): void {
  touchLayout.finish(save);
  document.querySelector('.game-shell')?.classList.remove('is-editing-touch');
  touchLayoutButton.setAttribute('aria-expanded', 'false');
  clearHeld(); jumpQueued = false;
  if (resumeAfterTouchLayout && status === 'paused') start();
  touchLayoutButton.focus();
  resumeAfterTouchLayout = false;
}
touchLayoutButton.addEventListener('click', openTouchLayout);
element('touch-layout-save').addEventListener('click', () => closeTouchLayout(true));
element('touch-layout-cancel').addEventListener('click', () => closeTouchLayout(false));
element('touch-layout-reset').addEventListener('click', () => touchLayout.reset());
function selectWeapon(index: number, purchase = false): void {
  const spec = WEAPONS[index];
  if (!physics || !spec || !recordDialog.hidden || !coinDialog.hidden) return;
  if (!player.ownsWeapon(spec.id)) {
    if (!purchase || player.purchaseWeapon(spec.id, experience.total) !== 'purchased') return;
  }
  if (!loadout.select(spec.id, experience.total)) return;
  physics.equipWeapon(spec.id, experience.total);
  refreshArmory(); updateHud(physics.snapshot(1));
  void audio.unlock().then(() => audio.play('click'));
}
for (const [index, spec] of WEAPONS.entries()) {
  element(`equip-${spec.id}`).setAttribute('aria-keyshortcuts', String(index + 1));
  element(`equip-${spec.id}`).addEventListener('click', () => selectWeapon(index, true));
  element(`upgrade-${spec.id}`).addEventListener('click', () => {
    if (!physics || armory.hidden || !recordDialog.hidden || touchLayout.editing || !coinDialog.hidden) return;
    if (player.upgradeWeapon(spec.id) !== 'upgraded') return;
    physics.upgradeWeapon(spec.id, player.weaponLevel(spec.id));
    refreshArmory(); updateHud(physics.snapshot(1));
    if (element<HTMLButtonElement>(`upgrade-${spec.id}`).disabled) element(`equip-${spec.id}`).focus();
    void audio.unlock().then(() => audio.play('click'));
  });
}

const actionForKey = (code: string): keyof typeof held | null => {
  if (['Space', 'ArrowUp', 'KeyW'].includes(code)) return 'jump';
  if (['ArrowDown', 'KeyS'].includes(code)) return 'suction';
  if (['ShiftLeft', 'ShiftRight'].includes(code)) return 'boost';
  if (code === 'KeyZ') return 'frontJet';
  if (code === 'KeyX') return 'rearJet';
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
  if(!coinDialog.hidden) {
    if(event.code==='Escape') {event.preventDefault();if(!event.repeat)closeCoinGuide();}
    if(event.code==='Tab') {
      const last=coinTab==='buy'?element('coin-back-earn'):element('coin-tab-earn');
      if(event.shiftKey&&document.activeElement===coinClose){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();coinClose.focus();}
    }
    return;
  }
  if (!recordDialog.hidden) {
    if (event.code === 'Tab') {
      if (event.shiftKey && document.activeElement === recordName) { event.preventDefault(); recordSave.focus(); }
      else if (!event.shiftKey && document.activeElement === recordSave) { event.preventDefault(); recordName.focus(); }
    }
    return;
  }
  if (touchLayout.editing) {
    if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) closeTouchLayout(false); }
    if (event.code === 'Tab') {
      const controls = [...element('touch-controls').querySelectorAll<HTMLElement>('button'),
        ...element('touch-layout-editor').querySelectorAll<HTMLElement>('select, input, button')];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    return;
  }
  const target = event.target;
  if (target instanceof HTMLElement &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
  if (event.code === 'KeyG') {
    event.preventDefault();
    if (!event.repeat) { if (armory.hidden) openArmory(); else closeArmory(); }
    return;
  }
  const slot = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
  const keySlot = event.key?.length === 1 ? Math.max('12345678'.indexOf(event.key),
    '۱۲۳۴۵۶۷۸'.indexOf(event.key), '١٢٣٤٥٦٧٨'.indexOf(event.key)) : -1;
  const weaponSlot = slot ? Number(slot[1]) - 1 : keySlot;
  if (weaponSlot >= 0) {
    event.preventDefault();
    if (!event.repeat && (armory.hidden || armoryTab==='weapons')) selectWeapon(weaponSlot);
    return;
  }
  if (!armory.hidden) {
    if (event.code === 'Escape') { event.preventDefault(); if(!event.repeat)closeArmory(); }
    if (event.code === 'Tab') {
      const buttons = [armoryClose,element<HTMLButtonElement>(`armory-tab-${armoryTab}`),element<HTMLButtonElement>('armory-wallet-button'),
        ...element(armoryTab==='car'?'car-pane':'weapons-pane').querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
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
    else holdAction(action, `key-${event.code}`);
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
  if (action === 'frontJet' || action === 'rearJet') syncAirJetButtons();
});
window.addEventListener('blur', pause);
window.addEventListener('pagehide', () => { saveRunScore(); audio.suspend(); });
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
        frontJet: held.frontJet.size > 0,
        rearJet: held.rearJet.size > 0,
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
  if (status === 'running') player.trackScore(snapshot.distance, now);
  awardCoins(player.collect(snapshot.distance, snapshot.loopCompletions, snapshot.policeDestroyed, snapshot.flipCoins));
  if (simulating) coinRewardTime = Math.max(0, coinRewardTime - playDelta);
  const gained = awardExperience(snapshot);
  if (!gained && simulating) rewardTime = Math.max(0, rewardTime - playDelta);
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
    physics = new GamePhysics(7, { id: loadout.selected, xp: experience.total, upgrades: player.weaponUpgrades, carUpgrades: player.carUpgrades });
    visuals = new GameVisuals(sceneElement);
    const snapshot = physics.snapshot(0);
    visuals.render(snapshot, physics, 0, false);
    updateHud(snapshot);
    status = 'ready';
    loading.remove();
    setOverlay('ready');
    if (player.record.needsName) openRecordDialog();
    requestAnimationFrame(frame);
  } catch (error) {
    console.error('Roadster could not start', error);
    fail('bootError');
  }
}

setArmoryTab('weapons');
setCoinTab('earn');
updateLanguage();
void boot();
