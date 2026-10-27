import RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_STEP, GamePhysics, type Controls, type GameSnapshot } from './game/physics';
import { GameVisuals } from './game/visuals';
import { GameAudio } from './game/audio';
import { HudFeedback } from './game/hudFeedback';
import { ExperienceProgress, LEVEL_XP } from './game/experience';
import { PlayerProgress } from './game/playerProgress';
import { CAR_UPGRADE_IDS, MAX_CAR_UPGRADE, carUpgradeCost, carUpgradeRequiredLevel, carUpgradeStats, type CarUpgradeId } from './game/carUpgrades';
import { DISTANCE_COIN_REWARDS, DISTANCE_REWARD_INTERVAL, DISTANCE_REWARDS_PER_INTERVAL, FINAL_DISTANCE_REWARD, distanceCoinProgress } from './game/coinRewards';
import { carGarageIcon } from './game/carGarageIcon';
import { CAR_MODELS, CAR_MODEL_PRICE, carModel } from './game/carModels';
import { ALL_CAR_PAINTS, CAR_PAINT_PRICE } from './game/carPaint';
import type { BoxReward } from './game/randomBox';
import { MISSIONS, missionSpec, type MissionSpec } from './game/missions';
import { purchaseQuote, confirmPurchase, purchaseWeaponStats, purchaseCarStats, type PurchaseIntent, type PurchaseQuote } from './game/purchases';
import { loopsBetween } from './game/track';
import { ImpactPause, IMPACT_DAMAGE, IMPACT_PAUSE_SECONDS, ExplosionSlowMotion, RESTART_DELAY_SECONDS, WRECK_TIME_SCALE } from './game/damage';
import { WeaponLoadout, WEAPONS, MAX_WEAPON_UPGRADE, weaponSpec, weaponUpgradeCost, type AimDirection } from './game/weapons';
import { weaponIcon } from './game/weaponIcon';
import { formatNumber, formatDecimal, formatPercent, getLanguage, setLanguage, t, type MessageKey } from './i18n';
import { TouchLayoutEditor } from './touchLayout';
import { touchIcon } from './touchIcons';
import { SHOP_STATES, shopBadge, shopStateIcon, type ShopState } from './shopState';
import { ApiError, GameSync, clearSession, getTelegram, health, linkTelegram, logout, passkey, unlinkTelegram } from './backend';
import './styles.css';
import './hud.css';
import './touchLayout.css';
import './progress.css';
import './coins.css';
import './mobile.css';
import './customization.css';
import './missions.css';
import './shopStates.css';
import './backend.css';

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
          <button id="missions-button" class="icon-button" type="button" aria-haspopup="dialog" aria-controls="missions-dialog" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5H5v16h14V5h-4M9 3h6v4H9zM8 12l2 2 5-4M8 18h7"/></svg></button>
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
      <div id="distance-reward-meter" class="distance-reward-track" role="progressbar" aria-valuemin="0" aria-valuemax="${DISTANCE_REWARD_INTERVAL}"><span id="distance-reward-fill"></span>${DISTANCE_COIN_REWARDS.slice(0,DISTANCE_REWARDS_PER_INTERVAL).map((reward,index)=>`<i id="distance-reward-mark-${index}" class="distance-reward-mark" style="left:${reward.distance/DISTANCE_REWARD_INTERVAL*100}%" aria-hidden="true"></i>`).join('')}</div>
    </div>
    <div class="district-tag"><span class="district-dot"></span><span id="district"></span></div>
    <div id="pursuit-glow" class="pursuit-glow" aria-hidden="true"></div>
    <div id="impact-flash" class="impact-flash" aria-hidden="true"></div>
    <div id="challenge-hint" class="challenge-hint" role="status"></div>
    <div id="xp-toast" class="xp-toast" role="status"></div>
    <div id="coin-toast" class="coin-toast" role="status" hidden></div>
    <div id="box-toast" class="box-toast" role="status" hidden></div>
    <div id="mission-toast" class="mission-toast" role="status" hidden></div>
    <button id="mission-tracker" class="mission-tracker" type="button" aria-haspopup="dialog" aria-controls="missions-dialog"><span data-i18n="missions"></span><strong id="mission-tracker-label"></strong><small id="mission-tracker-progress"></small></button>
    <div id="powerup-status" class="powerup-status"><span id="shield-status" hidden></span><span id="unlimited-boost-status" hidden></span></div>
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
        <div class="shop-legend"><span class="shop-legend-item" data-shop-state="locked">${shopStateIcon('locked')}<span data-i18n="shopLegendLocked"></span></span><span class="shop-legend-item" data-shop-state="available">${shopStateIcon('available')}<span data-i18n="shopAvailable"></span></span><span class="shop-legend-item" data-shop-state="owned">${shopStateIcon('owned')}<span data-i18n="shopOwned"></span></span></div>
        <section id="weapons-pane" role="tabpanel" aria-labelledby="armory-tab-weapons">
        <p class="armory-description" data-i18n="armoryDescription"></p>
        <p class="armory-help" data-i18n="armoryHelp"></p>
        <p class="armory-coin-help" data-i18n="coinHelp"></p>
        <p class="armory-upgrade-help" data-i18n="weaponUpgradeHelp"></p>
        <div class="weapon-grid">${WEAPONS.map((spec, index) => `<div class="weapon-slot"><button id="equip-${spec.id}" class="weapon-card" type="button" aria-pressed="false">
          <span class="weapon-card-index" dir="ltr">0${index + 1}</span>${shopBadge(`weapon-shop-${spec.id}`)}${weaponIcon(spec.id)}
          <strong data-i18n="weapon${index}"></strong><small class="weapon-english" lang="en" dir="ltr">${spec.name}</small>
          <span class="weapon-power" aria-hidden="true">${Array.from({ length: 6 }, (_, dot) => `<i${dot < spec.power ? ' class="is-filled"' : ''}></i>`).join('')}</span>
          <span id="weapon-stats-${spec.id}" class="weapon-stats"></span><span id="weapon-price-${spec.id}" class="weapon-price"></span><span id="weapon-requirement-${spec.id}" class="weapon-requirement"></span><span id="weapon-unlock-${spec.id}" class="weapon-unlock"></span>
        </button><div id="weapon-upgrades-${spec.id}" class="weapon-upgrades" hidden>
          ${shopBadge(`weapon-upgrade-shop-${spec.id}`)}
          <div class="weapon-level-row"><span id="weapon-level-${spec.id}"></span><span class="upgrade-steps" aria-hidden="true">${Array.from({ length: MAX_WEAPON_UPGRADE }, (_, step) => `<i id="upgrade-step-${spec.id}-${step}"></i>`).join('')}</span></div>
          <p id="weapon-upgrade-preview-${spec.id}" class="weapon-upgrade-preview"></p>
          <button id="upgrade-${spec.id}" class="weapon-upgrade-button" type="button"><span id="upgrade-icon-${spec.id}" class="shop-action-icon" aria-hidden="true"></span><span id="upgrade-label-${spec.id}"></span></button>
        </div></div>`).join('')}</div>
        <p class="armory-note" data-i18n="armoryAmmoNote"></p>
        </section>
        <section id="car-pane" role="tabpanel" aria-labelledby="armory-tab-car" hidden>
          <div class="garage-model-heading"><h3 data-i18n="carCollection"></h3><p data-i18n="carSelectionHelp"></p></div>
          <div class="garage-models" role="group" aria-labelledby="car-collection-label"><span id="car-collection-label" class="sr-only" data-i18n="carCollection"></span>${CAR_MODELS.map(model => `<button id="vehicle-${model.id}" class="garage-model" type="button" aria-pressed="false">${shopBadge(`vehicle-shop-${model.id}`)}<span id="vehicle-preview-${model.id}" class="garage-model-preview" aria-hidden="true">${carGarageIcon(0, 'white', model.id)}</span><strong id="vehicle-name-${model.id}"></strong><span class="garage-model-english" lang="en" dir="ltr">${model.name}</span><small id="vehicle-state-${model.id}"></small></button>`).join('')}</div>
          <div class="garage-vehicle"><div id="garage-car-preview" class="garage-car-preview" role="img">${carGarageIcon(0)}</div><h3 id="garage-car-name"></h3><p id="garage-car-description"></p><p id="garage-car-summary"></p></div>
          <section class="garage-paints" aria-labelledby="car-paints-title"><div class="paint-heading"><h3 id="car-paints-title" data-i18n="carPaints"></h3><p data-i18n="carPaintHelp"></p></div><div class="paint-grid">${ALL_CAR_PAINTS.map(paint => `<button id="paint-${paint.id}" class="paint-swatch" type="button" aria-pressed="false" style="--paint:${paint.color}">${shopBadge(`paint-shop-${paint.id}`)}<span class="paint-chip" aria-hidden="true"></span><span data-i18n="paint${paint.id[0].toUpperCase() + paint.id.slice(1)}"></span><small id="paint-state-${paint.id}"></small></button>`).join('')}</div><p id="paint-feedback" class="paint-feedback" role="status"></p></section>
          <p class="garage-shared-upgrades" data-i18n="carSharedUpgrades"></p>
          <div class="car-upgrade-grid">${CAR_UPGRADE_IDS.map(id=>`<article id="car-upgrade-card-${id}" class="car-upgrade-card">
            ${shopBadge(`car-upgrade-shop-${id}`)}
            <h3 data-i18n="${carUpgradeNames[id]}"></h3><div class="weapon-level-row"><span id="car-level-${id}"></span><span class="upgrade-steps" aria-hidden="true">${Array.from({length:MAX_CAR_UPGRADE},(_,step)=>`<i id="car-upgrade-step-${id}-${step}"></i>`).join('')}</span></div>
            <p id="car-current-${id}" class="car-current-stats"></p><p id="car-next-${id}" class="car-next-stats"></p><p id="car-requirement-${id}" class="car-level-requirement"></p><button id="upgrade-car-${id}" class="weapon-upgrade-button" type="button"><span id="upgrade-car-icon-${id}" class="shop-action-icon" aria-hidden="true"></span><span id="upgrade-car-label-${id}"></span></button>
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
        <button id="menu-missions-button" class="menu-missions-button" type="button" aria-haspopup="dialog" aria-controls="missions-dialog" aria-expanded="false"><span data-i18n="missions"></span><strong id="menu-missions-progress"></strong><span aria-hidden="true">↗</span></button>
        <button id="primary-button" class="primary-button" type="button"><span id="primary-label"></span><span class="button-arrow" aria-hidden="true">↗</span></button>
        <button id="account-button" class="account-button" type="button"></button>
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
            ['◇','coinBoxTitle','coinBoxDescription'],
          ].map(([symbol,heading,copy])=>`<article class="coin-method"><span class="coin-guide-symbol" aria-hidden="true">${symbol}</span><h3 data-i18n="${heading}"></h3><p data-i18n="${copy}"></p><p class="coin-method-mobile" data-i18n="${copy}Mobile"></p></article>`).join('')}</div>
          <p class="coin-guide-note" data-i18n="coinXpNote"></p>
        </section>
        <section id="coin-buy-pane" class="coin-buy-pane" role="tabpanel" aria-labelledby="coin-tab-buy" hidden><span class="coin-buy-symbol" aria-hidden="true">${shopStateIcon('locked')}</span><h3 id="coin-buy-unavailable" data-i18n="coinBuyUnavailable"></h3><p data-i18n="coinBuyDescription"></p><button id="coin-back-earn" class="coin-back-earn" type="button" data-i18n="coinBackEarn"></button></section>
      </div>
    </div>
    <div id="missions-dialog" class="missions-dialog" role="dialog" aria-modal="true" aria-labelledby="missions-title" hidden>
      <div class="missions-card"><div class="missions-heading"><div><span class="eyebrow" data-i18n="missionEyebrow"></span><h2 id="missions-title" data-i18n="missionsTitle"></h2></div><button id="missions-close" class="armory-close" type="button" data-i18n="closeMissions"></button></div>
        <p class="missions-intro" data-i18n="missionsHelp"></p><div class="mission-summary"><strong id="missions-completed-count"></strong><strong id="missions-score"></strong><strong id="missions-coins"></strong></div>
        <div id="mission-tabs" class="armory-tabs" role="tablist">${['active','history','all'].map((tab,index)=>`<button id="mission-tab-${tab}" type="button" role="tab" aria-selected="${index===0}" aria-controls="mission-pane-${tab}" tabindex="${index===0?0:-1}" data-i18n="missionTab${tab[0].toUpperCase()+tab.slice(1)}"></button>`).join('')}</div>
        <section id="mission-pane-active" role="tabpanel" aria-labelledby="mission-tab-active"><div class="mission-active-grid">${Array.from({length:3},(_,index)=>`<article id="active-mission-${index}" class="mission-active-card"><span id="mission-scope-${index}" class="mission-scope"></span><h3 id="mission-title-${index}"></h3><p id="mission-description-${index}"></p><div class="mission-progress"><strong id="mission-progress-${index}"></strong><span id="mission-reward-${index}"></span></div><div id="mission-meter-${index}" class="mission-meter" role="progressbar" aria-valuemin="0"><span id="mission-fill-${index}"></span></div><small id="mission-best-${index}"></small><button id="mission-collect-${index}" class="mission-collect" type="button" hidden disabled data-i18n="missionCollect"></button></article>`).join('')}</div><p id="mission-empty" class="mission-empty"></p><p class="mission-rules" data-i18n="missionRules"></p></section>
        <section id="mission-pane-history" role="tabpanel" aria-labelledby="mission-tab-history" hidden><div id="mission-history" class="mission-list"></div><p id="mission-history-empty" class="mission-empty" data-i18n="missionHistoryEmpty"></p></section>
        <section id="mission-pane-all" role="tabpanel" aria-labelledby="mission-tab-all" hidden><div id="mission-catalog" class="mission-list"></div></section>
      </div>
    </div>
    <div id="purchase-dialog" class="purchase-dialog" role="dialog" aria-modal="true" aria-labelledby="purchase-title" aria-describedby="purchase-details" hidden><div class="purchase-card"><span class="eyebrow" data-i18n="purchaseEyebrow"></span><h2 id="purchase-title" data-i18n="purchaseTitle"></h2><div id="purchase-preview" class="purchase-preview" aria-hidden="true"></div><h3 id="purchase-name"></h3><p id="purchase-details"></p><p id="purchase-before" class="purchase-before"></p><p id="purchase-after" class="purchase-after"></p><dl class="purchase-costs"><div><dt data-i18n="purchaseCost"></dt><dd id="purchase-cost"></dd></div><div><dt data-i18n="coinBalance"></dt><dd id="purchase-balance"></dd></div><div><dt data-i18n="purchaseRemaining"></dt><dd id="purchase-remaining"></dd></div></dl><p id="purchase-error" class="purchase-error" role="alert" hidden data-i18n="purchaseChanged"></p><div class="purchase-actions"><button id="purchase-cancel" type="button" data-i18n="purchaseCancel"></button><button id="purchase-confirm" type="button" data-i18n="purchaseConfirm"></button></div></div></div>
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
    <div id="account-dialog" class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title" hidden>
      <div class="account-card">
        <div class="account-heading"><h2 id="account-title"></h2><button id="account-close" type="button" aria-label="Close">×</button></div>
        <p id="account-description"></p><p id="account-status" role="status"></p>
        <div id="account-auth-actions" class="account-actions"><button id="account-register" type="button"></button><button id="account-login" type="button"></button></div>
        <div id="account-signed-actions" hidden>
          <form id="redeem-form"><label id="redeem-label" for="redeem-code"></label><div class="account-inline"><input id="redeem-code" autocomplete="off" spellcheck="false" maxlength="64" placeholder="RDST-…"/><button id="redeem-submit" type="submit"></button></div></form>
          <div class="account-actions"><button id="account-refresh" type="button"></button><button id="telegram-link" type="button"></button><button id="telegram-unlink" type="button" hidden></button><button id="account-logout" type="button"></button></div>
          <p id="telegram-status"></p><a id="telegram-url" href="#" target="_blank" rel="noopener noreferrer" hidden></a>
        </div>
      </div>
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
const sync = progressStorage ? new GameSync(progressStorage) : null;
let syncReady = false;
const gameStorage = progressStorage ? {
  getItem: (key: string) => progressStorage.getItem(key),
  setItem: (key: string, value: string) => { progressStorage.setItem(key, value); if (syncReady) sync?.changed(key); },
} : undefined;
let experience = new ExperienceProgress(gameStorage);
let player = new PlayerProgress(gameStorage);
let loadout = new WeaponLoadout(experience.total, progressStorage, id => player.ownsWeapon(id));
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
const purchaseDialog = element('purchase-dialog');
const purchaseCancel = element<HTMLButtonElement>('purchase-cancel');
const purchaseConfirm = element<HTMLButtonElement>('purchase-confirm');
purchaseDialog.hidden = true;
let pendingPurchase: PurchaseQuote | null = null;
let purchaseOpener: HTMLButtonElement | null = null;
const missionsDialog = element('missions-dialog');
const missionsClose = element<HTMLButtonElement>('missions-close');
const missionButtons = ['missions-button','menu-missions-button','mission-tracker'].map(id=>element<HTMLButtonElement>(id));
missionsDialog.hidden = true;
let missionTab: 'active' | 'history' | 'all' = 'active';
let missionOpener: HTMLButtonElement | null = null;
let resumeAfterMissions = false;
let displayedMissionRevision = -1;
let displayedMissionLanguage = '';
let missionRewardTime = 0;
let lastMissionRewards: readonly MissionSpec[] = [];
let missionNotice: 'missionReadyNotice' | 'missionRewardNotice' = 'missionReadyNotice';
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
let lastBoxSerial = 0;
let boxRewardTime = 0;
let lastBoxReward: BoxReward | null = null;
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
const accountDialog = element<HTMLDivElement>('account-dialog');
accountDialog.hidden = true;
const accountButton = element<HTMLButtonElement>('account-button');
const accountStatus = element<HTMLParagraphElement>('account-status');
let accountBusy = false;
let startPending = false;
const accountCopy = {
  en: {
    button: 'ACCOUNT & SYNC', title: 'ACCOUNT & SYNC', intro: 'Use a passkey to keep your coins, upgrades, XP and records across devices.',
    register: 'CREATE ACCOUNT', login: 'SIGN IN', redeem: 'Redeem a coin code', submit: 'REDEEM', refresh: 'LOAD CLOUD SAVE',
    telegram: 'CONNECT TELEGRAM', unlink: 'DISCONNECT TELEGRAM', logout: 'SIGN OUT', linked: 'Telegram connected.',
    unlinked: 'Telegram is not connected.', saved: 'Progress synced.', loaded: 'Cloud progress loaded.',
    redeemed: 'Code redeemed. Cloud progress loaded.', signedOut: 'Signed out.',
    conflict: 'Cloud progress changed on another device. Choose “Load cloud save” to use it; your current local progress will be replaced.',
    unavailable: 'Service unavailable. Try again later.', unsupported: 'This browser does not support passkeys.',
    cancelled: 'Passkey was cancelled. Try again.', unauthorized: 'Session expired. Sign in again.',
    invalid_code: 'Invalid code.', code_expired: 'Code expired.', code_exhausted: 'Code exhausted.',
    code_already_redeemed: 'You already redeemed this code.', progress_required: 'A cloud save is needed first.',
    busy: 'Working…', telegramLink: 'OPEN TELEGRAM LINK', needFinish: 'Finish the current run before changing accounts.',
  },
  fa: {
    button: 'حساب و همگام‌سازی', title: 'حساب و همگام‌سازی', intro: 'با کلید عبور، سکه‌ها، ارتقاها، تجربه و رکورد را بین دستگاه‌ها نگه دارید.',
    register: 'ساخت حساب', login: 'ورود', redeem: 'ثبت کد سکه', submit: 'ثبت کد', refresh: 'دریافت ذخیرهٔ ابری',
    telegram: 'اتصال تلگرام', unlink: 'قطع اتصال تلگرام', logout: 'خروج', linked: 'تلگرام متصل است.',
    unlinked: 'تلگرام متصل نیست.', saved: 'پیشرفت همگام شد.', loaded: 'پیشرفت ابری دریافت شد.',
    redeemed: 'کد ثبت شد و پیشرفت ابری دریافت شد.', signedOut: 'از حساب خارج شدید.',
    conflict: 'پیشرفت ابری در دستگاه دیگری تغییر کرده است. با «دریافت ذخیرهٔ ابری» آن را جایگزین پیشرفت محلی کنید.',
    unavailable: 'سرویس در دسترس نیست. دوباره تلاش کنید.', unsupported: 'این مرورگر از کلید عبور پشتیبانی نمی‌کند.',
    cancelled: 'کلید عبور لغو شد. دوباره تلاش کنید.', unauthorized: 'نشست منقضی شده است. دوباره وارد شوید.',
    invalid_code: 'کد نامعتبر است.', code_expired: 'کد منقضی شده است.', code_exhausted: 'ظرفیت کد تمام شده است.',
    code_already_redeemed: 'این کد را قبلاً ثبت کرده‌اید.', progress_required: 'ابتدا باید ذخیرهٔ ابری ساخته شود.',
    busy: 'در حال انجام…', telegramLink: 'باز کردن لینک تلگرام', needFinish: 'پیش از تغییر حساب، دور فعلی را تمام کنید.',
  },
};
type AccountCopy = keyof typeof accountCopy.en;
const ac = (key: AccountCopy): string => accountCopy[getLanguage()][key];
function showAccountMessage(message: string): void { accountStatus.textContent = message; }
function accountError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) { clearSession(); sync?.signOut(); }
  const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : '';
  const key = code === 'revision_conflict' ? 'conflict' : code === 'passkey_unsupported' ? 'unsupported'
    : code === 'passkey_cancelled' || code === 'NotAllowedError' ? 'cancelled'
    : code === 'unauthorized' ? 'unauthorized' : code;
  showAccountMessage(key in accountCopy.en ? ac(key as AccountCopy) : ac('unavailable'));
  updateAccountUi();
}
sync && (sync.onError = accountError);

function updateAccountUi(): void {
  const signed = Boolean(sync?.signedIn);
  accountButton.textContent = `${ac('button')}${sync?.hasConflict ? ' !' : ''}`;
  element('account-title').textContent = ac('title');
  element('account-description').textContent = ac('intro');
  for (const [id, key] of [
    ['account-register', 'register'], ['account-login', 'login'], ['redeem-label', 'redeem'],
    ['redeem-submit', 'submit'], ['account-refresh', 'refresh'], ['telegram-link', 'telegram'],
    ['telegram-unlink', 'unlink'], ['account-logout', 'logout'],
  ] as const) element(id).textContent = ac(key);
  element('account-auth-actions').hidden = signed;
  element('account-signed-actions').hidden = !signed;
  accountDialog.dir = getLanguage() === 'fa' ? 'rtl' : 'ltr';
  for (const id of ['account-close', 'account-register', 'account-login', 'redeem-submit',
    'account-refresh', 'telegram-link', 'telegram-unlink', 'account-logout']) {
    element<HTMLButtonElement>(id).disabled = accountBusy;
  }
  element<HTMLButtonElement>('account-refresh').disabled = accountBusy || !signed;
}

async function accountAction(action: () => Promise<void>): Promise<void> {
  if (accountBusy) return;
  accountBusy = true; showAccountMessage(ac('busy')); updateAccountUi();
  try { await action(); } catch (error) { accountError(error); }
  finally { accountBusy = false; updateAccountUi(); }
}

function openAccount(): void {
  if (status === 'loading' || status === 'error' || dialogBlocked() || !recordDialog.hidden) return;
  if (status === 'running' || status === 'paused') { showAccountMessage(ac('needFinish')); return; }
  accountDialog.hidden = false;
  updateAccountUi();
  if (sync?.signedIn) void refreshTelegramStatus();
  element<HTMLButtonElement>('account-close').focus();
}
function closeAccount(): void { accountDialog.hidden = true; accountButton.focus(); }
async function refreshTelegramStatus(): Promise<void> {
  if (!sync?.token) return;
  try {
    const state = await getTelegram(sync.token);
    element('telegram-status').textContent = ac(state.linked ? 'linked' : 'unlinked');
    element('telegram-unlink').hidden = !state.linked;
    element('telegram-link').hidden = state.linked;
  } catch (error) { accountError(error); }
}
accountButton.addEventListener('click', openAccount);
element('account-close').addEventListener('click', closeAccount);
for (const mode of ['register', 'login'] as const) element(`account-${mode}`).addEventListener('click', () => {
  void accountAction(async () => {
    if (!sync || !progressStorage) throw new Error('storage_unavailable');
    await health();
    await passkey(mode);
    await sync.signedInNow();
    location.reload();
  });
});
element('account-logout').addEventListener('click', () => {
  void accountAction(async () => {
    const token = sync?.token;
    if (token) { await sync?.flush(); await logout(token); }
    sync?.signOut();
    showAccountMessage(ac('signedOut'));
  });
});
element('account-refresh').addEventListener('click', () => {
  void accountAction(async () => { await sync?.refreshFromServer(); location.reload(); });
});
element<HTMLFormElement>('redeem-form').addEventListener('submit', event => {
  event.preventDefault();
  void accountAction(async () => {
    const input = element<HTMLInputElement>('redeem-code');
    const code = input.value.trim();
    if (!code) return;
    await sync?.redeemCode(code);
    location.reload();
  });
});
element('telegram-link').addEventListener('click', () => {
  void accountAction(async () => {
    if (!sync?.token) return;
    const result = await linkTelegram(sync.token);
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.hostname !== 't.me') throw new Error('invalid_telegram_url');
    const anchor = element<HTMLAnchorElement>('telegram-url');
    anchor.href = url.href; anchor.textContent = ac('telegramLink'); anchor.hidden = false;
    await refreshTelegramStatus();
  });
});
element('telegram-unlink').addEventListener('click', () => {
  void accountAction(async () => {
    if (!sync?.token) return;
    await unlinkTelegram(sync.token);
    await refreshTelegramStatus();
    element('telegram-url').hidden = true;
  });
});

const formatDistance = (meters: number): string => `${formatNumber(meters, 4)} <small>${t('meter')}</small>`;
const districtKeys: MessageKey[] = ['districtMorning', 'districtDowntown', 'districtNight'];
const weaponName = (id: string): string => t(`weapon${WEAPONS.findIndex(spec => spec.id === id)}` as MessageKey);
const dialogBlocked = (): boolean => !purchaseDialog.hidden || !missionsDialog.hidden;
const missionName = (spec: MissionSpec): string => `${spec.title[getLanguage()]} · ${formatNumber(spec.target)}`;
const missionValue = (spec: MissionSpec, value: number): string => spec.unit === 'seconds' ? formatDecimal(Math.floor(value * 10 + 1e-6) / 10) : formatNumber(value);
let displayedMissionHistory = -1;
let displayedMissionAssignments = '';

function refreshMissions(force = false): void {
  const progress = player.missions;
  const language = getLanguage();
  if (!force && displayedMissionRevision === progress.revision && displayedMissionLanguage === language) return;
  const assignments = progress.active.map(active => `${active.id}:${active.progress >= missionSpec(active.id)!.target}`).join(',');
  const translateLists = force || displayedMissionLanguage !== language || displayedMissionHistory !== progress.completed.length || displayedMissionAssignments !== assignments;
  displayedMissionAssignments = assignments;
  displayedMissionRevision = progress.revision; displayedMissionLanguage = language;
  const completedText = t('missionCompletedCount', { count: formatNumber(progress.completed.length), total: formatNumber(MISSIONS.length) });
  textIfChanged(element('missions-completed-count'), completedText);
  textIfChanged(element('menu-missions-progress'), completedText);
  textIfChanged(element('missions-score'), t('missionScore', { score: formatNumber(progress.score) }));
  textIfChanged(element('missions-coins'), t('missionCoinsEarned', { coins: formatNumber(progress.earnedCoins) }));
  for (let index = 0; index < 3; index++) {
    const active = progress.active[index];
    const collect = element<HTMLButtonElement>(`mission-collect-${index}`);
    collect.hidden = collect.disabled = true;
    element(`active-mission-${index}`).hidden = !active;
    if (!active) continue;
    const spec = missionSpec(active.id)!;
    const ready = active.progress >= spec.target;
    element(`active-mission-${index}`).classList.toggle('is-ready', ready);
    collect.hidden = collect.disabled = !ready;
    collect.setAttribute('aria-label', `${t('missionCollect')} · ${missionName(spec)} · ${t('coinReward', { coins: formatNumber(spec.reward) })}`);
    textIfChanged(element(`mission-title-${index}`), missionName(spec));
    textIfChanged(element(`mission-description-${index}`), spec.description[language].replace('{target}', formatNumber(spec.target)));
    textIfChanged(element(`mission-scope-${index}`), t(ready ? 'missionReady' : spec.cumulative ? 'missionLifetime' : 'missionSingleRun'));
    const value = `${missionValue(spec, active.progress)} / ${missionValue(spec, spec.target)}`;
    textIfChanged(element(`mission-progress-${index}`), value);
    textIfChanged(element(`mission-reward-${index}`), t('coinReward', { coins: formatNumber(spec.reward) }));
    textIfChanged(element(`mission-best-${index}`), t('missionBest', { value: missionValue(spec, active.best) }));
    fillIfChanged(element(`mission-fill-${index}`), active.progress / spec.target);
    const meter = element(`mission-meter-${index}`);
    attributeIfChanged(meter, 'aria-valuemax', String(spec.target));
    attributeIfChanged(meter, 'aria-valuenow', String(active.progress));
    attributeIfChanged(meter, 'aria-label', `${missionName(spec)} · ${value}`);
  }
  element('mission-empty').hidden = progress.active.length === 3;
  textIfChanged(element('mission-empty'), t(progress.completed.length === MISSIONS.length ? 'missionCampaignComplete' : 'missionNextRun'));
  const first = progress.active.find(active => active.progress >= missionSpec(active.id)!.target) ?? progress.active[0];
  const spec = first ? missionSpec(first.id)! : null;
  textIfChanged(element('mission-tracker-label'), spec ? missionName(spec) : t('missionNextRun'));
  textIfChanged(element('mission-tracker-progress'), spec && first ? `${first.progress >= spec.target ? t('missionReady') : `${missionValue(spec, first.progress)} / ${missionValue(spec, spec.target)}`} · ${t('coinReward', { coins: formatNumber(spec.reward) })}` : completedText);
  if (translateLists) {
    displayedMissionHistory = progress.completed.length;
    const done = new Map(progress.completed.map(record => [record.id, record]));
    const active = new Map(progress.active.map(record => [record.id, record]));
    const render = (spec: MissionSpec): string => {
      const record = done.get(spec.id);
      const ready = (active.get(spec.id)?.progress ?? 0) >= spec.target;
      return `<article class="mission-list-item${record ? ' is-completed' : ready ? ' is-ready' : ''}"><span>${t(record ? 'missionDone' : ready ? 'missionReady' : active.has(spec.id) ? 'missionActive' : 'missionUpcoming')}</span><h3>${missionName(spec)}</h3><p>${spec.description[language].replace('{target}', formatNumber(spec.target))}</p><strong>${t('coinReward', { coins: formatNumber(record?.coins ?? spec.reward) })} · ${t('missionPoints', { points: formatNumber(record?.points ?? spec.points) })}</strong></article>`;
    };
    htmlIfChanged(element('mission-history'), [...progress.completed].reverse().map(record => render(missionSpec(record.id)!)).join(''));
    htmlIfChanged(element('mission-catalog'), MISSIONS.map(render).join(''));
    element('mission-history-empty').hidden = progress.completed.length > 0;
  }
}

function describeCarUpgrade(id: CarUpgradeId, stats: ReturnType<typeof carUpgradeStats>): string {
  return id === 'armor' ? t('carArmorStats', { health: formatNumber(stats.maxHealth), pieces: formatNumber(stats.armor) })
    : id === 'boost-reserve' ? t('carReserveStats', { seconds: formatDecimal(stats.boostCapacity / .48) })
    : t('carPowerStats', { speed: formatDecimal(9 * stats.boostPower * 3.6) });
}

function markShopState(node: HTMLElement, state: ShopState): void {
  attributeIfChanged(node, 'data-shop-state', state);
  for (const value of SHOP_STATES) node.classList.toggle(`is-shop-${value}`, value === state);
}

function showShopState(node: HTMLElement, badgeId: string, state: ShopState, levelLocked = false, coinsLocked = false): string {
  const key: MessageKey = state === 'locked'
    ? levelLocked && coinsLocked ? 'shopLockedBoth' : levelLocked ? 'shopLockedLevel' : 'shopLockedCoins'
    : state === 'available' ? 'shopAvailable' : state === 'selected' ? 'shopSelected' : state === 'complete' ? 'shopComplete' : 'shopOwned';
  const label = t(key);
  markShopState(node, state);
  markShopState(element(badgeId), state);
  htmlIfChanged(element(`${badgeId}-icon`), shopStateIcon(state));
  textIfChanged(element(`${badgeId}-label`), label);
  return label;
}

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
    button.classList.toggle('is-locked', button.disabled);
    button.classList.toggle('is-equipped', selected);
    button.setAttribute('aria-pressed', String(selected));
    attributeIfChanged(button, 'data-shop-owned', String(owned));
    const shopState = showShopState(button, `weapon-shop-${spec.id}`, button.disabled ? 'locked' : selected ? 'selected' : owned ? 'owned' : 'available',
      !unlocked, !owned && player.coins < spec.price);
    const combatStats = t('weaponCombatStats', { damage: formatDecimal(current.damage), rate: formatDecimal(1 / current.interval),
      ammo: formatNumber(physics?.weaponAmmo(spec.id) ?? current.ammo), capacity: formatNumber(current.ammo) });
    element(`weapon-stats-${spec.id}`).textContent = `${combatStats} · ${t('turnTime', { ms: formatNumber(spec.turnSeconds * 1000) })}`;
    element(`weapon-price-${spec.id}`).textContent = owned ? t('weaponOwned') : t('weaponPrice', { coins: formatNumber(spec.price) });
    element(`weapon-price-${spec.id}`).hidden = owned;
    element(`weapon-unlock-${spec.id}`).hidden = selected;
    const requirement = element(`weapon-requirement-${spec.id}`);
    requirement.hidden = owned;
    requirement.textContent = t('weaponLevelRequired', { level: formatNumber(Math.floor(spec.xp / LEVEL_XP) + 1), current: formatNumber(experience.level) });
    requirement.classList.toggle('is-met', unlocked);
    element(`weapon-unlock-${spec.id}`).textContent = !unlocked ? t('unlockAt', { xp: formatNumber(spec.xp) })
      : owned ? t(selected ? 'equipped' : 'equip')
      : player.coins >= spec.price ? t('buyWeapon', { coins: formatNumber(spec.price) })
      : t('needCoins', { coins: formatNumber(spec.price - player.coins) });
    button.setAttribute('aria-label', `${weaponName(spec.id)} · ${shopState} · ${combatStats}${owned ? '' : ` · ${element(`weapon-price-${spec.id}`).textContent} · ${requirement.textContent}`}${selected ? '' : ` · ${element(`weapon-unlock-${spec.id}`).textContent}`}`);
    button.title = `${shopState} · ${element(`weapon-unlock-${spec.id}`).textContent}`;
    element(`weapon-upgrades-${spec.id}`).hidden = !owned;
    element(`weapon-level-${spec.id}`).textContent = t(level > 0 ? 'shopUpgradeOwned' : 'weaponUpgradeLevel', { level: formatNumber(level), max: formatNumber(MAX_WEAPON_UPGRADE) });
    for (let step = 0; step < MAX_WEAPON_UPGRADE; step++) element(`upgrade-step-${spec.id}-${step}`).classList.toggle('is-filled', step < level);
    const cost = weaponUpgradeCost(spec.id, level);
    const upgrade = element<HTMLButtonElement>(`upgrade-${spec.id}`);
    upgrade.disabled = !owned || !unlocked || cost === null || player.coins < cost;
    const upgradeState: ShopState = cost === null ? 'complete' : upgrade.disabled ? 'locked' : 'available';
    const upgradeStatus = showShopState(upgrade, `weapon-upgrade-shop-${spec.id}`, upgradeState, !unlocked, cost !== null && player.coins < cost);
    element(`weapon-upgrade-shop-${spec.id}`).hidden = true;
    markShopState(element(`weapon-upgrades-${spec.id}`), cost === null ? 'complete' : level > 0 ? 'owned' : upgradeState);
    htmlIfChanged(element(`upgrade-icon-${spec.id}`), shopStateIcon(upgradeState));
    const action = cost === null ? t('weaponUpgradeMax') : t('weaponUpgradeBuy', { level: formatNumber(level + 1), coins: formatNumber(cost) });
    textIfChanged(element(`upgrade-label-${spec.id}`), action);
    upgrade.title = !unlocked && cost !== null ? requirement.textContent : cost !== null && player.coins < cost ? t('needCoins', { coins: formatNumber(cost - player.coins) }) : action;
    upgrade.setAttribute('aria-label', `${weaponName(spec.id)} · ${upgradeStatus} · ${action} · ${upgrade.title}`);
    const preview = element(`weapon-upgrade-preview-${spec.id}`);
    preview.hidden = cost === null;
    const next = weaponSpec(spec.id, level + 1);
    preview.textContent = t('weaponUpgradeNext', { damage: formatDecimal(next.damage), rate: formatDecimal(1 / next.interval), ammo: formatNumber(next.ammo) });
  }
  refreshGarage();
}

function refreshGarage(): void {
  const stats=carUpgradeStats(player.carUpgrades);
  const selectedModel = carModel(player.selectedVehicle);
  const selectedName = getLanguage() === 'fa' ? selectedModel.fa : selectedModel.name;
  textIfChanged(element('garage-car-name'), selectedName);
  textIfChanged(element('garage-car-description'), t(`carDescription${selectedModel.id}` as MessageKey));
  for (const model of CAR_MODELS) {
    const selected = model.id === player.selectedVehicle;
    const owned = player.ownsVehicle(model.id);
    const name = getLanguage() === 'fa' ? model.fa : model.name;
    const button = element<HTMLButtonElement>(`vehicle-${model.id}`);
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-selected', selected);
    button.classList.toggle('is-unowned', !owned);
    button.disabled = !owned && player.coins < CAR_MODEL_PRICE;
    const shopState = showShopState(button, `vehicle-shop-${model.id}`, button.disabled ? 'locked' : selected ? 'selected' : owned ? 'owned' : 'available', false, button.disabled);
    const label = selected ? t('carSelected') : owned ? t('carSelect') : t('carBuy', { coins: formatNumber(CAR_MODEL_PRICE) });
    button.title = !owned && button.disabled ? t('needCoins', { coins: formatNumber(CAR_MODEL_PRICE - player.coins) }) : label;
    button.setAttribute('aria-label', `${name} · ${shopState} · ${label} · ${button.title}`);
    textIfChanged(element(`vehicle-name-${model.id}`), name);
    textIfChanged(element(`vehicle-state-${model.id}`), label);
    htmlIfChanged(element(`vehicle-preview-${model.id}`), carGarageIcon(0, player.paintForVehicle(model.id), model.id));
  }
  htmlIfChanged(element('garage-car-preview'),carGarageIcon(stats.armor,player.selectedPaint,player.selectedVehicle));
  const paintName = (id: string): string => t(`paint${id[0].toUpperCase() + id.slice(1)}` as MessageKey);
  element('garage-car-preview').setAttribute('aria-label',`${selectedName} · ${paintName(player.selectedPaint)} · ${t('carArmorStats',{health:formatNumber(stats.maxHealth),pieces:formatNumber(stats.armor)})}`);
  textIfChanged(element('garage-car-summary'),t('carArmorStats',{health:formatNumber(stats.maxHealth),pieces:formatNumber(stats.armor)}));
  for (const paint of ALL_CAR_PAINTS) {
    const owned = player.ownsPaint(paint.id);
    const selected = player.selectedPaint === paint.id;
    const button = element<HTMLButtonElement>(`paint-${paint.id}`);
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-selected', selected);
    button.disabled = !owned && player.coins < CAR_PAINT_PRICE;
    const shopState = showShopState(button, `paint-shop-${paint.id}`, button.disabled ? 'locked' : selected ? 'selected' : owned ? 'owned' : 'available', false, button.disabled);
    const label = selected ? t('paintSelected') : owned ? t('paintApply') : t('paintPrice', { coins: formatNumber(CAR_PAINT_PRICE) });
    textIfChanged(element(`paint-state-${paint.id}`), label);
    button.title = !owned && player.coins < CAR_PAINT_PRICE ? t('needCoins', { coins: formatNumber(CAR_PAINT_PRICE - player.coins) }) : label;
    button.setAttribute('aria-label', `${paintName(paint.id)} · ${shopState} · ${label} · ${button.title}`);
  }
  for (const id of CAR_UPGRADE_IDS) {
    const level=player.carLevel(id);
    const next=carUpgradeStats({...player.carUpgrades,[id]:level+1});
    const describe=(value:typeof stats):string=>id==='armor' ? t('carArmorStats',{health:formatNumber(value.maxHealth),pieces:formatNumber(value.armor)})
      : id==='boost-reserve' ? t('carReserveStats',{seconds:formatDecimal(value.boostCapacity/.48)})
      : t('carPowerStats',{speed:formatDecimal(9*value.boostPower*3.6)});
    textIfChanged(element(`car-level-${id}`),t(level > 0 ? 'shopUpgradeOwned' : 'weaponUpgradeLevel',{level:formatNumber(level),max:formatNumber(MAX_CAR_UPGRADE)}));
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
    const upgradeState: ShopState = cost === null ? 'complete' : button.disabled ? 'locked' : 'available';
    const upgradeStatus = showShopState(button, `car-upgrade-shop-${id}`, upgradeState, required !== null && !eligible, cost !== null && player.coins < cost);
    markShopState(element(`car-upgrade-card-${id}`), cost === null ? 'complete' : level > 0 ? 'owned' : upgradeState);
    htmlIfChanged(element(`upgrade-car-icon-${id}`), shopStateIcon(upgradeState));
    const action = cost===null?t('weaponUpgradeMax'):t('weaponUpgradeBuy',{level:formatNumber(level+1),coins:formatNumber(cost)});
    textIfChanged(element(`upgrade-car-label-${id}`), action);
    button.title=required!==null&&!eligible?requirement.textContent:cost!==null&&player.coins<cost?t('needCoins',{coins:formatNumber(cost-player.coins)}):action;
    button.setAttribute('aria-label',`${t(carUpgradeNames[id])} · ${upgradeStatus} · ${action} · ${button.title}`);
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
  attributeIfChanged(meter,'aria-valuemin',String(progress.interval*DISTANCE_REWARD_INTERVAL));
  attributeIfChanged(meter,'aria-valuemax',String((progress.interval+1)*DISTANCE_REWARD_INTERVAL));
  attributeIfChanged(meter,'aria-valuenow',String(Math.min(FINAL_DISTANCE_REWARD,progress.distance)));
  attributeIfChanged(meter,'aria-valuetext',`${formatNumber(progress.distance)} ${t('meter')} · ${label}`);
  for(let index=0;index<DISTANCE_REWARDS_PER_INTERVAL;index++) {
    const reward=DISTANCE_COIN_REWARDS[progress.interval*DISTANCE_REWARDS_PER_INTERVAL+index];
    element(`distance-reward-mark-${index}`).classList.toggle('is-reached',progress.distance>=reward.distance);
  }
}

function updateHud(snapshot?: GameSnapshot): void {
  refreshMissions();
  element('mission-toast').hidden = missionRewardTime <= 0;
  if (lastMissionRewards.length) textIfChanged(element('mission-toast'), t(missionNotice, {
    name: lastMissionRewards.length === 1 ? missionName(lastMissionRewards[0]) : t('missionBatch', { count: formatNumber(lastMissionRewards.length) }),
    coins: formatNumber(lastMissionRewards.reduce((sum, spec) => sum + spec.reward, 0)),
  }));
  const showingLastScore = (status === 'ready' || status === 'loading') && player.score > 0;
  const unlimitedBoost = (snapshot?.unlimitedBoostRemaining ?? 0) > 0;
  const charge = unlimitedBoost ? 1 : snapshot?.boost ?? 1;
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
  element('box-toast').hidden = boxRewardTime <= 0 || !lastBoxReward;
  if (lastBoxReward) textIfChanged(element('box-toast'), boxRewardLabel(lastBoxReward));
  const shieldSeconds = Math.ceil(snapshot?.shieldRemaining ?? 0);
  const boostSeconds = Math.ceil(snapshot?.unlimitedBoostRemaining ?? 0);
  element('shield-status').hidden = shieldSeconds <= 0;
  element('unlimited-boost-status').hidden = boostSeconds <= 0;
  textIfChanged(element('shield-status'), t('shieldTimer', { seconds: formatNumber(shieldSeconds) }));
  textIfChanged(element('unlimited-boost-status'), t('unlimitedBoostTimer', { seconds: formatNumber(boostSeconds) }));
  element('shield-status').classList.toggle('is-expiring', shieldSeconds > 0 && shieldSeconds <= 3);
  const percentage = Math.round(charge * 100);
  fillIfChanged(boostFill, charge);
  textIfChanged(boostValue, unlimitedBoost ? '∞' : formatPercent(charge));
  textIfChanged(element('touch-boost-value'), unlimitedBoost ? '∞' : formatPercent(charge));
  attributeIfChanged(element('touch-boost-ring'), 'stroke-dashoffset', String((1 - charge) * 100));
  const boostDescription = unlimitedBoost ? t('unlimitedBoostTimer', { seconds: formatNumber(boostSeconds) }) : t('boostMeter', { charge: formatPercent(charge) });
  attributeIfChanged(element('touch-boost'), 'aria-label', `${t('boost')} · ${boostDescription}`);
  attributeIfChanged(boostMeter, 'aria-valuenow', String(percentage));
  attributeIfChanged(boostMeter, 'aria-label', t('boostReserve'));
  attributeIfChanged(boostMeter, 'aria-valuetext', boostDescription);
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
  element('missions-button').setAttribute('aria-label', t('missions'));
  element('missions-button').title = `${t('missions')} (J)`;
  element('missions-button').setAttribute('aria-keyshortcuts', 'J');
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
  refreshMissions(true);
  if (pendingPurchase) renderPurchase(pendingPurchase);
}

function clearHeld(): void {
  Object.values(held).forEach((set) => set.clear());
  document.querySelectorAll('.touch-button').forEach((button) => button.classList.remove('is-pressed'));
}

async function start(): Promise<void> {
  if (startPending) return;
  if (dialogBlocked()) return;
  if (touchLayout.editing || !armory.hidden || !recordDialog.hidden || !coinDialog.hidden || !accountDialog.hidden) return;
  if (status === 'loading' || status === 'error' || status === 'running') return;
  if (status === 'crashed' && performance.now() < restartAvailableAt) return;
  const resuming = status === 'paused';
  if (!resuming && sync?.signedIn) {
    startPending = true; primaryButton.disabled = true;
    try { await sync.beginRun(); }
    catch (error) { accountError(error); openAccount(); return; }
    finally { startPending = false; primaryButton.disabled = false; }
  }
  if (status === 'ready') { player.resetRun(); player.beginMissionRun(); refreshMissions(true); }
  if (status === 'crashed') {
    restartAvailableAt = 0;
    primaryButton.disabled = false;
    physics.dispose();
    physics = new GamePhysics(7, { id: loadout.selected, xp: experience.total, upgrades: player.weaponUpgrades, carUpgrades: player.carUpgrades, vehicle: player.selectedVehicle });
    audio.reset();
    accumulator = 0;
    holdInterpolation = false;
    jumpQueued = false;
    currentDistrict = 0;
    warnedChallenges.clear();
    experience.resetRun();
    player.resetRun();
    player.beginMissionRun(); refreshMissions(true);
    rewardTime = 0;
    coinRewardTime = 0;
    lastBoxSerial = 0; boxRewardTime = 0; lastBoxReward = null;
    missionRewardTime = 0; lastMissionRewards = [];
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
  void sync?.flush().catch(accountError);
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
  awardCoins(player.collect(snapshot.distance, snapshot.loopCompletions, snapshot.policeDestroyed, snapshot.flipCoins, snapshot.boxCoins));
  awardExperience(snapshot);
  updateMissions(snapshot, true);
  experience.finishRun();
  const result = player.finishRun(physics.distance);
  void sync?.finishRun().catch(accountError);
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
  const gained = experience.collect(snapshot.loopCompletions, snapshot.obstaclesDestroyed, snapshot.policeDestroyed, snapshot.distance, snapshot.boxXp);
  if (gained) {
    lastReward = gained;
    lastRewardMessage = ({ loop: 'loopReward', obstacle: 'obstacleReward', police: 'policeReward', distance: 'distanceXpRewardNotice', box: 'boxXpReward', mixed: 'xpReward' } as const)[experience.lastRewardKind];
    rewardTime = 3;
    audio.play('record');
  }
  return gained;
}

function updateMissions(snapshot: GameSnapshot, finished = false): void {
  if (!snapshot.missionStats) return;
  const ready = player.updateMissions(snapshot.missionStats, performance.now(), finished);
  if (!ready.length) return;
  lastMissionRewards = ready; missionRewardTime = 4; missionNotice = 'missionReadyNotice';
  audio.play('record');
}

function boxRewardLabel(reward: BoxReward): string {
  if (reward.kind === 'coins') return t('boxCoinReward', { coins: formatNumber(reward.amount) });
  if (reward.kind === 'xp') return t('boxXpReward', { xp: formatNumber(reward.amount) });
  if (reward.kind === 'health') return t('boxHealthReward');
  if (reward.kind === 'ammo') return t('boxAmmoReward');
  return t(reward.kind === 'shield' ? 'boxShieldReward' : 'boxBoostReward', { seconds: formatNumber(reward.seconds) });
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
  void sync?.flush().catch(accountError);
  document.querySelector('.game-shell')?.classList.remove('is-naming-record');
  updateHud(physics?.snapshot(1));
  primaryButton.focus();
});

function jumpDown(source: string): void {
  if (dialogBlocked()) return;
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
  if (dialogBlocked()) return;
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
  if (dialogBlocked()) return;
  aimDirection = direction;
  updateHud(physics?.snapshot(Math.min(1, accumulator / FIXED_STEP)));
}
element('touch-aim').addEventListener('click', () => { if (!element('touch-aim').hidden && !touchLayout.editing && armory.hidden && recordDialog.hidden && coinDialog.hidden) turnWeapon(); });
element('weapon-aim').addEventListener('click', () => { turnWeapon(); element('weapon-aim').blur(); });

function renderPurchase(quote: PurchaseQuote): void {
  const weapon = purchaseWeaponStats(quote);
  const car = purchaseCarStats(player, quote);
  let name = ''; let preview = ''; let details = ''; let before = ''; let after = '';
  if (weapon && (quote.kind === 'weapon' || quote.kind === 'weapon-upgrade')) {
    name = weaponName(quote.id); preview = weaponIcon(quote.id);
    const describe = (spec: typeof weapon.after, ammo: number): string => t('weaponCombatStats', {
      damage: formatDecimal(spec.damage), rate: formatDecimal(1 / spec.interval), ammo: formatNumber(ammo), capacity: formatNumber(spec.ammo),
    });
    details = t(quote.kind === 'weapon' ? 'purchaseWeaponDetails' : 'purchaseUpgradeDetails', { level: formatNumber(quote.level) });
    if (weapon.before) before = describe(weapon.before, physics.weaponAmmo(quote.id));
    after = describe(weapon.after, weapon.before ? physics.weaponAmmo(quote.id) + weapon.after.ammo - weapon.before.ammo : weapon.after.ammo);
  } else if (car && quote.kind === 'car-upgrade') {
    name = t(carUpgradeNames[quote.id]); details = t('purchaseSharedUpgradeDetails', { level: formatNumber(quote.level) });
    preview = carGarageIcon(car.after.armor, player.selectedPaint, player.selectedVehicle);
    before = describeCarUpgrade(quote.id, car.before); after = describeCarUpgrade(quote.id, car.after);
  } else if (quote.kind === 'paint') {
    name = t(`paint${quote.id[0].toUpperCase() + quote.id.slice(1)}` as MessageKey);
    const model = carModel(quote.vehicle ?? player.selectedVehicle);
    details = t('purchasePaintDetails', { car: getLanguage() === 'fa' ? model.fa : model.name });
    preview = carGarageIcon(carUpgradeStats(player.carUpgrades).armor, quote.id, model.id);
  } else if (quote.kind === 'vehicle') {
    const model = carModel(quote.id);
    name = getLanguage() === 'fa' ? model.fa : model.name;
    details = `${t(`carDescription${model.id}` as MessageKey)} ${t('purchaseVehicleDetails')}`;
    const stats = carUpgradeStats(player.carUpgrades);
    preview = carGarageIcon(stats.armor, player.paintForVehicle(model.id), model.id);
    after = `${describeCarUpgrade('armor', stats)} · ${describeCarUpgrade('boost-reserve', stats)} · ${describeCarUpgrade('boost-power', stats)}`;
  }
  textIfChanged(element('purchase-name'), name);
  textIfChanged(element('purchase-details'), details);
  htmlIfChanged(element('purchase-preview'), preview);
  element('purchase-before').hidden = !before; element('purchase-after').hidden = !after;
  textIfChanged(element('purchase-before'), t('purchaseBefore', { stats: before }));
  textIfChanged(element('purchase-after'), t('purchaseAfter', { stats: after }));
  textIfChanged(element('purchase-cost'), t('paintPrice', { coins: formatNumber(quote.cost) }));
  textIfChanged(element('purchase-balance'), formatNumber(player.coins));
  textIfChanged(element('purchase-remaining'), formatNumber(Math.max(0, player.coins - quote.cost)));
}

function requestPurchase(intent: PurchaseIntent, opener: HTMLButtonElement): void {
  if (dialogBlocked() || armory.hidden || !recordDialog.hidden || !coinDialog.hidden || touchLayout.editing) return;
  const quote = purchaseQuote(player, intent, experience.total);
  if (!quote) return;
  pendingPurchase = quote; purchaseOpener = opener;
  clearHeld(); jumpQueued = false;
  purchaseDialog.hidden = false; armory.inert = true; overlay.inert = true;
  element('purchase-error').hidden = true; purchaseConfirm.disabled = false;
  renderPurchase(quote); purchaseCancel.focus();
}

function closePurchase(): void {
  pendingPurchase = null; purchaseDialog.hidden = true;
  armory.inert = false; overlay.inert = false;
  clearHeld(); jumpQueued = false;
  if (purchaseOpener?.disabled) element(armoryTab === 'car' ? 'armory-tab-car' : 'armory-tab-weapons').focus();
  else purchaseOpener?.focus();
  purchaseOpener = null;
}
purchaseCancel.addEventListener('click', closePurchase);
purchaseConfirm.addEventListener('click', () => {
  const quote = pendingPurchase;
  if (!quote || purchaseDialog.hidden) return;
  if (!confirmPurchase(player, quote, experience.total)) {
    purchaseConfirm.disabled = true; element('purchase-error').hidden = false; purchaseCancel.focus(); return;
  }
  pendingPurchase = null;
  if (quote.kind === 'weapon') {
    loadout.select(quote.id, experience.total); physics.equipWeapon(quote.id, experience.total);
  } else if (quote.kind === 'weapon-upgrade') physics.upgradeWeapon(quote.id, player.weaponLevel(quote.id));
  else if (quote.kind === 'car-upgrade') physics.upgradeCar(player.carUpgrades);
  else if (quote.kind === 'vehicle') applySelectedVehicle();
  else visuals.setPaint(player.selectedPaint);
  refreshArmory(); updateHud(physics.snapshot(1)); closePurchase();
  void sync?.flush().catch(accountError);
  void audio.unlock().then(() => audio.play('click'));
});

function setMissionTab(tab: typeof missionTab, focus = false): void {
  missionTab = tab;
  for (const name of ['active','history','all'] as const) {
    const active = name === tab; const button = element<HTMLButtonElement>(`mission-tab-${name}`);
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    element(`mission-pane-${name}`).hidden = !active;
  }
  if (focus) element(`mission-tab-${tab}`).focus();
}
function openMissions(opener: HTMLButtonElement): void {
  if (status === 'loading' || status === 'error' || dialogBlocked() || !coinDialog.hidden || !recordDialog.hidden || touchLayout.editing) return;
  resumeAfterMissions = status === 'running';
  if (resumeAfterMissions) pause();
  clearHeld(); jumpQueued = false; missionOpener = opener;
  missionsDialog.hidden = false; armory.inert = true; overlay.inert = true;
  for (const button of missionButtons) button.setAttribute('aria-expanded','true');
  setMissionTab('active'); refreshMissions(true); missionsClose.focus();
}
function closeMissions(): void {
  missionsDialog.hidden = true; armory.inert = false; overlay.inert = false;
  for (const button of missionButtons) button.setAttribute('aria-expanded','false');
  clearHeld(); jumpQueued = false;
  if (resumeAfterMissions && status === 'paused') start();
  missionOpener?.focus(); missionOpener = null; resumeAfterMissions = false;
}
for (const button of missionButtons) button.addEventListener('click', () => openMissions(button));
missionsClose.addEventListener('click', closeMissions);
for (let index = 0; index < 3; index++) {
  element(`mission-collect-${index}`).addEventListener('click', () => {
    if (missionsDialog.hidden || missionTab !== 'active') return;
    const active = player.missions.active[index];
    const reward = active && player.collectMission(active.id);
    if (!reward) return;
    lastMissionRewards = [reward]; missionRewardTime = 4; missionNotice = 'missionRewardNotice';
    awardCoins(reward.reward); audio.play('record');
    refreshMissions(true); refreshArmory(); updateHud();
    void sync?.flush().catch(accountError);
    element('mission-tab-active').focus();
  });
}
for (const [index, tab] of (['active','history','all'] as const).entries()) {
  element(`mission-tab-${tab}`).addEventListener('click', () => setMissionTab(tab, true));
  element(`mission-tab-${tab}`).addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.code)) return;
    event.preventDefault();
    const tabs = ['active','history','all'] as const;
    setMissionTab(event.code === 'Home' ? 'active' : event.code === 'End' ? 'all' : tabs[(index + (event.code === 'ArrowLeft' ? 2 : 1)) % 3], true);
  });
}

function openArmory(): void {
  if (dialogBlocked()) return;
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
  if (dialogBlocked()) return;
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
  if (dialogBlocked()) return;
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
function applySelectedVehicle(): void {
  physics.selectVehicle(player.selectedVehicle);
  visuals.setVehicle(player.selectedVehicle);
  visuals.setPaint(player.selectedPaint);
  visuals.render(physics.snapshot(1), physics, 0, false);
  textIfChanged(element('paint-feedback'), '');
}
for (const model of CAR_MODELS) element(`vehicle-${model.id}`).addEventListener('click', () => {
  if (!physics || armory.hidden || armoryTab !== 'car' || dialogBlocked() || !recordDialog.hidden || !coinDialog.hidden || touchLayout.editing) return;
  if (!player.ownsVehicle(model.id)) {
    requestPurchase({ kind: 'vehicle', id: model.id }, element<HTMLButtonElement>(`vehicle-${model.id}`)); return;
  }
  if (player.selectedVehicle === model.id || !player.selectVehicle(model.id)) return;
  applySelectedVehicle();
  refreshGarage();
  void audio.unlock().then(() => audio.play('click'));
});
for (const id of CAR_UPGRADE_IDS) element(`upgrade-car-${id}`).addEventListener('click',()=>{
  if(!physics||armory.hidden||armoryTab!=='car'||!recordDialog.hidden||touchLayout.editing||!coinDialog.hidden) return;
  requestPurchase({ kind: 'car-upgrade', id }, element<HTMLButtonElement>(`upgrade-car-${id}`));
});
for (const paint of ALL_CAR_PAINTS) element(`paint-${paint.id}`).addEventListener('click', () => {
  if (!physics || armory.hidden || armoryTab !== 'car' || !recordDialog.hidden || touchLayout.editing || !coinDialog.hidden) return;
  if (player.selectedPaint === paint.id) return;
  if (dialogBlocked()) return;
  if (player.ownsPaint(paint.id)) player.selectPaint(paint.id);
  else { requestPurchase({ kind: 'paint', id: paint.id }, element<HTMLButtonElement>(`paint-${paint.id}`)); return; }
  visuals.setPaint(player.selectedPaint);
  textIfChanged(element('paint-feedback'), t('paintApplied', { color: t(`paint${paint.id[0].toUpperCase() + paint.id.slice(1)}` as MessageKey) }));
  refreshArmory(); updateHud(physics.snapshot(1));
  void audio.unlock().then(() => audio.play('click'));
});
function openTouchLayout(): void {
  if (dialogBlocked()) return;
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
  if (!physics || !spec || !recordDialog.hidden || !coinDialog.hidden || dialogBlocked()) return;
  if (!player.ownsWeapon(spec.id)) {
    if (purchase) requestPurchase({ kind: 'weapon', id: spec.id }, element<HTMLButtonElement>(`equip-${spec.id}`));
    return;
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
    requestPurchase({ kind: 'weapon-upgrade', id: spec.id }, element<HTMLButtonElement>(`upgrade-${spec.id}`));
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
  if (!purchaseDialog.hidden) {
    if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) closePurchase(); }
    if (event.code === 'Tab') {
      if (event.shiftKey && document.activeElement === purchaseCancel) { event.preventDefault(); (purchaseConfirm.disabled ? purchaseCancel : purchaseConfirm).focus(); }
      else if (!event.shiftKey && (document.activeElement === purchaseConfirm || purchaseConfirm.disabled)) { event.preventDefault(); purchaseCancel.focus(); }
    }
    return;
  }
  if (!missionsDialog.hidden) {
    if (event.code === 'Escape' || event.code === 'KeyJ') { event.preventDefault(); if (!event.repeat) closeMissions(); }
    if (event.code === 'Tab') {
      const collectButtons = [0, 1, 2].map(index => element<HTMLButtonElement>(`mission-collect-${index}`));
      const last = missionTab === 'active'
        ? collectButtons.filter(button => !button.hidden && !button.disabled).at(-1) ?? element('mission-tab-active')
        : element(`mission-tab-${missionTab}`);
      if (event.shiftKey && document.activeElement === missionsClose) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); missionsClose.focus(); }
    }
    return;
  }
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
  if (event.code === 'KeyJ') {
    event.preventDefault(); if (!event.repeat) openMissions(element<HTMLButtonElement>('missions-button')); return;
  }
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
window.addEventListener('pagehide', () => { saveRunScore(); void sync?.flush().catch(accountError); audio.suspend(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
primaryButton.addEventListener('click', start);
pauseButton.addEventListener('click', () => { if (status === 'running') pause(); else if (status === 'paused') start(); });
soundButton.addEventListener('click', toggleSound);
languageButton.addEventListener('click', () => {
  setLanguage(getLanguage() === 'en' ? 'fa' : 'en');
  updateLanguage();
  updateAccountUi();
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
  if (status === 'running') updateMissions(snapshot);
  if (simulating) missionRewardTime = Math.max(0, missionRewardTime - playDelta);
  if (status === 'running') player.trackScore(snapshot.distance, now);
  awardCoins(player.collect(snapshot.distance, snapshot.loopCompletions, snapshot.policeDestroyed, snapshot.flipCoins, snapshot.boxCoins));
  if (snapshot.boxRewardSerial > lastBoxSerial) {
    lastBoxSerial = snapshot.boxRewardSerial;
    lastBoxReward = snapshot.boxRewardEvents.at(-1)?.reward ?? null;
    boxRewardTime = 3;
  }
  if (simulating) boxRewardTime = Math.max(0, boxRewardTime - playDelta);
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
    if (sync && progressStorage) {
      if (!progressStorage.getItem('roadster-progress')) player.save();
      if (sync.signedIn) {
        try {
          await health();
          const restored = await sync.initialize();
          if (restored) {
            player = new PlayerProgress(gameStorage);
            experience = new ExperienceProgress(gameStorage);
            loadout = new WeaponLoadout(experience.total, progressStorage, id => player.ownsWeapon(id));
            best = player.record.distance;
            refreshArmory();
            refreshMissions(true);
          }
        } catch (error) { sync.markUnavailable(); accountError(error); }
      }
    }
    syncReady = true;
    await RAPIER.init();
    physics = new GamePhysics(7, { id: loadout.selected, xp: experience.total, upgrades: player.weaponUpgrades, carUpgrades: player.carUpgrades, vehicle: player.selectedVehicle });
    visuals = new GameVisuals(sceneElement);
    visuals.setVehicle(player.selectedVehicle);
    visuals.setPaint(player.selectedPaint);
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
updateAccountUi();
void boot();
