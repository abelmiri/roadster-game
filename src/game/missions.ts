import { emptyMissionStats, type MissionStats } from './missionStats';

export type MissionMetric = keyof MissionStats | 'totalDistance' | 'totalRuns' | 'totalBoxes';
type Copy = { en: string; fa: string };
interface Family { metric: MissionMetric; targets: number[]; title: Copy; description: Copy;
  reward: number; unit?: 'seconds' | 'speed' | 'meters'; weapons?: boolean }
export interface MissionSpec { id: string; metric: MissionMetric; target: number; tier: number;
  title: Copy; description: Copy; reward: number; points: number;
  unit?: Family['unit']; weapons: number; cumulative: boolean }
const copy = (en: string, fa: string): Copy => ({ en, fa });
const families: Family[] = [
  { metric:'forwardFlips',targets:[1,2,3,4,5],title:copy('Front-flip artist','هنرنمایی رو به جلو'),description:copy('Complete {target} forward flips in one run.','در یک دور، {target} فلیپ رو به جلو بزن.'),reward:65 },
  { metric:'backflips',targets:[1,2,3,4,5],title:copy('Backflip club','باشگاه بک‌فلیپ'),description:copy('Complete {target} backflips in one run.','در یک دور، {target} بک‌فلیپ بزن.'),reward:65 },
  { metric:'distance',targets:[250,500,1000,2000,3500,5000,7500,10000],title:copy('Beyond the next block','آن‌طرف خیابان'),description:copy('Drive {target} meters in one run.','در یک دور، {target} متر جلو برو.'),reward:50,unit:'meters' },
  { metric:'maxSpeed',targets:[80,90,100,110,120,130],title:copy('Chasing the speedometer','عقربه را جلو ببر'),description:copy('Reach {target} km/h in one run.','در یک دور، سرعتت را به {target} کیلومتر بر ساعت برسان.'),reward:60,unit:'speed' },
  { metric:'speed80Seconds',targets:[3,5,10,15],title:copy('Stay in the fast lane','تو خط سرعت بمان'),description:copy('Stay above 80 km/h for {target} consecutive seconds.','سرعتت را {target} ثانیهٔ پیوسته بالای ۸۰ کیلومتر بر ساعت نگه دار.'),reward:90,unit:'seconds' },
  { metric:'nightReached',targets:[1],title:copy('Hello, night city','سلام، شهر شب'),description:copy('Keep driving until the night district.','آن‌قدر جلو برو تا به بخش شبانهٔ شهر برسی.'),reward:100 },
  { metric:'nightSeconds',targets:[10,20,40],title:copy('After-dark road trip','شب‌گردی با رودستر'),description:copy('Drive for {target} seconds at night in one run.','در یک دور، {target} ثانیه در شب رانندگی کن.'),reward:120,unit:'seconds' },
  { metric:'roofHits',targets:[1],title:copy('An upside-down goodbye','خداحافظی وارونه'),description:copy('Land on the roof once. This mission counts on the final frame.','یک بار با سقف ماشین به زمین بخور؛ همین پایان وارونه هم جایزه دارد!'),reward:35 },
  { metric:'obstaclesShot',targets:[5,10,15,20],title:copy('Clear the street','خیابان را باز کن'),description:copy('Destroy {target} obstacles with weapons in one run.','در یک دور، {target} مانع را با شلیک منفجر کن.'),reward:80 },
  { metric:'emptyWeapons',targets:[1,2,3,4,5],title:copy('Down to the last round','تا آخرین گلوله'),description:copy('Empty {target} different weapons in one run. Switching does not refill them.','در یک دور، مهمات {target} سلاح متفاوت را تمام کن. تعویض سلاح، مهماتش را پر نمی‌کند.'),reward:70,weapons:true },
  { metric:'policeDestroyed',targets:[1,2,3,4,5],title:copy('End of the chase','پایان تعقیب'),description:copy('Destroy {target} police cars in one run.','در یک دور، {target} ماشین پلیس را منفجر کن.'),reward:110 },
  { metric:'dronesRammed',targets:[1,3,5],title:copy('Bumper versus drone','پهپاد زیر سپر'),description:copy('Ram and destroy {target} drones with your car in one run.','در یک دور، با خود ماشین به {target} پهپاد بکوب و آن‌ها را از بین ببر.'),reward:90 },
  { metric:'boxesOpened',targets:[1,3,5,8],title:copy('Follow the purple trail','رد دود بنفش'),description:copy('Shoot open {target} mystery boxes in one run.','در یک دور، {target} جعبهٔ بنفش را با شلیک باز کن.'),reward:50 },
  { metric:'loops',targets:[1,2,3,5],title:copy('Around the city','دور شهر بچرخ'),description:copy('Complete {target} magnetic loops in one run.','در یک دور، {target} حلقه را با مکش کامل کن.'),reward:70 },
  { metric:'jumps',targets:[5,10,20],title:copy('The road is optional','جاده فقط یک پیشنهاد است'),description:copy('Make {target} first jumps in one run.','در یک دور، {target} بار از روی زمین بپر.'),reward:35 },
  { metric:'doubleJumps',targets:[1,3,8],title:copy('A second chance in midair','فرصت دوم در هوا'),description:copy('Use the double jump {target} times in one run.','در یک دور، {target} بار پرش دوم را در هوا بزن.'),reward:45 },
  { metric:'longestFlight',targets:[1,2,3],title:copy('Permission to fly','اجازهٔ پرواز'),description:copy('Stay airborne for {target} consecutive seconds, outside loops.','بیرون از حلقه‌ها، {target} ثانیهٔ پیوسته در هوا بمان.'),reward:55,unit:'seconds' },
  { metric:'airSeconds',targets:[5,15,30,40],title:copy('Miles above the asphalt','دور از آسفالت'),description:copy('Spend {target} seconds airborne in total during one run.','در یک دور، روی‌هم {target} ثانیه در هوا باش؛ زمان حلقه‌ها حساب نمی‌شود.'),reward:65,unit:'seconds' },
  { metric:'boostSeconds',targets:[3,8,15,20],title:copy('Leave a white trail','رد سفید پشت رودستر'),description:copy('Use boost for {target} seconds in total in one run.','در یک دور، روی‌هم {target} ثانیه بوست بزن.'),reward:50,unit:'seconds' },
  { metric:'cleanDistance',targets:[300,750,1500],title:copy('Keep the paint clean','بدون یک خط‌وخش'),description:copy('Drive the first {target} meters of a run without taking damage.','از شروع یک دور، {target} متر بدون آسیب رانندگی کن.'),reward:85,unit:'meters' },
  { metric:'noFireDistance',targets:[350,700],title:copy('Peaceful roadster','رانندهٔ صلح‌طلب'),description:copy('Drive the first {target} meters without firing.','از شروع یک دور، {target} متر جلو برو و شلیک نکن.'),reward:75,unit:'meters' },
  { metric:'noBoostDistance',targets:[250,500],title:copy('Easy on the throttle','آرام اما پیوسته'),description:copy('Drive the first {target} meters without using boost.','از شروع یک دور، {target} متر بدون بوست جلو برو.'),reward:60,unit:'meters' },
  { metric:'hazardsRammed',targets:[3,6,10],title:copy('The bumper does the talking','سپر حرف می‌زند'),description:copy('Ram and shatter {target} obstacles in one run. A shield or armor helps.','در یک دور، {target} مانع را با خود ماشین خرد کن؛ شیلد و زره به کارت می‌آیند.'),reward:70 },
  { metric:'dronesShot',targets:[3,6],title:copy('Clear skies','آسمان را خلوت کن'),description:copy('Shoot down {target} drones in one run.','در یک دور، {target} پهپاد را با شلیک پایین بیاور.'),reward:85 },
  { metric:'pulsesShot',targets:[3,6],title:copy('Silence the pulse','نبض مانع را بگیر'),description:copy('Destroy {target} pulse obstacles with weapons in one run.','در یک دور، {target} مانع ضربانی را با شلیک از بین ببر.'),reward:85 },
  { metric:'rampBoosts',targets:[1,3,5,7,9],title:copy('Launch-pad collector','سکوی پرتاب بعدی کجاست؟'),description:copy('Ride over {target} fresh ramp booster pads in one run.','در یک دور، از روی {target} نوار بوست رمپ عبور کن؛ هر نوار یک بار حساب می‌شود.'),reward:100 },
  { metric:'totalDistance',targets:[1000,5000,10000,25000,50000],title:copy('A city full of stories','یک شهر خاطره'),description:copy('Drive {target} meters across all your runs.','در مجموع دورهایت، {target} متر رانندگی کن.'),reward:100,unit:'meters' },
  { metric:'totalRuns',targets:[5,15,30],title:copy('Back behind the wheel','دوباره پشت فرمان'),description:copy('Finish {target} runs in total.','روی‌هم {target} دور بازی را به پایان برسان.'),reward:75 },
  { metric:'totalBoxes',targets:[10,25,50,100],title:copy('Purple-box treasure hunter','گنج‌یاب بنفش'),description:copy('Open {target} mystery boxes across all runs.','در مجموع دورهایت، {target} جعبهٔ بنفش را باز کن.'),reward:100 },
  { metric:'ragdollsShot',targets:[1,2,3],title:copy('Pinpoint practice','نشانه‌گیری دقیق'),description:copy('Hit {target} different mannequins with your weapon in one run.','در یک دور، به {target} آدمک متفاوت با سلاح شلیک کن.'),reward:70 },
  { metric:'ragdollsRammed',targets:[1,2,3],title:copy('Bumper-car ballet','رقص سپرها'),description:copy('Bump into {target} different mannequins with your car in one run.','در یک دور، با ماشین به {target} آدمک متفاوت برخورد کن.'),reward:70 },
  { metric:'ragdollMix',targets:[1,2,3],title:copy('Shot and sent flying','اول نشانه، بعد برخورد'),description:copy('In one run, shoot mannequins and hit them with your car; complete {target} shot-and-ram pairs.','در یک دور هم به آدمک‌ها شلیک کن و هم با ماشین به آن‌ها برخورد کن؛ {target} جفت شلیک و برخورد کامل کن.'),reward:95 },
  { metric:'airBoxesOpened',targets:[1,2],title:copy('Catch the floating crate','جعبهٔ معلق را بگیر'),description:copy('Shoot open {target} airborne mystery boxes in one run.','در یک دور، {target} جعبهٔ معلق را با شلیک باز کن.'),reward:80 },
  { metric:'shots',targets:[10,20,35],title:copy('A few rounds to spare','چند تیر برای جاده'),description:copy('Fire {target} rounds in one run. Any weapon counts.','در یک دور {target} گلوله شلیک کن؛ نوع سلاح فرقی ندارد.'),reward:45 },
];

