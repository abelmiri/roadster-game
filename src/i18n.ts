export type Language = 'en' | 'fa';

const en = {
  pageTitle: 'Roadster — City Runner',
  sceneLabel: 'Side-view city driving game',
  brand: 'ROADSTER',
  edition: 'CITY RUNNER',
  legalCredits: 'Copyright & licenses',
  distance: 'DISTANCE',
  best: 'BEST',
  meter: 'm',
  speed: 'SPEED',
  speedUnit: 'KM/H',
  boostReserve: 'BOOST RESERVE',
  boostMeter: 'Boost reserve: {charge}',
  health: 'CAR HEALTH',
  healthMeter: 'Car health: {health}',
  impactNotice: 'IMPACT · −{damage} HEALTH',
  invincibleNotice: 'TEMPORARILY INVINCIBLE',
  carDestroyed: 'CAR DESTROYED',
  districtMorning: 'MORNING DISTRICT',
  districtDowntown: 'DOWNTOWN FLOW',
  districtNight: 'AFTER DARK',
  pause: 'Pause game',
  pauseTitle: 'Pause (P / Esc)',
  resume: 'Resume game',
  resumeTitle: 'Resume (P / Space)',
  mute: 'Mute sound',
  muteTitle: 'Mute sound (M)',
  unmute: 'Enable sound',
  unmuteTitle: 'Enable sound (M)',
  switchLanguage: 'تغییر زبان به فارسی',
  jump: 'JUMP',
  suction: 'SUCTION',
  boost: 'BOOST',
  jumpGuide: 'JUMP / HOLD',
  airBoost: 'BOOST',
  spaceKey: 'SPACE',
  shiftKey: 'SHIFT',
  jumpLabel: 'Jump; hold for a long jump; tap again for a double jump',
  suctionLabel: 'Hold for suction to stay close to the road',
  boostLabel: 'Hold for boost on the road or in the air',
  jumpSummary: 'Tap, hold, tap again',
  suctionSummary: 'Hug the road · ride loops',
  boostSummary: 'Road & air · escape police',
  xpLevel: 'LEVEL {level}',
  xpProgress: 'Level progress: {xp} of {target} XP',
  loopReward: 'LOOP COMPLETE · +{xp} XP',
  obstacleReward: 'OBSTACLE DESTROYED · +{xp} XP',
  policeReward: 'POLICE DESTROYED · +{xp} XP',
  xpReward: 'REWARDS · +{xp} XP',
  loopAhead: 'LOOP AHEAD · HOLD SUCTION FOR +25 XP',
  loopHold: 'HOLD SUCTION · COMPLETE THE LOOP',
  policeWarning: 'POLICE CLOSING IN · BOOST TO ESCAPE',
  policeAhead: 'POLICE AHEAD · AVOID CONTACT',
  policeCaught: 'Wrecked by the police.',
  runXp: '{xp} XP this run',
  readyEyebrow: 'THE CITY IS YOUR TRACK',
  readyTitle: 'OUTRUN<br /><em>THE SKYLINE.</em>',
  readyDescription: 'Jump the gaps, Shoot the objects, Hold suction for loops. Use boost regularly to keep the police away.',
  start: 'START RUN',
  readyFoot: 'SPACE TO START <span>·</span> M TO MUTE SOUND',
  pausedEyebrow: 'RUN ON HOLD',
  pausedTitle: 'TAKE A<br /><em>BREATHER.</em>',
  pausedDescription: 'The road will be right where you left it.',
  resumeRun: 'RESUME RUN',
  pausedFoot: 'PRESS P OR SPACE TO RESUME',
  restartIn: 'Restart in {seconds}s',
  crashedEyebrow: 'END OF THE ROAD',
  crashedTitle: 'ONE MORE<br /><em>RUN?</em>',
  crashedDescription: '{distance} m traveled · Best {best} m',
  runAgain: 'RUN AGAIN',
  crashedFoot: 'SPACE TO RESTART <span>·</span> THE CITY KEEPS MOVING',
  sideIndex: 'R // 01',
  sideMotto: 'DRIVE BEYOND THE HORIZON',
  rotateTitle: 'TURN TO LANDSCAPE',
  rotateDescription: 'Roadster needs a wider view of the road ahead.',
  loading: 'STARTING ENGINES',
  bootError: 'Roadster could not start. Reload the page to try again.',
  runtimeError: 'The run stopped unexpectedly. Reload the page to get back on the road.',
  reload: 'RELOAD GAME',
  armory: 'ARMORY',
  armoryTitle: 'ROOFTOP ARSENAL',
  armoryDescription: 'Unlock weapons with lifetime XP: +10 per obstacle, +20 per patrol, +25 per loop. XP is never spent.',
  armoryHelp: '1–8 to equip · F to fire · ← / → to aim · Q to turn. Touch buttons work on phones.',
  armoryAmmoNote: 'Ammo is limited per weapon, per run. Switching keeps the remaining rounds; a new run refills them.',
  closeArmory: 'BACK TO ROAD',
  equipped: 'EQUIPPED',
  equip: 'EQUIP',
  unlockAt: 'UNLOCKS AT {xp} XP',
  ammo: 'AMMO',
  power: 'POWER',
  turnTime: 'TURN: {ms} ms',
  aimFront: 'FRONT →',
  aimBack: '← REAR',
  turnWeapon: 'Turn weapon (Q / ← / →)',
  selectWeapon: 'WEAPON',
  fire: 'FIRE',
  fireLabel: 'Hold to fire (F)',
  turning: 'TURNING…',
  weaponReady: 'READY',
  ammoEmpty: 'OUT OF AMMO',
  weapon0: 'Machine gun',
  weapon1: 'Twin gun',
  weapon2: 'Gatling gun',
  weapon3: 'Cannon',
  weapon4: 'Rocket launcher',
  weapon5: 'Missile launcher',
  weapon6: 'Laser gun',
  weapon7: 'Plasma cannon',
} as const;

