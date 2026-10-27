export const BOX_POWER_SECONDS = 20;
export const SHIELD_BLINK_SECONDS = 3;
export interface RandomBoxSpec { id: string; x: number; y: number; airborne: boolean; phase: number }
export type BoxReward = { kind: 'coins'; amount: number } | { kind: 'xp'; amount: number }
  | { kind: 'shield'; seconds: number } | { kind: 'boost'; seconds: number }
  | { kind: 'health' } | { kind: 'ammo' };
export interface BoxRewardEvent {
  serial: number; boxId: string; x: number; y: number; airborne: boolean; phase: number; reward: BoxReward; age: number;
}
export const BOX_REWARDS: ReadonlyArray<{ reward: BoxReward; weight: number }> = [
  { reward: { kind: 'coins', amount: 20 }, weight: 24 },
  { reward: { kind: 'coins', amount: 50 }, weight: 17 },
  { reward: { kind: 'coins', amount: 100 }, weight: 9 },
  { reward: { kind: 'coins', amount: 200 }, weight: 3 },
  { reward: { kind: 'shield', seconds: BOX_POWER_SECONDS }, weight: 14 },
  { reward: { kind: 'boost', seconds: BOX_POWER_SECONDS }, weight: 14 },
  { reward: { kind: 'health' }, weight: 6 },
  { reward: { kind: 'ammo' }, weight: 6 },
  { reward: { kind: 'xp', amount: 100 }, weight: 4 },
  { reward: { kind: 'xp', amount: 250 }, weight: 2 },
  { reward: { kind: 'xp', amount: 500 }, weight: 1 },
];

export function rollBoxReward(random = Math.random()): BoxReward {
  let ticket = Math.max(0, Math.min(1 - Number.EPSILON, Number.isFinite(random) ? random : 0)) * 100;
  for (const { reward, weight } of BOX_REWARDS) {
    ticket -= weight;
    if (ticket < 0) return { ...reward };
  }
  return { ...BOX_REWARDS[BOX_REWARDS.length - 1].reward };
}

export function shieldVisible(remaining: number): boolean {
  return remaining > 0 && (remaining > SHIELD_BLINK_SECONDS || Math.floor((SHIELD_BLINK_SECONDS - remaining) * 8) % 2 === 0);
}

/** Run-scoped opened IDs and cumulative rewards survive chunk reloads and skipped frames. */
export class RandomBoxRewards {
  readonly opened = new Set<string>();
  readonly events: BoxRewardEvent[] = [];
  serial = 0;
  coins = 0;
  xp = 0;
  shieldRemaining = 0;
  boostRemaining = 0;

  constructor(private readonly random = Math.random) {}

  open(box: RandomBoxSpec, available: { health?: boolean; ammo?: boolean } = {}): BoxReward | null {
    if (this.opened.has(box.id)) return null;
    this.opened.add(box.id);
    const rolled = rollBoxReward(this.random());
    const unusable = (rolled.kind === 'health' && available.health === false) ||
      (rolled.kind === 'ammo' && available.ammo === false);
    const reward: BoxReward = unusable ? { kind: 'coins', amount: 20 } : rolled;
    if (reward.kind === 'coins') this.coins += reward.amount;
    else if (reward.kind === 'xp') this.xp += reward.amount;
    else if (reward.kind === 'shield') this.shieldRemaining = reward.seconds;
    else if (reward.kind === 'boost') this.boostRemaining = reward.seconds;
    this.events.push({ serial: ++this.serial, boxId: box.id, x: box.x, y: box.y,
      airborne: box.airborne, phase: box.phase, reward, age: 0 });
    if (this.events.length > 24) this.events.shift();
    return reward;
  }

  step(dt: number): void {
    const tick = (remaining: number): number => remaining - dt < 1e-9 ? 0 : remaining - dt;
    this.shieldRemaining = tick(this.shieldRemaining);
    this.boostRemaining = tick(this.boostRemaining);
    for (const event of this.events) event.age += dt;
    while (this.events.length && this.events[0].age > 3) this.events.shift();
  }
}
