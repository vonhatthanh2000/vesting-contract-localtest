import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from 'viem';
import { errorAbi } from './contracts';
import { fmtChainTime } from './format';

/** Plain message for a vault/token custom error. StepLocked needs the next unlock time (chain seconds). */
export function claimMessage(errorName: string, nextReleaseTime?: number): string {
  switch (errorName) {
    case 'StepLocked':
      return `Next step unlocks on ${fmtChainTime(nextReleaseTime)}`;
    case 'NothingClaimable':
      return 'Nothing to claim yet';
    case 'VestingComplete':
      return 'All steps claimed';
    case 'NotStakeholder':
      return 'This wallet has no vesting plan';
    case 'ERC20InsufficientBalance':
      return 'Vault is underfunded; ask the admin to top up';
    case 'EnforcedPause':
      return 'Vault is paused';
    default:
      return errorName;
  }
}

/**
 * Why the MetaMask page's claim buttons are off, or undefined if they're on. A paused vault blocks both buttons,
 * whatever the schedule says (claim/claimAll are whenNotPaused).
 */
export function claimBlocker(p: {
  paused: boolean;
  view?: { exists: boolean; lastClaimedStep: number; totalSteps: number; canClaimNow: boolean; nextReleaseTime: number };
}): string | undefined {
  if (p.paused) return claimMessage('EnforcedPause');
  const v = p.view;
  if (!v || !v.exists) return undefined;
  if (v.lastClaimedStep >= v.totalSteps) return claimMessage('VestingComplete');
  if (!v.canClaimNow) return claimMessage('StepLocked', v.nextReleaseTime);
  return undefined;
}

/** Find a revert's custom error name in a viem/wallet error: viem's decoded name, else decodeErrorResult on raw data. */
export function revertName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted?.data?.errorName) return reverted.data.errorName;
    if (reverted?.raw) return decode(reverted.raw);
  }
  // Wallets (MetaMask) nest the revert bytes in different places.
  const seen = new Set<unknown>();
  const stack: unknown[] = [e];
  while (stack.length) {
    const x = stack.pop();
    if (!x || typeof x !== 'object' || seen.has(x)) continue;
    seen.add(x);
    for (const v of Object.values(x as Record<string, unknown>)) {
      if (typeof v === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(v)) {
        const n = decode(v as Hex);
        if (n) return n;
      } else if (v && typeof v === 'object') stack.push(v);
    }
  }
  return undefined;
}

function decode(data: Hex): string | undefined {
  try {
    return decodeErrorResult({ abi: errorAbi, data }).errorName;
  } catch {
    return undefined;
  }
}

/** User-facing text for a failed claim. */
export function describeClaimError(e: unknown, nextReleaseTime?: number): string {
  const name = revertName(e);
  if (name) return claimMessage(name, nextReleaseTime);
  if (e instanceof BaseError) {
    if (e.walk((x) => (x as { name?: string }).name === 'UserRejectedRequestError')) return 'Transaction rejected in the wallet';
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