export const MISSIONS: readonly MissionSpec[] = families.flatMap(family => family.targets.map((target, index) => ({
  id: `${family.metric}-${target}`, metric: family.metric, target, tier: index + 1,
  title: family.title, description: family.description, unit: family.unit,
  reward: family.reward + index * Math.ceil(family.reward * .65), points: 10 * (index + 1),
  weapons: family.weapons ? target : 1, cumulative: family.metric.startsWith('total'),
})));
const catalog = new Map(MISSIONS.map(mission => [mission.id, mission]));
export interface ActiveMission { id: string; progress: number; best: number; readyAt?: number; readyValue?: number }
export interface CompletedMission { id: string; at: number; value: number; coins: number; points: number }
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
type MissionSave = { active?: unknown; completed?: unknown; seed?: unknown; draws?: unknown; totals?: unknown };

/** Finished goals hold their slots until collected, including across reloads
 * and new runs. Collected slots refill on the next run. */
export class MissionProgress {
  active: ActiveMission[] = [];
  completed: CompletedMission[] = [];
  totals = { totalDistance: 0, totalRuns: 0, totalBoxes: 0 };
  private seed = Math.floor(Math.random() * 1e9);
  private draws = 0;
  private running = false;
  private previousDistance = 0;
  private previousBoxes = 0;
  revision = 0;

