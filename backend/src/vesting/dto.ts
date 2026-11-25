import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEthereumAddress, IsIn, IsInt, IsOptional, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';

// Positive decimal with at most 18 fraction digits; zero is rejected by the lookahead.
export const POSITIVE_DECIMAL = /^(?=.*[1-9])\d+(\.\d{1,18})?$/;
/** Optional signer: a Hardhat node account index 0–19 (getSigner(20) would throw → 500). */
export const IsSignerIndex = () => applyDecorators(IsOptional(), IsInt(), Min(0), Max(19));

const amountMsg = 'must be a positive decimal string with at most 18 decimals, e.g. "1200"';
// Zero allowed: lets the contract's own InvalidSchedule / AllocationMismatch errors be triggered.
export const DECIMAL = /^\d+(\.\d{1,18})?$/;
const decimalMsg = 'must be a decimal string ≥ 0 with at most 18 decimals';

export class FundDto {
  @Matches(POSITIVE_DECIMAL, { message: `amount ${amountMsg}` })
  amount!: string;

  /** Defaults to the vault's current token; otherwise must be one of mockTokens. */
  @IsOptional() @IsEthereumAddress()
  token?: string;
}

/** Signer only (pause, unpause, accept, renounce). */
export class AsDto {
  @IsSignerIndex()
  as?: number;
}

/** Zero amount and 0x0 allowed, so the contract's ZeroAmount / ZeroAddress can be triggered. */
export class EmergencyWithdrawDto {
  @IsEthereumAddress()
  to!: string;

  @Matches(DECIMAL, { message: `amount ${decimalMsg}` })
  amount!: string;

  @IsSignerIndex()
  as?: number;
}

/** Any address, 0x0 included (→ ZeroAddress from the contract). */
export class SetTokenDto {
  @IsEthereumAddress()
  token!: string;

  @IsSignerIndex()
  as?: number;
}

export class TransferOwnershipDto {
  @IsEthereumAddress()
  newOwner!: string;

  @IsSignerIndex()
  as?: number;
}

export class AddStakeholderDto {
  @IsEthereumAddress()
  user!: string;

  @Matches(POSITIVE_DECIMAL, { message: `totalAmount ${amountMsg}` })
  totalAmount!: string;

  @IsInt() @Min(1) @Max(100)
  steps!: number;

  @IsInt() @Min(1)
  intervalDays!: number;

  @IsInt() @Min(0)
  firstUnlockInDays!: number;

  /** Signer index (default 0). */
  @IsSignerIndex()
  as?: number;
}

export class ScheduleStepDto {
  @IsInt() @Min(0)
  unlockTime!: number;

  @Matches(DECIMAL, { message: `amount ${decimalMsg}` })
  amount!: string;
}

/** Shape only: any address (0x0 too), 0–150 steps, zero amounts allowed. The contract does the real checks. */
export class ScheduleDto {
  @IsEthereumAddress()
  user!: string;

  @Matches(DECIMAL, { message: `totalAmount ${decimalMsg}` })
  totalAmount!: string;

  @IsArray() @ArrayMaxSize(150) @ValidateNested({ each: true }) @Type(() => ScheduleStepDto)
  schedule!: ScheduleStepDto[];

  /** Signer index (default 0). */
  @IsSignerIndex()
  as?: number;
}

export class ClaimDto {
  /** Signer index (default 1). */
  @IsSignerIndex()
  as?: number;

  /** true → claimAll(), else claim() (next step only). */
  @IsOptional() @IsBoolean()
  all?: boolean;
}

/** `?as=N` on routes without a body (query values arrive as strings). */
export class AsQueryDto {
  @Type(() => Number) @IsSignerIndex()
  as?: number;
}

export class JumpDto {
  @IsEthereumAddress()
  user!: string;

  /** Seconds around the unlock: -1, 0 (default) or +1. */
  @IsOptional() @IsIn([-1, 0, 1])
  offset?: number;

  /** true: only pin the next block's timestamp (the next mined tx lands exactly there). */
  @IsOptional() @IsBoolean()
  pin?: boolean;
}

export class SkipTimeDto {
  @ValidateIf((o) => o.seconds === undefined)
  @IsInt() @Min(1)
  days?: number;

  @IsOptional()
  @IsInt() @Min(1)
  seconds?: number;
}
