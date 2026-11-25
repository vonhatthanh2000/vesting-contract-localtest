import { describe, expect, it } from 'vitest';
import { buildCustomRequest, DAY, moveRow, parseUtcDateTime, rowUnlockTime, stepStatus, sumAmounts, toUtcDateTimeInput, type CustomRow } from './schedule';

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

const U1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const days = (d: string, amount: string): CustomRow => ({ unlock: 'days', days: d, date: '', amount });
const date = (v: string, amount: string): CustomRow => ({ unlock: 'date', days: '', date: v, amount });

describe('UTC date-time parsing (chain time, never the browser clock)', () => {
  it('reads a datetime-local value as UTC', () => {
    expect(parseUtcDateTime('2027-01-01T00:00')).toBe(1798761600);
    expect(parseUtcDateTime('2027-01-01T00:00:30')).toBe(1798761630);
  });
  it('rejects anything else', () => {
    for (const v of ['', '2027-01-01', '2027-13-01T00:00', 'tomorrow', '2027-01-01 00:00']) expect(parseUtcDateTime(v)).toBeNaN();
  });
  it('round-trips through the input format', () => {
    expect(toUtcDateTimeInput(1798761600)).toBe('2027-01-01T00:00');
    expect(parseUtcDateTime(toUtcDateTimeInput(T))).toBe(T - (T % 60));
  });
});

describe('rowUnlockTime', () => {
  it('+N days counts from chain time; fractional days are allowed', () => {
    expect(rowUnlockTime(days('30', '1'), T)).toBe(T + 30 * DAY);
    expect(rowUnlockTime(days('0.5', '1'), T)).toBe(T + DAY / 2);
    expect(rowUnlockTime(days('0', '1'), T)).toBe(T);
  });
  it('a date row ignores chain time', () => {
    expect(rowUnlockTime(date('2027-01-01T00:00', '1'), T)).toBe(1798761600);
  });
  it('unreadable → NaN', () => {
    expect(rowUnlockTime(days('-1', '1'), T)).toBeNaN();
    expect(rowUnlockTime(days('x', '1'), T)).toBeNaN();
    expect(rowUnlockTime(date('', '1'), T)).toBeNaN();
  });
});

describe('sumAmounts / moveRow', () => {
  it('sums exactly at 18 decimals; an unreadable amount gives ""', () => {
    expect(sumAmounts([days('1', '0.1'), days('2', '0.2')])).toBe('0.3');
    expect(sumAmounts([])).toBe('0.0');
    expect(sumAmounts([days('1', 'abc')])).toBe('');
  });
  it('moves a row up or down, and ignores moves past the ends', () => {
    expect(moveRow(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveRow(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveRow(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});

describe('buildCustomRequest', () => {
  const ok = { user: U1, rows: [days('30', '600'), date('2100-01-01T00:00', '600')], total: '1200', asIs: false, chainTime: T };

  it('builds the schedule with chain-relative and absolute unlocks', () => {
    expect(buildCustomRequest(ok).request).toEqual({
      kind: 'schedule',
      body: { user: U1, totalAmount: '1200', schedule: [{ unlockTime: T + 30 * DAY, amount: '600' }, { unlockTime: 4102444800, amount: '600' }] },
    });
  });

  it.each([
    ['a bad user', { user: '0x1' }, 'User must be a 0x address'],
    ['0 rows', { rows: [], total: '0' }, 'Add at least one step'],
    ['a zero amount', { rows: [days('1', '0'), days('2', '1')], total: '1' }, 'Amounts must be above 0'],
    ['equal unlocks', { rows: [days('5', '1'), days('5', '1')], total: '2' }, 'Unlock times must increase'],
    ['decreasing unlocks', { rows: [days('9', '1'), days('5', '1')], total: '2' }, 'Unlock times must increase'],
    ['a total that differs from the sum', { total: '1000' }, 'Total 1000 ≠ sum of steps 1200.0'],
  ])('checks %s', (_l, patch, error) => {
    expect(buildCustomRequest({ ...ok, ...patch })).toEqual({ error });
  });

  it('"Send as is" lets 0 rows, zero amounts, a mismatch, bad order and a bad user through', () => {
    for (const patch of [
      { rows: [], total: '0' },
      { rows: [days('1', '0')], total: '0' },
      { total: '999' },
      { rows: [days('9', '1'), days('5', '1')], total: '2' },
      { user: '0x0000000000000000000000000000000000000000' },
    ]) {
      expect(buildCustomRequest({ ...ok, ...patch, asIs: true }).request).toBeDefined();
    }
  });

  it('even with "Send as is", unreadable values block (they cannot be sent)', () => {
    expect(buildCustomRequest({ ...ok, rows: [days('x', '1')], asIs: true }).error).toMatch(/valid number of days/);
    expect(buildCustomRequest({ ...ok, rows: [days('1', '-1')], asIs: true }).error).toMatch(/Amounts must be numbers/);
    expect(buildCustomRequest({ ...ok, total: '', asIs: true }).error).toMatch(/Total must be a number/);
    expect(buildCustomRequest({ ...ok, chainTime: undefined }).error).toBe('Waiting for chain time');
  });
});
