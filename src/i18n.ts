export type Language = 'en' | 'fa';

const en = {
  pageTitle: 'Roadster — City Runner',
  sceneLabel: 'Side-view city driving game',
  brand: 'ROADSTER',
  edition: 'CITY RUNNER',
  distance: 'DISTANCE',
  best: 'BEST',
  meter: 'm',
  speed: 'SPEED',
  speedUnit: 'KM/H',
  boostReserve: 'BOOST RESERVE',
  boostMeter: 'Boost reserve: {charge}',
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
  airBoost: 'AIR BOOST',
  spaceKey: 'SPACE',
  shiftKey: 'SHIFT',
  jumpLabel: 'Jump; hold for a long jump; tap again for a double jump',
  suctionLabel: 'Hold for suction to stay close to the road',
  boostLabel: 'Hold for air boost',
  jumpSummary: 'Tap, hold, tap again',
  suctionSummary: 'Hold to hug the road',
  boostSummary: 'Extend your air landing',
  readyEyebrow: 'THE CITY IS YOUR TRACK',
  readyTitle: 'OUTRUN<br /><em>THE SKYLINE.</em>',
  readyDescription: 'Read the road. Catch the crest. Jump past the impossible.',
  start: 'START RUN',
  readyFoot: 'SPACE TO START <span>·</span> M TO MUTE SOUND',
  pausedEyebrow: 'RUN ON HOLD',
  pausedTitle: 'TAKE A<br /><em>BREATHER.</em>',
  pausedDescription: 'The road will be right where you left it.',
  resumeRun: 'RESUME RUN',
  pausedFoot: 'PRESS P OR SPACE TO RESUME',
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
} as const;

export type MessageKey = keyof typeof en;

const fa: Record<MessageKey, string> = {
  pageTitle: 'رودستر — رانندگی در شهر',
  sceneLabel: 'بازی رانندگی در شهر با نمای جانبی',
  brand: 'رودستر',
  edition: 'رانندگی در شهر',
  distance: 'مسافت',
  best: 'بهترین رکورد',
  meter: 'متر',
  speed: 'سرعت',
  speedUnit: 'کیلومتر/ساعت',
  boostReserve: 'ذخیرهٔ شتاب',
  boostMeter: 'ذخیرهٔ شتاب: {charge}',
  districtMorning: 'محلهٔ صبحگاهی',
  districtDowntown: 'مرکز شهر',
  districtNight: 'شهر در شب',
  pause: 'مکث بازی',
  pauseTitle: 'مکث (P یا Esc)',
  resume: 'ادامهٔ بازی',
  resumeTitle: 'ادامه (P یا فاصله)',
  mute: 'قطع صدا',
  muteTitle: 'قطع صدا (M)',
  unmute: 'فعال کردن صدا',
  unmuteTitle: 'فعال کردن صدا (M)',
  switchLanguage: 'Switch language to English',
  jump: 'پرش',
  suction: 'مکش',
  boost: 'شتاب',
  jumpGuide: 'پرش / نگه‌داشتن',
  airBoost: 'شتاب در هوا',
  spaceKey: 'فاصله',
  shiftKey: 'شیفت',
  jumpLabel: 'برای پرش بزنید؛ برای پرش بلند نگه دارید؛ برای پرش دوم دوباره بزنید',
  suctionLabel: 'برای مکش و چسبیدن به جاده نگه دارید',
  boostLabel: 'برای شتاب گرفتن در هوا نگه دارید',
  jumpSummary: 'بزن، نگه دار، دوباره بزن',
  suctionSummary: 'نگه دار تا به جاده بچسبی',
  boostSummary: 'در هوا جلوتر برو',
  readyEyebrow: 'شهر، پیست توست',
  readyTitle: 'از افق<br /><em>جلو بزن.</em>',
  readyDescription: 'جاده را بشناس. از بلندی‌ها اوج بگیر. از ناممکن‌ها بپر.',
  start: 'شروع رانندگی',
  readyFoot: 'برای شروع، فاصله را بزن <span>·</span> قطع صدا با M',
  pausedEyebrow: 'وقت استراحت',
  pausedTitle: 'یک نفس<br /><em>تازه کن.</em>',
  pausedDescription: 'جاده همان‌جایی منتظرت است که توقف کردی.',
  resumeRun: 'ادامهٔ رانندگی',
  pausedFoot: 'برای ادامه، P یا فاصله را بزن',
  crashedEyebrow: 'پایان مسیر',
  crashedTitle: 'یک دور<br /><em>دیگر؟</em>',
  crashedDescription: '{distance} متر رانندگی · بهترین رکورد: {best} متر',
  runAgain: 'دوباره بران',
  crashedFoot: 'برای شروع دوباره، فاصله را بزن <span>·</span> شهر هنوز در حرکت است',
  sideIndex: 'ر // ۰۱',
  sideMotto: 'فراتر از افق بران',
  rotateTitle: 'گوشی را افقی بگیر',
  rotateDescription: 'رودستر برای دیدن مسیر پیش رو به نمای بازتری نیاز دارد.',
  loading: 'در حال آماده‌سازی خودرو',
  bootError: 'رودستر اجرا نشد. برای تلاش دوباره، صفحه را بازخوانی کن.',
  runtimeError: 'بازی ناگهان متوقف شد. صفحه را بازخوانی کن تا دوباره به جاده برگردی.',
  reload: 'اجرای دوبارهٔ بازی',
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
