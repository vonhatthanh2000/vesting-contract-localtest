import type { Abi } from 'viem';
// Named JSON imports: only the ABI is bundled, not the bytecode.
import { abi as vestingJson } from '../../../shared/artifacts/FamilyVesting.json';
import { abi as tokenJson } from '../../../shared/artifacts/MockUSDT.json';

export const vestingAbi = vestingJson as Abi;
export const tokenAbi = tokenJson as Abi;
/** The vault bubbles token reverts (SafeERC20), so decode against both ABIs. */
export const errorAbi = [...vestingAbi, ...tokenAbi.filter((x) => x.type === 'error')] as Abi;
