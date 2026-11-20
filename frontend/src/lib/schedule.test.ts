import { describe, expect, it } from 'vitest';
import { stepStatus } from './schedule';

const T = 1_800_000_000;

describe('stepStatus', () => {
  it('marks steps before lastClaimedStep as claimed, even if their unlock time is in the future', () => {
    expect(stepStatus(0, T - 10, 2, T)).toBe('claimed');
    expect(stepStatus(1, T + 10, 2, T)).toBe('claimed');
  });
  it('unlocked when unlockTime <= chainTime (inclusive, like the contract)', () => {
    expect(stepStatus(2, T, 2, T)).toBe('unlocked');
    expect(stepStatus(3, T - 1, 2, T)).toBe('unlocked');
  });
  it('locked when unlockTime > chainTime', () => {
    expect(stepStatus(2, T + 1, 2, T)).toBe('locked');
  });
  it('matches the 12×30d plan after a 61-day skip, then a claimAll', () => {
    const now = 0;
    const sched = Array.from({ length: 12 }, (_, i) => (30 + i * 30) * 86400 + now);
    const chain = now + 61 * 86400;
    expect(sched.map((u, i) => stepStatus(i, u, 0, chain)).slice(0, 4)).toEqual(['unlocked', 'unlocked', 'locked', 'locked']);
    expect(sched.map((u, i) => stepStatus(i, u, 2, chain)).slice(0, 4)).toEqual(['claimed', 'claimed', 'locked', 'locked']);
  });
});