export type MessageKey = keyof typeof en;

const fa: Record<MessageKey, string> = {
  pageTitle: 'رودستر — رانندگی در شهر',
  sceneLabel: 'بازی رانندگی در شهر با نمای جانبی',
  brand: 'رودستر',
  edition: 'رانندگی در شهر',
  legalCredits: 'حقوق و مجوزها',
  distance: 'مسافت',
  best: 'بهترین رکورد',
  meter: 'متر',
  speed: 'سرعت',
  speedUnit: 'کیلومتر/ساعت',
  boostReserve: 'ذخیرهٔ شتاب',
  boostMeter: 'ذخیرهٔ شتاب: {charge}',
  health: 'سلامت خودرو',
  healthMeter: 'سلامت خودرو: {health}',
  impactNotice: 'برخورد · کاهش {damage} سلامت',
  invincibleNotice: 'محافظت موقت در برابر برخورد',
  carDestroyed: 'خودرو از کار افتاد',
  districtMorning: 'محلهٔ صبحگاهی',
  districtDowntown: 'مرکز شهر',
  districtNight: 'شهر در شب',
  pause: 'مکث بازی',
  pauseTitle: 'مکث (P یا Esc)',
  resume: 'ادامهٔ بازی',
  resumeTitle: 'ادامه (P / Space)',
  mute: 'قطع صدا',
  muteTitle: 'قطع صدا (M)',
  unmute: 'فعال کردن صدا',
  unmuteTitle: 'فعال کردن صدا (M)',
  switchLanguage: 'Switch language to English',
  jump: 'پرش',
  suction: 'مکش',
  boost: 'شتاب',
  jumpGuide: 'پرش / نگه‌داشتن',
  airBoost: 'شتاب',
  spaceKey: 'SPACE',
  shiftKey: 'SHIFT',
  jumpLabel: 'برای پرش بزنید؛ برای پرش بلند نگه دارید؛ برای پرش دوم دوباره بزنید',
  suctionLabel: 'برای مکش و چسبیدن به جاده نگه دارید',
  boostLabel: 'برای شتاب گرفتن روی زمین یا در هوا نگه دارید',
  jumpSummary: 'بزن، نگه دار، دوباره بزن',
  suctionSummary: 'چسبیدن به جاده و عبور از حلقه',
  boostSummary: 'زمین و هوا؛ فرار از پلیس',
  xpLevel: 'سطح {level}',
  xpProgress: 'پیشرفت سطح: {xp} از {target} XP',
  loopReward: 'حلقه کامل شد · +{xp} XP',
  obstacleReward: 'نابودی مانع · +{xp} XP',
  policeReward: 'نابودی پلیس · +{xp} XP',
  xpReward: 'پاداش‌ها · +{xp} XP',
  loopAhead: 'حلقه در پیش است؛ برای ۲۵ XP مکش را نگه دار',
  loopHold: 'مکش را نگه دار تا حلقه کامل شود',
  policeWarning: 'پلیس نزدیک می‌شود؛ شتاب بگیر!',
  policeAhead: 'پلیس جلوتر است؛ مراقب برخورد باش!',
  policeCaught: 'برخورد با پلیس خودرو را از کار انداخت.',
  runXp: '{xp} XP در این دور',
  readyEyebrow: 'شهر، پیست توست',
  readyTitle: 'از افق<br /><em>جلو بزن.</em>',
  readyDescription: 'از شکاف‌ها بپر. برای عبور از حلقه، مکش را نگه دار. با شتاب گرفتن به‌موقع از پلیس فاصله بگیر.',
  start: 'شروع رانندگی',
  readyFoot: 'برای شروع، <bdi lang="en" dir="ltr">Space</bdi> را بزن <span>·</span> قطع صدا با <bdi lang="en" dir="ltr">M</bdi>',
  pausedEyebrow: 'وقت استراحت',
  pausedTitle: 'یک نفس<br /><em>تازه کن.</em>',
  pausedDescription: 'جاده همان‌جایی منتظرت است که توقف کردی.',
  resumeRun: 'ادامهٔ رانندگی',
  pausedFoot: 'برای ادامه، <bdi lang="en" dir="ltr">P</bdi> یا <bdi lang="en" dir="ltr">Space</bdi> را بزن',
  restartIn: '{seconds} ثانیه تا شروع دوباره',
  crashedEyebrow: 'پایان مسیر',
  crashedTitle: 'یک دور<br /><em>دیگر؟</em>',
  crashedDescription: '{distance} متر رانندگی · بهترین رکورد: {best} متر',
  runAgain: 'دوباره بران',
  crashedFoot: 'برای شروع دوباره، <bdi lang="en" dir="ltr">Space</bdi> را بزن <span>·</span> شهر هنوز در حرکت است',
  sideIndex: 'ر // ۰۱',
  sideMotto: 'فراتر از افق بران',
  rotateTitle: 'گوشی را افقی بگیر',
  rotateDescription: 'رودستر برای دیدن مسیر پیش رو به نمای بازتری نیاز دارد.',
  loading: 'در حال آماده‌سازی خودرو',
  bootError: 'رودستر اجرا نشد. برای تلاش دوباره، صفحه را بازخوانی کن.',
  runtimeError: 'بازی ناگهان متوقف شد. صفحه را بازخوانی کن تا دوباره به جاده برگردی.',
  reload: 'اجرای دوبارهٔ بازی',
  armory: 'سلاح‌ها',
  armoryTitle: 'زرادخانهٔ روی سقف',
  armoryDescription: 'سلاح‌ها با XP کل باز می‌شوند: مانع ۱۰، پلیس ۲۰ و لوپ ۲۵ XP؛ امتیاز مصرف نمی‌شود.',
  armoryHelp: 'انتخاب سلاح با ۱ تا ۸ · شلیک با F · هدف‌گیری با ← / → · تغییر جهت با Q؛ روی موبایل از دکمه‌ها استفاده کن.',
  armoryAmmoNote: 'مهمات هر سلاح در هر دور محدود است. تعویض سلاح مهمات را پر نمی‌کند؛ دور جدید همه را پر می‌کند.',
  closeArmory: 'بازگشت به جاده',
  equipped: 'نصب‌شده',
  equip: 'نصب سلاح',
  unlockAt: 'باز شدن با {xp} XP',
  ammo: 'مهمات',
  power: 'قدرت',
  turnTime: 'چرخش: {ms} میلی‌ثانیه',
  aimFront: 'جلو →',
  aimBack: '← عقب',
  turnWeapon: 'تغییر جهت سلاح (Q / ← / →)',
  selectWeapon: 'انتخاب سلاح',
  fire: 'شلیک',
  fireLabel: 'برای شلیک نگه دار (F)',
  turning: 'در حال چرخش…',
  weaponReady: 'آماده',
  ammoEmpty: 'مهمات تمام شد',
  weapon0: 'مسلسل',
  weapon1: 'مسلسل دولول',
  weapon2: 'گاتلینگ',
  weapon3: 'توپ',
  weapon4: 'راکت‌انداز',
  weapon5: 'موشک هدایت‌شونده',
  weapon6: 'لیزر',
  weapon7: 'توپ پلاسما',
};

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem('roadster-language');
    if (saved === 'en' || saved === 'fa') return saved;
  } catch { /* The game also works without browser storage. */ }
  return navigator.language.toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

let language: Language = initialLanguage();
const formatters = new Map<string, Intl.NumberFormat>();

export function getLanguage(): Language { return language; }

export function setLanguage(next: Language): void {
  language = next;
  document.documentElement.lang = next;
  document.documentElement.dir = next === 'fa' ? 'rtl' : 'ltr';
  document.title = t('pageTitle');
  try { localStorage.setItem('roadster-language', next); } catch { /* Optional preference storage. */ }
}

export function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  const message = language === 'fa' ? fa[key] : en[key];
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}

export function formatNumber(value: number, minimumIntegerDigits = 1): string {
  const key = `${language}-${minimumIntegerDigits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(language === 'fa' ? 'fa-IR' : 'en-US', {
      maximumFractionDigits: 0, minimumIntegerDigits, useGrouping: false,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(Math.max(0, Math.floor(value)));
}

export function formatPercent(value: number): string {
  const key = `${language}-percent`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(language === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'percent', maximumFractionDigits: 0, useGrouping: false,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(value);
}

setLanguage(language);
