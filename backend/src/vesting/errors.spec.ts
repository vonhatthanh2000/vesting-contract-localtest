import { HttpException } from '@nestjs/common';
import { tokenIface, vestingIface } from './artifacts';
import { toHttpError } from './errors';

const IFACES = [vestingIface, tokenIface];
const ADDR = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';

/** The two shapes ethers v6 gives on Hardhat (probed): */
// preflight staticCall: CALL_EXCEPTION, action 'call', revert decoded when the vault ABI knows the error.
const preflight = (name: string, data: string) => ({ code: 'CALL_EXCEPTION', action: 'call', revert: { name }, data });
// send (fails inside ethers' estimateGas): CALL_EXCEPTION, action 'estimateGas', revert null, only raw data.
const send = (data: string) => ({ code: 'CALL_EXCEPTION', action: 'estimateGas', revert: null, data, info: { error: {} } });

const body = (e: unknown) => {
  expect(e).toBeInstanceOf(HttpException);
  const h = e as HttpException;
  expect(h.getStatus()).toBe(400);
  return h.getResponse();
};

const encoded = {
  OwnableUnauthorizedAccount: vestingIface.encodeErrorResult('OwnableUnauthorizedAccount', [ADDR]),
  EnforcedPause: vestingIface.encodeErrorResult('EnforcedPause', []),
  StepLocked: vestingIface.encodeErrorResult('StepLocked', []),
  // Raised by the token inside the vault's safeTransfer; only MockUSDT's ABI has it.
  ERC20InsufficientBalance: tokenIface.encodeErrorResult('ERC20InsufficientBalance', [ADDR, 0n, 1n]),
};

describe('toHttpError', () => {
  it.each(Object.entries(encoded))('maps %s from a preflight failure', (name, data) => {
    expect(body(toHttpError(preflight(name, data), IFACES))).toEqual({ error: name });
  });

  it.each(Object.entries(encoded))('maps %s from a send (estimateGas) failure with only raw data', (name, data) => {
    expect(body(toHttpError(send(data), IFACES))).toEqual({ error: name });
  });

  it('finds data nested under info.error.data and error.data', () => {
    expect(body(toHttpError({ info: { error: { data: encoded.EnforcedPause } } }, IFACES))).toEqual({ error: 'EnforcedPause' });
    expect(body(toHttpError({ error: { data: encoded.StepLocked } }, IFACES))).toEqual({ error: 'StepLocked' });
  });

  it('every OpenZeppelin error the plan relies on is in a loaded ABI', () => {
    for (const n of ['OwnableUnauthorizedAccount', 'EnforcedPause', 'ExpectedPause', 'SafeERC20FailedOperation', 'InsufficientVaultBalance']) {
      expect(vestingIface.getError(n)).not.toBeNull();
    }
    expect(tokenIface.getError('ERC20InsufficientBalance')).not.toBeNull();
  });

  it('passes HttpExceptions and unknown errors through unchanged', () => {
    const h = new HttpException({ error: 'NotDeployed' }, 409);
    expect(toHttpError(h, IFACES)).toBe(h);
    const other = new Error('network down');
    expect(toHttpError(other, IFACES)).toBe(other);
    const unknownData = { data: '0xdeadbeef' };
    expect(toHttpError(unknownData, IFACES)).toBe(unknownData);
  });
});
