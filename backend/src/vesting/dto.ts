import { IsEthereumAddress, IsInt, IsOptional, Matches, Max, Min, ValidateIf } from 'class-validator';

// Positive decimal with at most 18 fraction digits; zero is rejected by the lookahead.
export const POSITIVE_DECIMAL = /^(?=.*[1-9])\d+(\.\d{1,18})?$/;
const amountMsg = 'must be a positive decimal string with at most 18 decimals, e.g. "1200"';

export class FundDto {
  @Matches(POSITIVE_DECIMAL, { message: `amount ${amountMsg}` })
  amount!: string;
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
}

export class SkipTimeDto {
  @ValidateIf((o) => o.seconds === undefined)
  @IsInt() @Min(1)
  days?: number;

  @IsOptional()
  @IsInt() @Min(1)
  seconds?: number;
}
