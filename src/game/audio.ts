import type { GameSnapshot } from './physics';

export type SoundEvent = 'start' | 'resume' | 'pause' | 'jump' | 'doubleJump' | 'land' |
  'crash' | 'impact' | 'click' | 'district' | 'record' | 'warning' |
  'shot' | 'heavyShot' | 'rocketShot' | 'laserShot' | 'plasmaShot' | 'weaponHit' | 'explosion';

interface SoundLoops {
  motor: GainNode;
  motorPitch: OscillatorNode;
  motorOvertone: OscillatorNode;
  motorFilter: BiquadFilterNode;
  tires: GainNode;
  tireFilter: BiquadFilterNode;
  wind: GainNode;
  windFilter: BiquadFilterNode;
  boost: GainNode;
  boostFilter: BiquadFilterNode;
  suction: GainNode;
  fanPitch: OscillatorNode;
  siren: GainNode;
  sirenPitch: OscillatorNode;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const STORAGE_KEY = 'roadster-muted';
const MENU_MELODY = [72, 0, 76, 79, 76, 0, 74, 72,
  71, 0, 74, 79, 74, 0, 71, 74,
  72, 0, 76, 81, 79, 76, 0, 72,
  69, 0, 72, 77, 76, 72, 69, 0];
const MENU_CHORDS = [[60, 64, 67, 72], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65]];
const MENU_BASS = [36, 43, 45, 41];

