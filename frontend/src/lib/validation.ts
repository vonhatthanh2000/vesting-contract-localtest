// Mirrors backend/src/vesting/dto.ts so most mistakes are caught before a request is sent.
import type { AddStakeholderInput } from './api';

export const POSITIVE_DECIMAL = /^(?=.*[1-9])\d+(\.\d{1,18})?$/;
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type AddForm = { user: string; totalAmount: string; steps: string; intervalDays: string; firstUnlockInDays: string };
export type FieldErrors = Partial<Record<keyof AddForm, string>>;

const isInt = (s: string) => /^-?\d+$/.test(s.trim());

export function validateAmount(v: string): string | undefined {
  return POSITIVE_DECIMAL.test(v.trim()) ? undefined : 'Positive number, at most 18 decimals';
}

export function validateDays(v: string): string | undefined {
  return isInt(v) && Number(v) >= 1 ? undefined : 'Whole number ≥ 1';
}

export function validateAddForm(f: AddForm): { errors: FieldErrors; input?: AddStakeholderInput } {
  const errors: FieldErrors = {};
  if (!ADDRESS.test(f.user.trim())) errors.user = 'Must be a 0x address (40 hex chars)';
  const amt = validateAmount(f.totalAmount);
  if (amt) errors.totalAmount = amt;
  if (!isInt(f.steps) || Number(f.steps) < 1 || Number(f.steps) > 100) errors.steps = 'Whole number 1–100';
  if (!isInt(f.intervalDays) || Number(f.intervalDays) < 1) errors.intervalDays = 'Whole number ≥ 1';
  if (!isInt(f.firstUnlockInDays) || Number(f.firstUnlockInDays) < 0) errors.firstUnlockInDays = 'Whole number ≥ 0';
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: {
      user: f.user.trim(),
      totalAmount: f.totalAmount.trim(),
      steps: Number(f.steps),
      intervalDays: Number(f.intervalDays),
      firstUnlockInDays: Number(f.firstUnlockInDays),
    },
  };
}
