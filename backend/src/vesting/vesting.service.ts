import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatUnits, getAddress, isAddress, parseUnits } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { MockUSDTArtifact, MultiVestingArtifact, tokenIface, vestingIface } from './artifacts';
import { AddStakeholderDto, SkipTimeDto } from './dto';
import { badRequest, notDeployed, toHttpError } from './errors';
import { buildSteps, DAY, DECIMALS } from './steps';

export type Deployment = { token: string; vault: string; owner: string };

const fmt = (v: bigint) => formatUnits(v, DECIMALS);
const PAGE = 100n;

@Injectable()
export class VestingService implements OnModuleInit {
  private readonly log = new Logger(VestingService.name);
  // cacheTimeout -1: ethers' short RPC cache returns a stale nonce on back-to-back txs with Hardhat automine.
  private readonly provider = new JsonRpcProvider(config.rpcUrl, undefined, { cacheTimeout: -1 });
  private readonly owner = new Wallet(config.ownerKey, this.provider);
  private readonly file = config.deploymentFile ?? path.resolve(__dirname, '..', '..', 'deployment.json');
  private deployment: Deployment | null = null;

  async onModuleInit() {
    if (!fs.existsSync(this.file)) return;
    try {
      this.deployment = JSON.parse(fs.readFileSync(this.file, 'utf8'));
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

  private async contracts() {
    const d = await this.requireDeployment();
    return {
      d,
      vault: new Contract(d.vault, MultiVestingArtifact.abi, this.owner),
      token: new Contract(d.token, MockUSDTArtifact.abi, this.owner),
    };
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

  setup(): Promise<Deployment> {
    return this.run(async () => {
      const token = await new ContractFactory(MockUSDTArtifact.abi, MockUSDTArtifact.bytecode, this.owner).deploy(DECIMALS);
      await token.waitForDeployment();
      const tokenAddr = await token.getAddress();
      const vault = await new ContractFactory(MultiVestingArtifact.abi, MultiVestingArtifact.bytecode, this.owner).deploy(
        this.owner.address,
        tokenAddr,
      );
      await vault.waitForDeployment();
      this.deployment = { token: tokenAddr, vault: await vault.getAddress(), owner: this.owner.address };
      fs.writeFileSync(this.file, JSON.stringify(this.deployment, null, 2) + '\n');
      return this.deployment;
    });
  }

  async getDeployment(): Promise<Deployment> {
    try {
      return await this.requireDeployment();
    } catch {
      throw new NotFoundException({ error: 'NotDeployed' });
    }
  }

  fund(amount: string) {
    return this.run(async () => {
      const { d, token } = await this.contracts();
      await (await token.mint(d.vault, parseUnits(amount, DECIMALS))).wait();
      return { vaultBalance: fmt(await token.balanceOf(d.vault)) };
    });
  }

  addStakeholder(b: AddStakeholderDto) {
    return this.run(async () => {
      const { vault } = await this.contracts();
      const { total, steps } = buildSteps({ ...b, chainNow: await this.chainNow() });
      await vault.addStakeholder.staticCall(b.user, steps, total); // preflight: surfaces the custom error
      const tx = await vault.addStakeholder(b.user, steps, total);
      await tx.wait();
      return { txHash: tx.hash as string };
    });
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

  async skipTime(b: SkipTimeDto) {
    const seconds = b.seconds ?? b.days! * DAY;
    await this.provider.send('evm_increaseTime', [seconds]);
    await this.provider.send('evm_mine', []);
    return { chainTime: await this.chainNow() };
  }
}
