import { parseUnits } from 'ethers';

export const DECIMALS = 18;
export const DAY = 86400;

export type Step = { unlockTime: bigint; amount: bigint };

/**
 * Step i unlocks at chainNow + (firstUnlockInDays + i*intervalDays) days.
 * Each step gets totalAmount / steps; the last step takes the remainder so the sum is exact.
 */
export function buildSteps(p: {
  chainNow: number;
  totalAmount: string;
  steps: number;
  intervalDays: number;
  firstUnlockInDays: number;
}): { total: bigint; steps: Step[] } {
  const total = parseUnits(p.totalAmount, DECIMALS);
  const n = BigInt(p.steps);
  const per = total / n;
  const steps = Array.from({ length: p.steps }, (_, i) => ({
    unlockTime: BigInt(p.chainNow + (p.firstUnlockInDays + i * p.intervalDays) * DAY),
    amount: i === p.steps - 1 ? total - per * (n - 1n) : per,
  }));
  return { total, steps };
}

/** A custom schedule as sent by the client (human amounts) → contract Step[]; order and values kept exactly as sent. */
export function scheduleToSteps(schedule: { unlockTime: number; amount: string }[]): Step[] {
  return schedule.map((s) => ({ unlockTime: BigInt(s.unlockTime), amount: parseUnits(s.amount, DECIMALS) }));
}
