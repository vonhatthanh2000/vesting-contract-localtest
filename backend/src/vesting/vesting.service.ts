import { HttpException, Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { Contract, ContractFactory, JsonRpcProvider, JsonRpcSigner, ZeroAddress, formatUnits, getAddress, isAddress, parseUnits } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { FamilyVestingArtifact, MockUSDTArtifact, tokenIface, vestingIface } from './artifacts';
import { AddStakeholderDto, ClaimDto, EmergencyWithdrawDto, FundDto, JumpDto, ScheduleDto, SkipTimeDto } from './dto';
import { badRequest, noCode, noNextUnlock, notDeployed, timeInPast, toHttpError } from './errors';
import { blockChunks, decodeLog, VaultEvent } from './events';
import { buildSteps, DAY, DECIMALS, scheduleToSteps, Step } from './steps';

/** What deployment.json holds. Owner and token are never saved: they are read live from the vault. */
export type Deployment = { vault: string; deployBlock: number; mockTokens: string[] };

const fmt = (v: bigint) => formatUnits(v, DECIMALS);
const PAGE = 100n;

@Injectable()
export class VestingService implements OnModuleInit {
  private readonly log = new Logger(VestingService.name);
  // cacheTimeout -1: ethers' short RPC cache returns a stale nonce on back-to-back txs with Hardhat automine.
  private readonly provider = new JsonRpcProvider(config.rpcUrl, undefined, { cacheTimeout: -1 });
  private readonly file = config.deploymentFile ?? path.resolve(__dirname, '..', '..', 'deployment.json');
  private deployment: Deployment | null = null;

  async onModuleInit() {
    if (!fs.existsSync(this.file)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (typeof saved.deployBlock !== 'number' || !Array.isArray(saved.mockTokens)) {
        this.log.warn(`Ignoring ${path.basename(this.file)} in the old format; click Setup again`);
        return;
      }
      this.deployment = saved;
      await this.requireDeployment();
      this.log.log(`Loaded deployment: vault ${this.deployment!.vault}`);
    } catch {
      this.log.warn(`Ignoring stale ${path.basename(this.file)} (no code at the saved vault; chain was restarted?)`);
    }
  }

  /** The saved addresses, or 409 NotDeployed if missing or the chain was restarted (no code at the vault). */
  private async requireDeployment(): Promise<Deployment> {
    if (!this.deployment) throw notDeployed();
    const code = await this.provider.getCode(this.deployment.vault);
    if (code === '0x') {
      this.deployment = null;
      throw notDeployed();
    }
    return this.deployment;
  }

  /** Hardhat node's unlocked account `as` (0–19). The node fills in nonces. */
  private signer(as = 0): Promise<JsonRpcSigner> {
    return this.provider.getSigner(as);
  }

  /** Vault and its *current* token (read live: setToken can change it), bound to signer `as` (default #0). */
  private async contracts(as = 0) {
    const d = await this.requireDeployment();
    const s = await this.signer(as);
    const vault = new Contract(d.vault, FamilyVestingArtifact.abi, s);
    const tokenAddr: string = await vault.token();
    return { d, vault, token: new Contract(tokenAddr, MockUSDTArtifact.abi, s), tokenAddr };
  }

  private save(d: Deployment) {
    this.deployment = d;
    fs.writeFileSync(this.file, JSON.stringify(d, null, 2) + '\n');
  }

  private async deployMock(): Promise<string> {
    const t = await new ContractFactory(MockUSDTArtifact.abi, MockUSDTArtifact.bytecode, await this.signer(0)).deploy(DECIMALS);
    await t.waitForDeployment();
    return t.getAddress();
  }

  private async chainNow(): Promise<number> {
    return (await this.provider.getBlock('latest'))!.timestamp;
  }

  /** Run fn and turn contract reverts into 400 { error: <CustomErrorName> }. */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw toHttpError(e, [vestingIface, tokenIface]);
    }
  }

  setup() {
    return this.run(async () => {
      const owner = await this.signer(0);
      const tokenAddr = await this.deployMock();
      // FamilyVesting's constructor makes the deployer the owner and sets the BSC mainnet token; point it at the mock.
      const vault = (await new ContractFactory(FamilyVestingArtifact.abi, FamilyVestingArtifact.bytecode, owner).deploy()) as Contract;
      const receipt = await vault.deploymentTransaction()!.wait();
      await (await vault.setToken(tokenAddr)).wait();
      this.save({ vault: await vault.getAddress(), deployBlock: receipt!.blockNumber, mockTokens: [tokenAddr] });
      return this.liveDeployment();
    });
  }

  /** Saved record plus the vault's live token, owner, pending owner and paused flag. */
  private async liveDeployment() {
    const { d, vault, tokenAddr } = await this.contracts();
    const [owner, pendingOwner, paused] = await Promise.all([vault.owner(), vault.pendingOwner(), vault.paused()]);
    return { ...d, token: tokenAddr, owner: owner as string, pendingOwner: pendingOwner as string, paused: paused as boolean };
  }

  async getDeployment() {
    try {
      return await this.liveDeployment();
    } catch {
      throw new NotFoundException({ error: 'NotDeployed' });
    }
  }

  /** Mint to the vault: the current token by default, or any token in mockTokens. */
  fund(b: FundDto) {
    return this.run(async () => {
      const { d, token: current } = await this.contracts();
      let token = current;
      if (b.token) {
        const t = getAddress(b.token);
        if (!d.mockTokens.includes(t)) throw badRequest('token must be one of mockTokens');
        token = new Contract(t, MockUSDTArtifact.abi, await this.signer(0));
      }
      await (await token.mint(d.vault, parseUnits(b.amount, DECIMALS))).wait();
      return { vaultBalance: fmt(await token.balanceOf(d.vault)) };
    });
  }

  pause(as?: number, unpause = false) {
    return this.run(async () => this.send((await this.contracts(as)).vault, unpause ? 'unpause' : 'pause', []));
  }

  emergencyWithdraw(b: EmergencyWithdrawDto) {
    return this.run(async () =>
      this.send((await this.contracts(b.as)).vault, 'emergencyWithdraw', [getAddress(b.to), parseUnits(b.amount, DECIMALS)]),
    );
  }

  /** Deploy another MockUSDT(18) and remember it in mockTokens (for setToken / stranded-token tests). */
  deployMockToken() {
    return this.run(async () => {
      const d = await this.requireDeployment();
      const token = await this.deployMock();
      this.save({ ...d, mockTokens: [...d.mockTokens, token] });
      return { token };
    });
  }

  /** setToken; a non-zero address with no code is refused up front (every balanceOf read would revert). */
  setToken(addr: string, as?: number) {
    return this.run(async () => {
      const token = getAddress(addr);
      if (token !== ZeroAddress && (await this.provider.getCode(token)) === '0x') throw noCode();
      return this.send((await this.contracts(as)).vault, 'setToken', [token]);
    });
  }

  transferOwnership(newOwner: string, as?: number) {
    return this.run(async () => this.send((await this.contracts(as)).vault, 'transferOwnership', [getAddress(newOwner)]));
  }

  acceptOwnership(as?: number) {
    return this.run(async () => this.send((await this.contracts(as)).vault, 'acceptOwnership', []));
  }

  /** Always reverts RenounceDisabled (surfaced by the preflight). */
  renounceOwnership(as?: number) {
    return this.run(async () => this.send((await this.contracts(as)).vault, 'renounceOwnership', []));
  }

  addStakeholder(b: AddStakeholderDto) {
    return this.run(async () => {
      const { vault } = await this.contracts(b.as);
      const { total, steps } = buildSteps({ ...b, chainNow: await this.chainNow() });
      // Creates the plan, or replaces the user's whole plan if they already have one.
      return this.send(vault, 'replaceStakeholder', [b.user, steps, total]);
    });
  }

  previewGenerated(b: AddStakeholderDto) {
    return this.run(async () => {
      const { total, steps } = buildSteps({ ...b, chainNow: await this.chainNow() });
      return this.preview(b.user, steps, total, b.as);
    });
  }

  previewSchedule(b: ScheduleDto) {
    return this.run(async () => this.preview(b.user, scheduleToSteps(b.schedule), parseUnits(b.totalAmount, DECIMALS), b.as));
  }

  /**
   * What replaceStakeholder(user, steps, total) would do, with the contract's own formulas, plus the revert it
   * would hit (pending-block staticCall as signer `as`). Read-only; non-revert errors (e.g. NotDeployed) propagate.
   */
  private async preview(user: string, steps: Step[], total: bigint, as = 0) {
    const { d, vault, token } = await this.contracts(as);
    const addr = getAddress(user);
    const [u, dash, vaultBalance] = await Promise.all([vault.getUserDashboard(addr), vault.getFullDashboard(), token.balanceOf(d.vault)]);
    const exists = u.exists as boolean;
    const forfeited: bigint = exists ? (u.allocated as bigint) - (u.released as bigint) : 0n;
    const totalAllocatedAfter: bigint = (dash.allocated as bigint) - forfeited + total;
    const outstandingAfter = totalAllocatedAfter - (dash.claimed as bigint);
    const shortfall = outstandingAfter > vaultBalance ? outstandingAfter - (vaultBalance as bigint) : 0n;
    let wouldRevert: string | null = null;
    try {
      await vault.replaceStakeholder.staticCall(addr, steps, total, { blockTag: 'pending' });
    } catch (e) {
      const h = toHttpError(e, [vestingIface, tokenIface]);
      const body = h instanceof HttpException && h.getStatus() === 400 ? (h.getResponse() as { error?: string }) : null;
      if (!body?.error) throw h;
      wouldRevert = body.error;
    }
    return {
      exists,
      old: exists
        ? { allocated: fmt(u.allocated), released: fmt(u.released), lastClaimedStep: Number(u.lastClaimedStep), totalSteps: Number(u.totalSteps) }
        : null,
      forfeited: fmt(forfeited),
      newTotal: fmt(total),
      totalAllocatedAfter: fmt(totalAllocatedAfter),
      outstandingAfter: fmt(outstandingAfter),
      vaultBalance: fmt(vaultBalance),
      shortfall: fmt(shortfall),
      pastClaimsNotDeducted: exists && (u.released as bigint) > 0n,
      wouldRevert,
    };
  }

  /** replaceStakeholder with the steps exactly as sent (no checks), so the contract's own errors surface. */
  replaceWithSchedule(b: ScheduleDto) {
    return this.run(async () => {
      const { vault } = await this.contracts(b.as);
      return this.send(vault, 'replaceStakeholder', [b.user, scheduleToSteps(b.schedule), parseUnits(b.totalAmount, DECIMALS)]);
    });
  }

  removeStakeholder(addr: string, as?: number) {
    if (!isAddress(addr)) throw badRequest('addr must be an address');
    return this.run(async () => {
      const { vault } = await this.contracts(as);
      return this.send(vault, 'removeStakeholder', [getAddress(addr)]);
    });
  }

  /** claim() (next step) or claimAll(), signed by account `as` (default #1). */
  claim(b: ClaimDto) {
    return this.run(async () => {
      const { vault } = await this.contracts(b.as ?? 1);
      return this.send(vault, b.all ? 'claimAll' : 'claim', []);
    });
  }

  /**
   * Preflight at the *pending* block (it honours a pinned next-block timestamp; `latest` does not), then send.
   * Never pass gasLimit: ethers' estimateGas then surfaces the custom error and mines nothing.
   */
  private async send(c: Contract, fn: string, args: unknown[]): Promise<{ txHash: string }> {
    await c.getFunction(fn).staticCall(...args, { blockTag: 'pending' });
    const tx = await c.getFunction(fn)(...args);
    await tx.wait();
    return { txHash: tx.hash as string };
  }

  getStakeholder(addr: string) {
    if (!isAddress(addr)) throw badRequest('addr must be an address');
    const user = getAddress(addr);
    return this.run(async () => {
      const { vault, token } = await this.contracts();
      const [d, c, next, schedule, chainTime, bal] = await Promise.all([
        vault.getUserDashboard(user),
        vault.claimable(user),
        vault.getNextReleaseTime(user),
        vault.getSchedule(user),
        this.chainNow(),
        token.balanceOf(user),
      ]);
      return {
        exists: d.exists as boolean,
        allocated: fmt(d.allocated),
        released: fmt(d.released),
        lastClaimedStep: Number(d.lastClaimedStep),
        totalSteps: Number(d.totalSteps),
        claimable: fmt(c.amount),
        claimableSteps: Number(c.steps),
        nextReleaseTime: Number(next),
        chainTime,
        tokenBalance: fmt(bal),
        schedule: (schedule as { unlockTime: bigint; amount: bigint }[]).map((s) => ({
          unlockTime: Number(s.unlockTime),
          amount: fmt(s.amount),
        })),
      };
    });
  }

  listStakeholders() {
    return this.run(async () => {
      const { vault } = await this.contracts();
      const all: string[] = [];
      let offset = 0n;
      for (;;) {
        const [list, nextOffset]: [string[], bigint] = await vault.getStakeholders(offset, PAGE);
        all.push(...list);
        if (list.length < Number(PAGE) || nextOffset === offset) break;
        offset = nextOffset;
      }
      return Promise.all(all.map(async (a) => ({ address: a, ...(await this.getStakeholder(a)) })));
    });
  }

  getDashboard() {
    return this.run(async () => {
      const { vault } = await this.contracts();
      const d = await vault.getFullDashboard();
      return {
        allocated: fmt(d.allocated),
        claimed: fmt(d.claimed),
        remaining: fmt(d.remaining),
        count: Number(d.count),
        vaultBalance: fmt(d.vaultBalance),
      };
    });
  }

  async getTime() {
    return { chainTime: await this.chainNow() };
  }

  /**
   * Move time to `user`'s next unlock + offset. pin=false: set the next block's timestamp and mine an empty
   * block there (the next tx lands at target+1 or later). pin=true: only set it, so the next *mined* tx lands
   * exactly at target. Reads and preflight-caught reverts mine nothing and leave a pin in place.
   */
  jumpToUnlock(b: JumpDto) {
    return this.run(async () => {
      const { vault } = await this.contracts();
      const next = Number(await vault.getNextReleaseTime(getAddress(b.user)));
      if (next === 0) throw noNextUnlock();
      const target = next + (b.offset ?? 0);
      if (target <= (await this.chainNow())) throw timeInPast();
      await this.provider.send('evm_setNextBlockTimestamp', [target]);
      if (!b.pin) await this.provider.send('evm_mine', []);
      return { chainTime: await this.chainNow(), target, pinned: !!b.pin };
    });
  }

  /** The node's 20 unlocked accounts with their role and current-token balance. */
  accounts() {
    return this.run(async () => {
      const { vault, token } = await this.contracts();
      const addrs: string[] = (await this.provider.send('eth_accounts', [])).map((a: string) => getAddress(a));
      const [owner, pending] = await Promise.all([vault.owner(), vault.pendingOwner()]);
      return Promise.all(
        addrs.map(async (address, index) => ({
          index,
          address,
          tokenBalance: fmt(await token.balanceOf(address)),
          isOwner: address === owner,
          isPendingOwner: address === pending,
          isStakeholder: (await vault.getUserDashboard(address)).exists as boolean,
        })),
      );
    });
  }

  /** Every vault event since deployBlock, newest first (logs fetched in LOG_CHUNK-block windows; unknown logs skipped). */
  events() {
    return this.run(async () => {
      const { d } = await this.contracts();
      const latest = await this.provider.getBlockNumber();
      const times = new Map<number, number>();
      const out: (VaultEvent & { index: number })[] = [];
      for (const [fromBlock, toBlock] of blockChunks(d.deployBlock, latest)) {
        for (const log of await this.provider.getLogs({ address: d.vault, fromBlock, toBlock })) {
          const ev = decodeLog(vestingIface, log);
          if (!ev) continue;
          if (!times.has(log.blockNumber)) times.set(log.blockNumber, (await this.provider.getBlock(log.blockNumber))!.timestamp);
          out.push({ block: log.blockNumber, index: log.index, time: times.get(log.blockNumber)!, txHash: log.transactionHash, ...ev });
        }
      }
      return out.sort((a, b) => b.block - a.block || b.index - a.index).map(({ index, ...e }): VaultEvent => e);
    });
  }

  /** The vault's balance of every mock token; `current` marks the vault's token (others with a balance are stranded). */
  vaultBalances() {
    return this.run(async () => {
      const { d, tokenAddr } = await this.contracts();
      const s = await this.signer(0);
      return Promise.all(
        d.mockTokens.map(async (t) => ({
          token: t,
          vaultBalance: fmt(await new Contract(t, MockUSDTArtifact.abi, s).balanceOf(d.vault)),
          current: t === tokenAddr,
        })),
      );
    });
  }

  async skipTime(b: SkipTimeDto) {
    const seconds = b.seconds ?? b.days! * DAY;
    await this.provider.send('evm_increaseTime', [seconds]);
    await this.provider.send('evm_mine', []);
    return { chainTime: await this.chainNow() };
  }
}
