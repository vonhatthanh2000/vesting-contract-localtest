import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { describeError } from './errors';
import { isUnderfunded, toUnits } from './format';
import { validateAddForm } from './validation';

const good = { user: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', totalAmount: '1200', steps: '12', intervalDays: '30', firstUnlockInDays: '30' };

describe('validateAddForm (mirrors backend H1)', () => {
  it('accepts the defaults and converts numbers', () => {
    expect(validateAddForm(good).input).toEqual({ ...good, steps: 12, intervalDays: 30, firstUnlockInDays: 30 });
  });
  it.each([
    ['user', '0x123'],
    ['totalAmount', '0'],
    ['totalAmount', '-1'],
    ['totalAmount', '1.0000000000000000001'],
    ['steps', '0'],
    ['steps', '101'],
    ['steps', '1.5'],
    ['intervalDays', '0'],
    ['firstUnlockInDays', '-1'],
  ] as const)('rejects %s = %s', (k, v) => {
    const r = validateAddForm({ ...good, [k]: v });
    expect(r.input).toBeUndefined();
    expect(r.errors[k]).toBeTruthy();
  });
  it('allows firstUnlockInDays = 0', () => {
    expect(validateAddForm({ ...good, firstUnlockInDays: '0' }).input).toBeDefined();
  });
});

describe('underfunding', () => {
  it('compares exact 18-decimal amounts', () => {
    expect(toUnits('1200.0')).toBe(1200n * 10n ** 18n);
    expect(isUnderfunded({ vaultBalance: '1199.999999999999999999', remaining: '1200.0' })).toBe(true);
    expect(isUnderfunded({ vaultBalance: '1200.0', remaining: '1200.0' })).toBe(false);
    expect(isUnderfunded({ vaultBalance: '0.0', remaining: '0.0' })).toBe(false);
  });
});

describe('describeError', () => {
  it('adds a hint to known error names', () => {
    expect(describeError(new ApiError('AllocationMismatch', 400))).toBe('AllocationMismatch: step amounts do not add up to the total');
  });
  it('uses the backend message for BadRequest', () => {
    expect(describeError(new ApiError('BadRequest', 400, 'steps must not be greater than 100'))).toBe('BadRequest: steps must not be greater than 100');
  });
  it('falls back to the bare name', () => {
    expect(describeError(new ApiError('SomethingNew', 400))).toBe('SomethingNew');
  });
});

import { formatToken } from './format';
describe('formatToken', () => {
  it('matches the backend formatUnits shape', () => {
    expect(formatToken(1200n * 10n ** 18n)).toBe('1200.0');
    expect(formatToken(0n)).toBe('0.0');
    expect(formatToken(333333333333333333334n)).toBe('333.333333333333333334');
  });
});