/** Original, synthesised game audio. No downloads or decoding delay are needed.
 * A small persistent graph supplies the electric drive and air textures; action
 * sounds use short, disposable voices. The context is created only after input.
 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private loops: SoundLoops | null = null;
  private menuMusicGain: GainNode | null = null;
  private menuMusicTimer: ReturnType<typeof setInterval> | null = null;
  private menuMusicActive = false;
  private menuMusicStep = 0;
  private menuMusicNextTime = 0;
  private readonly loopSources: AudioScheduledSourceNode[] = [];
  private readonly voices = new Set<AudioScheduledSourceNode>();
  private readonly parameterTargets = new WeakMap<AudioParam, number>();
  private silent = false;
  private disposed = false;
  private running = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLoopUpdate = -Infinity;
  private jumpSerial = 0;
  private landingSerial = 0;
  private lastWarning = -Infinity;
  private shotSerial = 0;
  private hitSerial = 0;
  private destroySerial = 0;

  constructor() {
    try { this.silent = localStorage.getItem(STORAGE_KEY) === 'true'; } catch { /* Private browsing can deny storage. */ }
  }

  get muted(): boolean { return this.silent; }

  /** Must be called from a pointer or keyboard event, including on Safari. */
  async unlock(): Promise<void> {
    if (this.disposed) return;
    this.cancelSuspend();
    try {
      if (!this.context) this.createGraph();
      if (this.context?.state === 'suspended') await this.context.resume();
      // A short silent buffer also unlocks older iOS Web Audio implementations.
      if (this.context && this.master) {
        const source = this.context.createBufferSource();
        source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
        source.connect(this.master);
        source.onended = () => source.disconnect();
        source.start();
      }
      if (this.menuMusicActive) this.startMenuMusic();
    } catch {
      // Audio restrictions or unavailable hardware must never interrupt a run.
    }
  }

  toggleMuted(): boolean {
    this.silent = !this.silent;
    try { localStorage.setItem(STORAGE_KEY, String(this.silent)); } catch { /* Storage is optional. */ }
    if (this.master && this.context) this.target(this.master.gain, this.silent ? 0 : 0.62, 0.035);
    return this.silent;
  }

  /** Chiptune loop for menus and pause screens; it is muted during gameplay. */
  setMenuMusic(active: boolean): void {
    if (this.disposed) return;
    this.menuMusicActive = active;
    if (!active) {
      if (this.menuMusicTimer !== null) clearInterval(this.menuMusicTimer);
      this.menuMusicTimer = null;
      if (this.context && this.menuMusicGain) this.target(this.menuMusicGain.gain, 0, 0.07);
      return;
    }
    this.cancelSuspend();
    if (!this.context) return;
    if (this.context.state === 'suspended') {
      void this.context.resume().then(() => this.startMenuMusic()).catch(() => {});
    } else this.startMenuMusic();
  }

  private startMenuMusic(): void {
    if (!this.menuMusicActive || !this.context || !this.menuMusicGain || this.context.state !== 'running') return;
    this.cancelSuspend();
    this.target(this.menuMusicGain.gain, 0.14, 0.12);
    if (this.menuMusicTimer !== null) return;
    this.menuMusicNextTime = this.context.currentTime + 0.04;
    this.menuMusicTimer = setInterval(() => this.scheduleMenuMusic(), 80);
  }

  private scheduleMenuMusic(): void {
    if (!this.menuMusicActive || !this.context || this.context.state !== 'running') return;
    const beat = 60 / 98 / 2;
    const horizon = this.context.currentTime + 0.18;
    while (this.menuMusicNextTime < horizon) {
      const step = this.menuMusicStep % MENU_MELODY.length;
      const bar = Math.floor(step / 8);
      const position = step % 8;
      const lead = MENU_MELODY[step];
      if (position === 0) {
        for (const note of MENU_CHORDS[bar]) {
          this.scheduleMenuTone(note, this.menuMusicNextTime, beat * 7.6, 'sine', 0.012, 0.12);
        }
        this.scheduleMenuTone(MENU_BASS[bar], this.menuMusicNextTime, beat * 5.8, 'triangle', 0.064);
      }
      if (position === 4) this.scheduleMenuTone(MENU_BASS[bar] + 7, this.menuMusicNextTime, beat * 3.2, 'triangle', 0.038);
      if (lead) this.scheduleMenuTone(lead, this.menuMusicNextTime, beat * (position % 2 ? 0.62 : 0.78), 'triangle', 0.038);
      if (position === 6 && lead) this.scheduleMenuTone(lead + 12, this.menuMusicNextTime, beat * 0.32, 'sine', 0.012);
      this.menuMusicStep++;
      this.menuMusicNextTime += beat;
    }
  }

  private scheduleMenuTone(note: number, at: number, duration: number, type: OscillatorType, volume: number, attack = 0.008): void {
    const context = this.context;
    if (!context || !this.menuMusicGain) return;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(440 * 2 ** ((note - 69) / 12), at);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + Math.min(attack, duration * 0.4));
    envelope.gain.setValueAtTime(volume, at + duration * 0.72);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope);
    envelope.connect(this.menuMusicGain);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(at);
    oscillator.stop(at + duration + 0.015);
  }

  private createGraph(): void {
    const AudioContextClass = globalThis.AudioContext ??
      (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass({ latencyHint: 'interactive' });
    this.context = context;
    const master = context.createGain();
    master.gain.value = this.silent ? 0 : 0.62;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -17;
    limiter.knee.value = 14;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.006;
    limiter.release.value = 0.16;
    master.connect(limiter);
    limiter.connect(context.destination);
    this.master = master;
    const menuMusicGain = context.createGain();
    menuMusicGain.gain.value = 0;
    menuMusicGain.connect(master);
    const menuDelay = context.createDelay(0.6);
    menuDelay.delayTime.value = 0.22;
    const delayFilter = context.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 2600;
    const delayReturn = context.createGain();
    delayReturn.gain.value = 0.18;
    const delayFeedback = context.createGain();
    delayFeedback.gain.value = 0.16;
    menuMusicGain.connect(menuDelay);
    menuDelay.connect(delayFilter);
    delayFilter.connect(delayReturn);
    delayReturn.connect(master);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(menuDelay);
    this.menuMusicGain = menuMusicGain;

    const noise = context.createBuffer(1, Math.ceil(context.sampleRate * 3), context.sampleRate);
    const samples = noise.getChannelData(0);
    let previous = 0;
    // Slightly correlated noise gives the road and wind a softer texture.
    for (let index = 0; index < samples.length; index++) {
      previous = previous * 0.3 + (Math.random() * 2 - 1) * 0.7;
      samples[index] = previous;
    }
    this.noise = noise;

    const gain = (): GainNode => {
      const node = context.createGain();
      node.gain.value = 0;
      node.connect(master);
      return node;
    };
    const filter = (type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode => {
      const node = context.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = q;
      return node;
    };
    const noiseLoop = (output: AudioNode, offset: number): void => {
      const node = context.createBufferSource();
      node.buffer = noise;
      node.loop = true;
      node.connect(output);
      node.start(0, offset);
      this.loopSources.push(node);
    };
    const oscillator = (type: OscillatorType, frequency: number, output: AudioNode): OscillatorNode => {
      const node = context.createOscillator();
      node.type = type;
      node.frequency.value = frequency;
      node.connect(output);
      node.start();
      this.loopSources.push(node);
      return node;
    };

    const motor = gain();
    const motorFilter = filter('lowpass', 530);
    motorFilter.connect(motor);
    const motorPitch = oscillator('triangle', 80, motorFilter);
    const overtoneLevel = context.createGain();
    overtoneLevel.gain.value = 0.16;
    overtoneLevel.connect(motorFilter);
    const motorOvertone = oscillator('sawtooth', 160, overtoneLevel);

    const tires = gain();
    const tireFilter = filter('bandpass', 650, 0.45);
    tireFilter.connect(tires);
    noiseLoop(tireFilter, 0);
    const wind = gain();
    const windFilter = filter('lowpass', 900, 0.4);
    windFilter.connect(wind);
    noiseLoop(windFilter, 0.79);
    const boost = gain();
    const boostFilter = filter('bandpass', 1900, 0.6);
    boostFilter.connect(boost);
    noiseLoop(boostFilter, 1.47);
    const suction = gain();
    const suctionFilter = filter('lowpass', 440, 0.5);
    suctionFilter.connect(suction);
    noiseLoop(suctionFilter, 2.19);
    const fanLevel = context.createGain();
    fanLevel.gain.value = 0.24;
    fanLevel.connect(suctionFilter);
    const fanPitch = oscillator('triangle', 135, fanLevel);
    const siren = gain();
    const sirenPitch = oscillator('sine', 650, siren);

    this.loops = { motor, motorPitch, motorOvertone, motorFilter, tires, tireFilter,
      wind, windFilter, boost, boostFilter, suction, fanPitch, siren, sirenPitch };
  }

  private target(parameter: AudioParam, value: number, smoothing = 0.07): void {
    if (!this.context || this.parameterTargets.get(parameter) === value) return;
    this.parameterTargets.set(parameter, value);
    parameter.setTargetAtTime(value, this.context.currentTime, smoothing);
  }

  update(snapshot: GameSnapshot, running: boolean): void {
    if (this.disposed) return;
    // Serials survive skipped display frames, so short takeoffs and landings
    // still produce exactly one sound with a variable display refresh rate.
    if (running && !snapshot.crashed) {
      const weapon = snapshot.weapon;
      if (weapon && weapon.shotSerial > this.shotSerial) {
        this.play(weapon.id === 'plasma-cannon' ? 'plasmaShot' : weapon.id === 'laser-gun' ? 'laserShot'
          : weapon.id.includes('launcher') ? 'rocketShot' : weapon.id === 'cannon' ? 'heavyShot' : 'shot');
      }
      if (weapon && weapon.destroySerial > this.destroySerial) this.play('explosion');
      else if (weapon && weapon.hitSerial > this.hitSerial) this.play('weaponHit');
      if (snapshot.jumpSerial !== this.jumpSerial) {
        this.play(snapshot.jumpsUsed > 1 ? 'doubleJump' : 'jump');
      }
      if (snapshot.landingSerial !== this.landingSerial) {
        this.play('land', clamp(snapshot.landingImpact, 0.2, 1));
      }
    }
    this.jumpSerial = snapshot.jumpSerial;
    this.landingSerial = snapshot.landingSerial;
    this.shotSerial = snapshot.weapon?.shotSerial ?? 0;
    this.hitSerial = snapshot.weapon?.hitSerial ?? 0;
    this.destroySerial = snapshot.weapon?.destroySerial ?? 0;

    if (!running || snapshot.crashed) {
      if (this.running) this.suspend();
      return;
    }
    this.running = true;
    if (!this.context || !this.loops || this.context.state !== 'running') return;
    // Avoid unnecessary control-rate automation on 120/144 Hz displays.
    const now = this.context.currentTime;
    if (now - this.lastLoopUpdate < 1 / 30) return;
    this.lastLoopUpdate = now;
    const speed = clamp(snapshot.speed / 23, 0, 1);
    const motorFrequency = 48 + speed * 128 + (snapshot.boostActive ? 24 : 0);
    const loops = this.loops;
    this.target(loops.motor.gain, 0.032 + speed * 0.026);
    this.target(loops.motorPitch.frequency, motorFrequency, 0.12);
    this.target(loops.motorOvertone.frequency, motorFrequency * 2.015, 0.12);
    this.target(loops.motorFilter.frequency, 230 + speed * 740, 0.12);
    this.target(loops.tires.gain, snapshot.grounded ? 0.013 + speed * 0.042 : 0, 0.09);
    this.target(loops.tireFilter.frequency, 300 + speed * 1050, 0.12);
    this.target(loops.wind.gain, speed * speed * (snapshot.grounded ? 0.038 : 0.065), 0.15);
    this.target(loops.windFilter.frequency, 420 + speed * 1350, 0.15);
    this.target(loops.boost.gain, snapshot.boostActive ? 0.16 : 0, 0.055);
    this.target(loops.boostFilter.frequency, 1100 + speed * 2100, 0.10);
    this.target(loops.suction.gain, snapshot.suctionActive ? 0.11 : 0, 0.065);
    this.target(loops.fanPitch.frequency, 110 + speed * 120, 0.12);
    this.target(loops.siren.gain, snapshot.police.pressure * 0.095, 0.18);
    this.target(loops.sirenPitch.frequency, 760 + Math.sin(now * 5.5) * 230, 0.035);
  }

  play(event: SoundEvent, strength = 1): void {
    if (!this.context || !this.master || this.context.state !== 'running' || this.silent || this.disposed) return;
    const now = this.context.currentTime;
    const level = clamp(strength, 0.1, 1);
    switch (event) {
      case 'start':
        this.tone(294, 440, 0.14, 0.10, 0, 'triangle');
        this.tone(440, 587, 0.18, 0.09, 0.09, 'triangle');
        this.tone(587, 880, 0.25, 0.065, 0.18, 'triangle');
        break;
      case 'resume':
        this.tone(392, 587, 0.16, 0.08, 0, 'triangle');
        this.tone(587, 784, 0.17, 0.06, 0.10, 'triangle');
        break;
      case 'pause':
        this.tone(440, 294, 0.19, 0.065, 0, 'triangle');
        break;
      case 'click':
        this.tone(630, 830, 0.065, 0.06, 0, 'triangle');
        break;
      case 'jump':
        this.burst(0.18, 0.11, 420, 2300, 'bandpass', 0.65);
        this.tone(180, 510, 0.21, 0.07, 0, 'triangle');
        break;
      case 'doubleJump':
        this.burst(0.22, 0.12, 850, 3400, 'bandpass', 0.9);
        this.tone(350, 900, 0.25, 0.075, 0, 'triangle');
        this.tone(700, 1350, 0.18, 0.032, 0.025, 'triangle');
        break;
      case 'land':
        // A short body thump and softened tire contact; small bumps stay quiet.
        this.tone(100, 44, 0.19, 0.13 * level, 0, 'sine');
        this.burst(0.13, 0.17 * level, 1100, 260, 'lowpass', 0.65);
        break;
      case 'crash':
        this.burst(0.64, 0.33, 3000, 180, 'lowpass', 0.65);
        this.tone(110, 29, 0.52, 0.18, 0, 'triangle');
        this.tone(220, 64, 0.30, 0.045, 0.035, 'sawtooth');
        break;
      case 'impact':
        this.burst(0.28, 0.31, 3200, 320, 'lowpass', 0.8);
        this.tone(150, 38, 0.27, 0.18, 0, 'triangle');
        this.tone(710, 170, 0.16, 0.06, 0.012, 'sawtooth');
        break;
      case 'shot':
        this.burst(.075, .12, 4200, 900, 'bandpass', .7);
        this.tone(180, 65, .075, .055, 0, 'triangle');
        break;
      case 'heavyShot':
        this.burst(.24, .20, 1900, 160, 'lowpass', .8);
        this.tone(125, 32, .26, .12, 0, 'triangle');
        break;
      case 'rocketShot':
        this.burst(.30, .15, 450, 2400, 'bandpass', .55);
        this.tone(170, 70, .18, .06, 0, 'triangle');
        break;
      case 'laserShot':
        this.tone(1600, 480, .12, .075, 0, 'sine');
        this.tone(2400, 800, .08, .025, 0, 'triangle');
        break;
      case 'plasmaShot':
        this.tone(420, 65, .30, .12, 0, 'triangle');
        this.tone(840, 130, .23, .055, .015, 'sine');
        this.burst(.20, .10, 1700, 300, 'bandpass', 1.4);
        break;
      case 'weaponHit':
        this.burst(.09, .075, 2900, 700, 'highpass', .6);
        break;
      case 'explosion':
        this.burst(.40, .20, 2200, 120, 'lowpass', .7);
        this.tone(100, 26, .35, .10, 0, 'triangle');
        break;
      case 'district':
        this.tone(523, 523, 0.25, 0.04, 0, 'triangle');
        this.tone(659, 659, 0.30, 0.035, 0.085, 'triangle');
        this.tone(784, 784, 0.40, 0.03, 0.17, 'triangle');
        break;
      case 'record':
        [523, 659, 784, 1047].forEach((frequency, index) => {
          this.tone(frequency, frequency * 1.003, 0.29, 0.065, index * 0.095, 'triangle');
        });
        break;
      case 'warning':
        if (now - this.lastWarning < 0.8) return;
        this.lastWarning = now;
        this.tone(740, 620, 0.09, 0.045, 0, 'triangle');
        this.tone(740, 620, 0.09, 0.035, 0.14, 'triangle');
        break;
    }
  }

  private tone(from: number, to: number, duration: number, volume: number, delay: number,
    waveform: OscillatorType): void {
    const context = this.context;
    if (!context || !this.master) return;
    const start = context.currentTime + delay;
    const source = context.createOscillator();
    source.type = waveform;
    source.frequency.setValueAtTime(from, start);
    source.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration * 0.9);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume, start + 0.009);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = waveform === 'sawtooth' ? 800 : 4500;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    this.voices.add(source);
    source.onended = () => {
      source.disconnect(); filter.disconnect(); envelope.disconnect();
      this.voices.delete(source);
    };
    source.start(start);
    source.stop(start + duration + 0.025);
  }

  private burst(duration: number, volume: number, from: number, to: number,
    type: BiquadFilterType, q: number): void {
    const context = this.context;
    if (!context || !this.master || !this.noise) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, now);
    filter.frequency.exponentialRampToValueAtTime(to, now + duration);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(volume, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    this.voices.add(source);
    source.onended = () => {
      source.disconnect(); filter.disconnect(); envelope.disconnect();
      this.voices.delete(source);
    };
    source.start(now, Math.random() * (3 - duration));
    source.stop(now + duration + 0.025);
  }

  /** Fade drive loops while allowing pause and crash tails to finish. */
  suspend(): void {
    this.running = false;
    this.lastLoopUpdate = -Infinity;
    if (this.loops) {
      for (const name of ['motor', 'tires', 'wind', 'boost', 'suction', 'siren'] as const) {
        this.target(this.loops[name].gain, 0, 0.035);
      }
    }
    this.cancelSuspend();
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (!this.running && !this.menuMusicActive && this.context?.state === 'running') void this.context.suspend().catch(() => {});
    }, 850);
  }

  private cancelSuspend(): void {
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }

  reset(): void {
    this.setMenuMusic(false);
    this.suspend();
    this.jumpSerial = 0;
    this.landingSerial = 0;
    this.lastWarning = -Infinity;
    this.shotSerial = this.hitSerial = this.destroySerial = 0;
    for (const voice of this.voices) {
      try { voice.stop(); } catch { /* A voice may have ended between frames. */ }
    }
    this.voices.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
    this.cancelSuspend();
    for (const source of this.loopSources) {
      try { source.stop(); } catch { /* Already closed. */ }
      source.disconnect();
    }
    this.loopSources.length = 0;
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.loops = null;
    this.noise = null;
  }
}
