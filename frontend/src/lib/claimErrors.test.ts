import { encodeErrorResult, type Abi } from 'viem';
import { describe, expect, it } from 'vitest';
import { claimBlocker, claimMessage, describeClaimError, revertName } from './claimErrors';
import { errorAbi } from './contracts';

const enc = (errorName: string, args?: unknown[]) => encodeErrorResult({ abi: errorAbi as Abi, errorName, args } as never);

describe('claim error messages', () => {
  it.each([
    ['NothingClaimable', 'Nothing to claim yet'],
    ['VestingComplete', 'All steps claimed'],
    ['NotStakeholder', 'This wallet has no vesting plan'],
    ['ERC20InsufficientBalance', 'Vault is underfunded; ask the admin to top up'],
    ['EnforcedPause', 'Vault is paused'],
  ])('%s → %s', (name, text) => expect(claimMessage(name)).toBe(text));

  it('StepLocked includes the next unlock date from chain time', () => {
    expect(claimMessage('StepLocked', 1797751579)).toBe('Next step unlocks on 2026-12-20 07:26:19 UTC');
  });

  it('decodes raw revert data nested the way wallets return it (decodeErrorResult)', () => {
    const metamaskish = { code: -32603, data: { originalError: { data: enc('StepLocked') } } };
    expect(revertName(metamaskish)).toBe('StepLocked');
    expect(describeClaimError(metamaskish, 1797751579)).toBe('Next step unlocks on 2026-12-20 07:26:19 UTC');
  });

  it('decodes token errors bubbled through the vault', () => {
    const data = enc('ERC20InsufficientBalance', ['0x0000000000000000000000000000000000000001', 1n, 2n]);
    expect(describeClaimError({ error: { data } })).toBe('Vault is underfunded; ask the admin to top up');
  });

  it('falls back to the error message for non-revert errors', () => {
    expect(describeClaimError(new Error('boom'))).toBe('boom');
  });
});

describe('claimBlocker (MetaMask page buttons)', () => {
  const v = { exists: true, lastClaimedStep: 0, totalSteps: 2, canClaimNow: true, nextReleaseTime: 1 };
  it('a paused vault blocks claims even when a step is claimable', () => {
    expect(claimBlocker({ paused: true, view: v })).toBe('Vault is paused');
    expect(claimBlocker({ paused: true })).toBe('Vault is paused');
  });
  it('otherwise follows the schedule', () => {
    expect(claimBlocker({ paused: false, view: v })).toBeUndefined();
    expect(claimBlocker({ paused: false, view: { ...v, lastClaimedStep: 2 } })).toBe('All steps claimed');
    expect(claimBlocker({ paused: false, view: { ...v, canClaimNow: false } })).toMatch(/^Next step unlocks on /);
    expect(claimBlocker({ paused: false, view: { ...v, exists: false } })).toBeUndefined();
  });
});