  restore(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const save = raw as MissionSave;
    const completed = new Set<string>();
    if (Array.isArray(save.completed)) for (const record of save.completed) {
      if (!record || !catalog.has(record.id) || completed.has(record.id)) continue;
      completed.add(record.id);
      const spec = catalog.get(record.id)!;
      this.completed.push({ id: record.id, at: valid(record.at) ? record.at : 0,
        value: valid(record.value) ? Math.max(spec.target, record.value) : spec.target,
        coins: Number.isSafeInteger(record.coins) && record.coins >= 0 ? record.coins : spec.reward,
        points: Number.isSafeInteger(record.points) && record.points >= 0 ? record.points : spec.points });
    }
    if (Array.isArray(save.active)) for (const record of save.active) {
      const spec = record && catalog.get(record.id);
      if (!spec || completed.has(record.id) || this.active.some(item => item.id === record.id) || this.active.length >= 3) continue;
      const progress = valid(record.progress) ? Math.min(spec.target, record.progress) : 0;
      this.active.push({ id: spec.id, progress, best: valid(record.best) ? Math.max(progress, Math.min(spec.target, record.best)) : progress,
        ...(progress >= spec.target ? { readyAt: valid(record.readyAt) ? record.readyAt : 0,
          readyValue: valid(record.readyValue) ? Math.max(spec.target, record.readyValue) : spec.target } : {}) });
    }
    if (valid(save.seed)) this.seed = Math.floor(save.seed) % 1e9;
    if (valid(save.draws)) this.draws = Math.floor(save.draws);
    if (save.totals && typeof save.totals === 'object') for (const key of Object.keys(this.totals) as (keyof typeof this.totals)[]) {
      const value = (save.totals as Record<string, unknown>)[key];
      if (valid(value)) this.totals[key] = value;
    }
  }

