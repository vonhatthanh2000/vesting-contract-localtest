import { ApiError } from './api';

// Plain-language hints next to the backend's error name (contract custom errors + API errors).
export const HINTS: Record<string, string> = {
  // API
  NotDeployed: 'click Setup first',
  BadRequest: 'invalid input',
  BackendUnreachable: 'start the backend',
  NoCode: 'no contract at that address',
  NoNextUnlock: 'this user has no locked step left',
  TimeInPast: 'that moment has already passed (time only moves forward)',
  ScenarioBusy: 'a scenario is running; try again when it finishes',
  // FamilyVesting
  InvalidSchedule: 'the schedule is invalid (steps, amounts or unlock times)',
  AllocationMismatch: 'step amounts do not add up to the total',
  InsufficientVaultBalance: 'the vault holds less than every plan needs; fund it first',
  ZeroAddress: 'the address cannot be 0x0',
  ZeroAmount: 'the amount must be above 0',
  ActivePlans: 'tokens are still owed, so the token cannot change',
  NotStakeholder: 'this address has no plan',
  StepLocked: 'the next step has not unlocked yet',
  VestingComplete: 'every step is already claimed',
  NothingClaimable: 'no unlocked step to claim',
  RenounceDisabled: 'the vault can never be left without an owner',
  // OpenZeppelin
  OwnableUnauthorizedAccount: 'the signing account is not the vault owner (check Act as)',
  EnforcedPause: 'the vault is paused',
  ExpectedPause: 'the vault is not paused',
  ERC20InsufficientBalance: 'the vault holds too few tokens for this transfer',
  SafeERC20FailedOperation: 'the token transfer failed',
};

/** Every error name the backend can return; each must have a hint (checked by lib.test.ts). */
export const KNOWN_ERRORS = Object.keys(HINTS);

/** "AllocationMismatch: step amounts do not add up to the total". For BadRequest, the backend's message is used. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    const hint = e.name === 'BadRequest' || e.name === 'BackendUnreachable' ? e.detail ?? HINTS[e.name] : HINTS[e.name];
    return hint ? `${e.name}: ${hint}` : e.name;
  }
  return e instanceof Error ? e.message : String(e);
}
