import { formatUnits, parseUnits } from 'ethers';
import { buildSteps, DAY, scheduleToSteps } from './steps';

describe('buildSteps', () => {
  it('gives the remainder to the last step so the sum is exact', () => {
    const { total, steps } = buildSteps({ chainNow: 0, totalAmount: '1000', steps: 3, intervalDays: 30, firstUnlockInDays: 0 });
    expect(steps.map((s) => formatUnits(s.amount, 18))).toEqual([
      '333.333333333333333333',
      '333.333333333333333333',
      '333.333333333333333334',
    ]);
    expect(steps.reduce((a, s) => a + s.amount, 0n)).toBe(total);
    expect(total).toBe(parseUnits('1000', 18));
  });

  it('splits evenly when divisible', () => {
    const { steps } = buildSteps({ chainNow: 0, totalAmount: '1200', steps: 12, intervalDays: 30, firstUnlockInDays: 30 });
    expect(new Set(steps.map((s) => s.amount))).toEqual(new Set([parseUnits('100', 18)]));
  });

  it('schedules step i at chainNow + (first + i*interval) days', () => {
    const now = 1_700_000_000;
    const { steps } = buildSteps({ chainNow: now, totalAmount: '10', steps: 3, intervalDays: 30, firstUnlockInDays: 7 });
    expect(steps.map((s) => Number(s.unlockTime))).toEqual([now + 7 * DAY, now + 37 * DAY, now + 67 * DAY]);
  });

  it('handles a single step and fractional totals', () => {
    const { total, steps } = buildSteps({ chainNow: 0, totalAmount: '0.000000000000000007', steps: 1, intervalDays: 1, firstUnlockInDays: 0 });
    expect(steps).toHaveLength(1);
    expect(steps[0].amount).toBe(total);
  });
});

describe('scheduleToSteps', () => {
  it('parses decimal amounts at 18 decimals and keeps unlock times as bigint', () => {
    expect(scheduleToSteps([{ unlockTime: 1_700_000_000, amount: '0.5' }])).toEqual([
      { unlockTime: 1_700_000_000n, amount: parseUnits('0.5', 18) },
    ]);
  });

  it('keeps the order and values exactly as sent, even when invalid for the contract', () => {
    const steps = scheduleToSteps([
      { unlockTime: 300, amount: '1' },
      { unlockTime: 100, amount: '0' },
      { unlockTime: 100, amount: '2.000000000000000001' },
    ]);
    expect(steps.map((s) => Number(s.unlockTime))).toEqual([300, 100, 100]);
    expect(steps.map((s) => formatUnits(s.amount, 18))).toEqual(['1.0', '0.0', '2.000000000000000001']);
  });

  it('returns an empty array for an empty schedule', () => {
    expect(scheduleToSteps([])).toEqual([]);
  });
});
