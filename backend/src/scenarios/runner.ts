import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Contract, ContractFactory, ContractTransactionResponse, JsonRpcProvider, JsonRpcSigner, formatUnits, getAddress, parseUnits } from 'ethers';
import { config } from '../config';
import { FamilyVestingArtifact, MockUSDTArtifact, tokenIface, vestingIface } from '../vesting/artifacts';
import { toHttpError } from '../vesting/errors';
import { decodeLog } from '../vesting/events';
import { DECIMALS } from '../vesting/steps';
import type { RunResult, Scenario, Snapshot, StepResult } from './types';

export type { RunResult, Scenario, Snapshot, Step, StepResult } from './types';

const fmt = (v: bigint) => formatUnits(v, DECIMALS);
export const units = (v: string) => parseUnits(v, DECIMALS);

// ---------- busy flag: one run at a time, and no manual writes / time moves while it runs ----------

let busy = false;
export const scenarioBusy = () => new HttpException({ error: 'ScenarioBusy' }, 409);

/** Paths that stay allowed during a run: reads, and the two read-only preview POSTs. */
const ALLOWED_POSTS = new Set(['/stakeholders/preview', '/stakeholders/schedule/preview']);

/** Global interceptor: while a scenario runs, every non-GET request (except previews) gets 409 ScenarioBusy. */
@Injectable()
export class ScenarioBusyInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<{ method: string; path: string }>();
    if (busy && req.method !== 'GET' && !ALLOWED_POSTS.has(req.path)) throw scenarioBusy();
    return next.handle();
  }
}

/** Handles a scenario step gets: the fresh vault/token, signers, chain time and time moves. */
export class Ctx {
  constructor(
    readonly provider: JsonRpcProvider,
    readonly vaultAddr: string,
    readonly tokenAddr: string,
  ) {}

  signer(as: number): Promise<JsonRpcSigner> {
    return this.provider.getSigner(as);
  }
  async addr(as: number): Promise<string> {
    return getAddress((await this.signer(as)).address);
  }
  async vault(as = 0) {
    return new Contract(this.vaultAddr, FamilyVestingArtifact.abi, await this.signer(as));
  }
  async token(as = 0) {
    return new Contract(this.tokenAddr, MockUSDTArtifact.abi, await this.signer(as));
  }
  async now(): Promise<number> {
    return (await this.provider.getBlock('latest'))!.timestamp;
  }

  /** Preflight at the pending block (as the service does), then send. A revert throws before anything is mined. */
  async send(as: number, fn: string, args: unknown[]): Promise<ContractTransactionResponse> {
    const v = await this.vault(as);
    await v.getFunction(fn).staticCall(...args, { blockTag: 'pending' });
    const tx: ContractTransactionResponse = await v.getFunction(fn)(...args);
    await tx.wait();
    return tx;
  }

  async fund(amount: string): Promise<ContractTransactionResponse> {
    const tx: ContractTransactionResponse = await (await this.token()).mint(this.vaultAddr, units(amount));
    await tx.wait();
    return tx;
  }

  /** Mine a block at `t` (must be after the latest block). */
  async mineAt(t: number) {
    await this.provider.send('evm_setNextBlockTimestamp', [t]);
    await this.provider.send('evm_mine', []);
  }

  /** Set the next block's timestamp without mining: the next mined tx lands exactly at `t`. */
  async pin(t: number) {
    await this.provider.send('evm_setNextBlockTimestamp', [t]);
  }

  /** Unlock time of `as`'s step k (1-based). */
  async unlockOf(as: number, k: number): Promise<number> {
    const schedule = await (await this.vault()).getSchedule(await this.addr(as));
    return Number(schedule[k - 1].unlockTime);
  }

  /** "Jump past step k" (1-based): mine at that step's unlock + 1, so steps 1..k are unlocked. */
  async jumpPastStep(as: number, k: number) {
    await this.mineAt((await this.unlockOf(as, k)) + 1);
  }
}

// ---------- runner ----------

function revertName(e: unknown): string | null {
  const h = toHttpError(e, [vestingIface, tokenIface]);
  if (h instanceof HttpException && h.getStatus() === 400) return (h.getResponse() as { error?: string }).error ?? null;
  return null;
}