  fillSlots(weaponCount: number): void {
    const done = new Set(this.completed.map(item => item.id));
    const familiesInUse = new Set(this.active.map(item => catalog.get(item.id)!.metric));
    while (this.active.length < 3) {
      const frontier = MISSIONS.filter(spec => !done.has(spec.id) && !familiesInUse.has(spec.metric) && spec.weapons <= weaponCount &&
        !MISSIONS.some(earlier => earlier.metric === spec.metric && earlier.tier < spec.tier && !done.has(earlier.id)));
      if (!frontier.length) break;
      const wave = 1 + Math.floor(this.completed.length / 12);
      const easy = frontier.filter(spec => spec.tier <= wave);
      const pool = easy.length ? easy : frontier;
      const starter = this.completed.length === 0 ? ['boxesOpened-1','jumps-5','distance-250'][this.active.length] : undefined;
      const ticket = Math.sin(this.seed + ++this.draws * 127.1) * 43758.5453;
      const selected = pool.find(spec => spec.id === starter) ?? pool[Math.floor((ticket - Math.floor(ticket)) * pool.length)];
      this.active.push({ id: selected.id, progress: 0, best: 0 });
      familiesInUse.add(selected.metric); this.revision++;
    }
  }

  beginRun(weaponCount: number): void {
    this.running = true; this.previousDistance = this.previousBoxes = 0;
    for (const active of this.active) {
      const spec = catalog.get(active.id)!;
      if (!spec.cumulative && active.progress < spec.target) active.progress = 0;
    }
    this.fillSlots(weaponCount); this.revision++;
  }

  update(stats: MissionStats, finished = false, at = Date.now()): MissionSpec[] {
    if (!this.running) return [];
    const read = (key: keyof MissionStats): number => valid(stats[key]) ? stats[key] : 0;
    const distance = read('distance'); const boxes = read('boxesOpened');
    const distanceGain = Math.max(0, distance - this.previousDistance);
    const boxGain = Math.max(0, boxes - this.previousBoxes);
    this.totals.totalDistance += distanceGain;
    this.totals.totalBoxes += boxGain;
    if (distanceGain || boxGain || finished) this.revision++;
    this.previousDistance = Math.max(this.previousDistance, distance); this.previousBoxes = Math.max(this.previousBoxes, boxes);
    if (finished) { this.totals.totalRuns++; this.running = false; }
    const ready: MissionSpec[] = [];
    for (const active of this.active) {
      const spec = catalog.get(active.id)!;
      if (active.progress >= spec.target) continue;
      const value = spec.cumulative ? this.totals[spec.metric as keyof typeof this.totals] : read(spec.metric as keyof MissionStats);
      const progress = Math.min(spec.target, Math.max(active.progress, value));
      if (progress !== active.progress) { active.progress = progress; active.best = Math.max(active.best, progress); this.revision++; }
      if (value + 1e-7 >= spec.target) {
        active.progress = active.best = spec.target;
        active.readyAt = at; active.readyValue = value;
        ready.push(spec); this.revision++;
      }
    }
    return ready;
  }

  collect(id: string): MissionSpec | null {
    const active = this.active.find(item => item.id === id);
    const spec = catalog.get(id);
    if (!active || !spec || active.progress < spec.target || this.completed.some(item => item.id === id)) return null;
    this.completed.push({ id, at: active.readyAt ?? 0, value: active.readyValue ?? spec.target, coins: spec.reward, points: spec.points });
    this.active = this.active.filter(item => item.id !== id);
    this.revision++;
    return spec;
  }

  get score(): number { return this.completed.reduce((sum, record) => sum + record.points, 0); }
  get earnedCoins(): number { return this.completed.reduce((sum, record) => sum + record.coins, 0); }
  save(): object { return { version: 2, active: this.active, completed: this.completed, totals: this.totals, seed: this.seed, draws: this.draws }; }
}

export function missionSpec(id: string): MissionSpec | undefined { return catalog.get(id); }
export function blankMissionStats(): MissionStats { return emptyMissionStats(); }
