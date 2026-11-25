import { ApiError } from './api';

// Plain-language hints next to the backend's error name (contract custom errors + API errors).
const HINTS: Record<string, string> = {
  NotDeployed: 'click Setup first',
  BadRequest: 'invalid input',
  InvalidSchedule: 'the schedule is invalid (steps, amounts or unlock times)',
  AllocationMismatch: 'step amounts do not add up to the total',
  ZeroAddress: 'the address cannot be 0x0',
  ZeroAmount: 'the amount must be above 0',
  ActivePlans: 'tokens are still owed, so the token cannot change',
  OwnableUnauthorizedAccount: 'the backend key is not the vault owner',
  BackendUnreachable: 'start the backend',
};

/** "AllocationMismatch: step amounts do not add up to the total". For BadRequest, the backend's message is used. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    const hint = e.name === 'BadRequest' || e.name === 'BackendUnreachable' ? e.detail ?? HINTS[e.name] : HINTS[e.name];
    return hint ? `${e.name}: ${hint}` : e.name;
  }
  return e instanceof Error ? e.message : String(e);
}