async function snapshot(c: Ctx, users: number[], tx?: ContractTransactionResponse | void): Promise<Snapshot> {
  const v = await c.vault();
  const t = await c.token();
  const d = await v.getFullDashboard();
  const out: Snapshot = {
    dashboard: { allocated: fmt(d.allocated), claimed: fmt(d.claimed), remaining: fmt(d.remaining), count: Number(d.count), vaultBalance: fmt(d.vaultBalance) },
    users: {},
    holders: [],
    events: [],
    log: [],
  };
  const node = (await c.provider.send('eth_accounts', [])).map((a: string) => getAddress(a));
  const [list] = await v.getStakeholders(0, 1000);
  out.holders = (list as string[]).map((a) => node.indexOf(getAddress(a)));
  for (const i of users) {
    const a = await c.addr(i);
    const [u, cl, bal] = await Promise.all([v.getUserDashboard(a), v.claimable(a), t.balanceOf(a)]);
    out.users[i] = {
      allocated: fmt(u.allocated),
      released: fmt(u.released),
      lastClaimedStep: Number(u.lastClaimedStep),
      totalSteps: Number(u.totalSteps),
      claimable: fmt(cl.amount),
      tokenBalance: fmt(bal),
    };
  }
  if (tx) {
    const receipt = await tx.wait();
    for (const log of receipt!.logs) {
      if (getAddress(log.address) !== getAddress(c.vaultAddr)) continue;
      const ev = decodeLog(vestingIface, log);
      if (ev) {
        out.events.push(ev.name);
        out.log.push(ev);
      }
    }
  }
  return out;
}

/**
 * Every key in `want` must equal the same key in `got` (recursively); extra keys in `got` are ignored. Arrays of
 * objects match element by element (same length); arrays of plain values must be equal.
 */
export function matches(want: unknown, got: unknown): boolean {
  if (Array.isArray(want)) {
    return Array.isArray(got) && want.length === got.length && want.every((w, i) => matches(w, got[i]));
  }
  if (want && typeof want === 'object') {
    if (!got || typeof got !== 'object') return false;
    return Object.entries(want).every(([k, v]) => matches(v, (got as Record<string, unknown>)[k]));
  }
  return JSON.stringify(want) === JSON.stringify(got);
}

/** Deploy a fresh MockUSDT + FamilyVesting (never the main deployment), run every step, report each. */
export async function runScenario(s: Scenario): Promise<RunResult> {
  if (busy) throw scenarioBusy();
  busy = true;
  try {
    const provider = new JsonRpcProvider(config.rpcUrl, undefined, { cacheTimeout: -1 });
    const owner = await provider.getSigner(0);
    const token = await new ContractFactory(MockUSDTArtifact.abi, MockUSDTArtifact.bytecode, owner).deploy(DECIMALS);
    await token.waitForDeployment();
    const vault = (await new ContractFactory(FamilyVestingArtifact.abi, FamilyVestingArtifact.bytecode, owner).deploy()) as Contract;
    await vault.waitForDeployment();
    await (await vault.setToken(await token.getAddress())).wait();
    const c = new Ctx(provider, await vault.getAddress(), await token.getAddress());

    const steps: StepResult[] = [];
    for (const step of s.steps) {
      try {
        const before = await snapshot(c, s.users);
        let tx: ContractTransactionResponse | void = undefined;
        let revert: string | null = null;
        try {
          tx = await step.act(c);
        } catch (e) {
          revert = revertName(e);
          if (revert === null) throw e;
        }
        const after = await snapshot(c, s.users, tx);
        if ('revert' in step.expect) {
          // A revert must also leave the state exactly as it was.
          const unchanged = matches({ dashboard: before.dashboard, users: before.users, holders: before.holders }, after);
          steps.push({ label: step.label, pass: revert === step.expect.revert && unchanged, expected: step.expect, actual: revert ? { revert } : after, time: await c.now(), events: after.log });
        } else {
          const pass = revert === null && matches(step.expect, after);
          steps.push({ label: step.label, pass, expected: step.expect, actual: revert ? { revert } : after, time: await c.now(), events: after.log });
        }
      } catch (e) {
        // An unexpected throw (not a contract revert) fails only this step; the run goes on.
        steps.push({ label: step.label, pass: false, expected: step.expect, actual: { revert: null }, error: (e as Error).message.split('\n')[0], time: await c.now().catch(() => undefined), events: [] });
      }
    }
    return { id: s.id, vault: c.vaultAddr, pass: steps.every((x) => x.pass), steps };
  } finally {
    busy = false;
  }
}
