import type { ContractTransactionResponse } from 'ethers';
import type { EventArgs } from '../vesting/events';
import type { Ctx } from './runner';

/** One user's on-chain state, as the scenario runner reads it (amounts as "1200.0"). */
export type UserSnapshot = {
  allocated: string;
  released: string;
  lastClaimedStep: number;
  totalSteps: number;
  claimable: string;
  tokenBalance: string;
};

/** What the chain looks like after a step. */
export type Snapshot = {
  dashboard: { allocated: string; claimed: string; remaining: string; count: number; vaultBalance: string };
  /** Each listed user (by Hardhat account index). */
  users: Record<number, UserSnapshot>;
  /** getStakeholders order, as account indexes (−1 for an address outside the 20 node accounts). */
  holders: number[];
  /** Names of the vault events this step's tx emitted, in order. */
  events: string[];
  /** The same events with their formatted args. */
  log: { name: string; args: EventArgs }[];
};

/** Either the custom error the step must revert with (and then nothing may change), or a partial snapshot to match. */
export type Expectation =
  | { revert: string }
  | {
      dashboard?: Partial<Snapshot['dashboard']>;
      users?: Record<number, Partial<UserSnapshot>>;
      holders?: number[];
      events?: string[];
      log?: { name: string; args?: Partial<EventArgs> }[];
    };

/** One action (a contract call or a time move, signed by an account index) and what it must lead to. */
export type Step = { label: string; act: (c: Ctx) => Promise<ContractTransactionResponse | void>; expect: Expectation };

export type Scenario = { id: string; title: string; description: string; users: number[]; steps: Step[] };

export type StepResult = {
  label: string;
  pass: boolean;
  expected: Expectation;
  actual: Partial<Snapshot> | { revert: string | null };
  error?: string;
  /** Chain time (latest block) right after the step ran. */
  time?: number;
  /** Vault events the step's tx emitted, with formatted args (empty for a revert or a time move). */
  events: Snapshot['log'];
};

export type RunResult = { id: string; vault: string; pass: boolean; steps: StepResult[] };
