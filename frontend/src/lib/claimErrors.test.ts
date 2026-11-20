import { encodeErrorResult, type Abi } from 'viem';
import { describe, expect, it } from 'vitest';
import { claimMessage, describeClaimError, revertName } from './claimErrors';
import { errorAbi } from './contracts';

const enc = (errorName: string, args?: unknown[]) => encodeErrorResult({ abi: errorAbi as Abi, errorName, args } as never);

describe('claim error messages', () => {
  it.each([
    ['NothingClaimable', 'Nothing to claim yet'],
    ['VestingComplete', 'All steps claimed'],
    ['NotStakeholder', 'This wallet has no vesting plan'],
    ['ERC20InsufficientBalance', 'Vault is underfunded; ask the admin to top up'],
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
