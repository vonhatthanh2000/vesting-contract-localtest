/**
 * End-to-end spec for the backend API.
 * Self-contained: it starts its own `hardhat node` on port 8546 (see e2e-env.ts) from the chain workspace,
 * so `npm run chain` is NOT required and a running dev chain on 8545 is left alone.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup-app';
import { startChain, stopChain } from './chain';

const U = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const U2 = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; // account #2
const ZERO = '0x0000000000000000000000000000000000000000';
const PLAN = { user: U, totalAmount: '1200', steps: 12, intervalDays: 30, firstUnlockInDays: 30 };

describe('Vesting API (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    fs.rmSync(process.env.DEPLOYMENT_FILE!, { force: true });
    await startChain();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await stopChain();
    fs.rmSync(process.env.DEPLOYMENT_FILE!, { force: true });
  });

  describe('before /setup', () => {
    it('GET /deployment → 404 NotDeployed', async () => {
      await http().get('/deployment').expect(404, { error: 'NotDeployed' });
    });
    it.each([
      ['post', '/fund', { amount: '1' }],
      ['post', '/stakeholders', PLAN],
      ['get', '/stakeholders', undefined],
      ['get', `/stakeholders/${U}`, undefined],
      ['get', '/dashboard', undefined],
      ['get', '/accounts', undefined],
      ['get', '/events', undefined],
      ['get', '/vault-balances', undefined],
      ['post', '/time/jump', { user: U }],
      ['post', '/stakeholders/preview', PLAN],
      ['post', '/stakeholders/schedule/preview', { user: U, totalAmount: '1', schedule: [{ unlockTime: 1, amount: '1' }] }],
    ] as const)('%s %s → 409 NotDeployed', async (method, url, body) => {
      const r = method === 'post' ? http().post(url).send(body) : http().get(url);
      await r.expect(409, { error: 'NotDeployed' });
    });
    it('GET /time works without a deployment', async () => {
      const r = await http().get('/time').expect(200);
      expect(typeof r.body.chainTime).toBe('number');
    });
  });

  describe('main flow (PLAN.md 01 How to verify)', () => {
    let vault: string;

    it('POST /setup deploys token and vault', async () => {
      const r = await http().post('/setup').expect(200);
      const addr = expect.stringMatching(/^0x[0-9a-fA-F]{40}$/);
      expect(r.body).toEqual({ vault: addr, deployBlock: expect.any(Number), mockTokens: [r.body.token], token: addr, owner: OWNER, pendingOwner: ZERO, paused: false });
      vault = r.body.vault;
      // Only the record is saved; token and owner are always read live from the vault.
      expect(JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_FILE!, 'utf8'))).toEqual({ vault, deployBlock: r.body.deployBlock, mockTokens: [r.body.token] });
      await http().get('/deployment').expect(200, r.body);
    });

    it('POST /fund mints to the vault', async () => {
      await http().post('/fund').send({ amount: '1200' }).expect(200, { vaultBalance: '1200.0' });
    });

    it('POST /stakeholders adds the plan', async () => {
      const r = await http().post('/stakeholders').send(PLAN).expect(200);
      expect(r.body.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('nothing is claimable right after add', async () => {
      const r = await http().get(`/stakeholders/${U}`).expect(200);
      expect(r.body).toMatchObject({ exists: true, allocated: '1200.0', claimable: '0.0', claimableSteps: 0, totalSteps: 12 });
      expect(r.body.schedule).toHaveLength(12);
      expect(r.body.nextReleaseTime).toBe(r.body.schedule[0].unlockTime);
    });

    it('after a 61-day skip, 2 steps (200.0) are claimable', async () => {
      const before = (await http().get('/time')).body.chainTime;
      const skip = await http().post('/time/skip').send({ days: 61 }).expect(200);
      expect(skip.body.chainTime).toBeGreaterThanOrEqual(before + 61 * 86400);
      const r = await http().get(`/stakeholders/${U}`).expect(200);
      expect(r.body).toMatchObject({ allocated: '1200.0', claimable: '200.0', claimableSteps: 2, totalSteps: 12 });
    });

    it('GET /dashboard', async () => {
      await http()
        .get('/dashboard')
        .expect(200, { allocated: '1200.0', claimed: '0.0', remaining: '1200.0', count: 1, vaultBalance: '1200.0' });
    });

    it('GET /stakeholders lists the stakeholder with its dashboard', async () => {
      const r = await http().get('/stakeholders').expect(200);
      expect(r.body).toHaveLength(1);
      expect(r.body[0]).toMatchObject({ address: U, allocated: '1200.0', claimable: '200.0' });
    });

    it('adding the same user again replaces the unclaimed plan', async () => {
      await http().post('/stakeholders').send({ ...PLAN, totalAmount: '600', steps: 6 }).expect(200);
      const r = await http().get(`/stakeholders/${U}`).expect(200);
      expect(r.body).toMatchObject({ allocated: '600.0', claimable: '0.0', totalSteps: 6 });
      await http().get('/dashboard').expect(200, { allocated: '600.0', claimed: '0.0', remaining: '600.0', count: 1, vaultBalance: '1200.0' });
    });

    it('POST /time/skip accepts seconds', async () => {
      const before = (await http().get('/time')).body.chainTime;
      const r = await http().post('/time/skip').send({ seconds: 3600 }).expect(200);
      expect(r.body.chainTime).toBeGreaterThanOrEqual(before + 3600);
    });

    it('/setup twice redeploys and overwrites', async () => {
      const r = await http().post('/setup').expect(200);
      expect(r.body.vault).not.toBe(vault);
      await http().get('/dashboard').expect(200, { allocated: '0.0', claimed: '0.0', remaining: '0.0', count: 0, vaultBalance: '0.0' });
    });
  });

  describe('signers, custom schedule, remove, claim (PLAN.md 01)', () => {
    let now: number;
    const sched = (user: string, totalAmount: string, schedule: { unlockTime: number; amount: string }[], as?: number) =>
      http().post('/stakeholders/schedule').send({ user, totalAmount, schedule, ...(as === undefined ? {} : { as }) });
    const claim = (as: number, all = false) => http().post('/claim').send({ as, all });
    const view = async (a: string) => (await http().get(`/stakeholders/${a}`).expect(200)).body;
    const dash = async () => (await http().get('/dashboard').expect(200)).body;

    beforeAll(async () => {
      await http().post('/setup').expect(200);
      await http().post('/fund').send({ amount: '1000' }).expect(200);
      now = (await http().get('/time')).body.chainTime;
    });

    it.each([
      ['a zero-amount step', U, '100', [{ unlockTime: 1, amount: '100' }, { unlockTime: 2, amount: '0' }], 'InvalidSchedule'],
      ['0 steps', U, '0', [], 'InvalidSchedule'],
      ['equal unlock times', U, '200', [{ unlockTime: 5, amount: '100' }, { unlockTime: 5, amount: '100' }], 'InvalidSchedule'],
      ['decreasing unlock times', U, '200', [{ unlockTime: 9, amount: '100' }, { unlockTime: 5, amount: '100' }], 'InvalidSchedule'],
      ['a sum that differs from the total', U, '150', [{ unlockTime: 1, amount: '100' }], 'AllocationMismatch'],
      ['the zero address', ZERO, '100', [{ unlockTime: 1, amount: '100' }], 'ZeroAddress'],
    ])('the custom schedule reaches the contract as sent: %s → %s', async (_l, user, total, schedule, error) => {
      await sched(user, total, schedule).expect(400, { error });
      expect(await dash()).toMatchObject({ allocated: '0.0', count: 0 });
    });

    it('101 steps → InvalidSchedule from the contract (DTO allows up to 150)', async () => {
      const steps = Array.from({ length: 101 }, (_, i) => ({ unlockTime: now + i + 1, amount: '1' }));
      await sched(U, '101', steps).expect(400, { error: 'InvalidSchedule' });
    });

    it('a non-owner (as:3) cannot replace a plan, by schedule or generator', async () => {
      await sched(U, '100', [{ unlockTime: now, amount: '100' }], 3).expect(400, { error: 'OwnableUnauthorizedAccount' });
      await http().post('/stakeholders').send({ ...PLAN, as: 3 }).expect(400, { error: 'OwnableUnauthorizedAccount' });
    });

    it('claim without a plan → NotStakeholder', async () => {
      await claim(1).expect(400, { error: 'NotStakeholder' });
    });

    it('claim pays one step, claimAll pays every consecutive unlocked step', async () => {
      await sched(U, '300', [
        { unlockTime: now - 30, amount: '100' },
        { unlockTime: now - 20, amount: '50' },
        { unlockTime: now - 10, amount: '50' },
        { unlockTime: now + 86400, amount: '100' },
      ]).expect(200);
      await claim(1).expect(200);
      expect(await view(U)).toMatchObject({ released: '100.0', lastClaimedStep: 1, tokenBalance: '100.0', claimable: '100.0', claimableSteps: 2 });
      await claim(1, true).expect(200);
      expect(await view(U)).toMatchObject({ released: '200.0', lastClaimedStep: 3, tokenBalance: '200.0', claimable: '0.0' });
    });

    it('nothing unlocked: claimAll → NothingClaimable, claim → StepLocked', async () => {
      await claim(1, true).expect(400, { error: 'NothingClaimable' });
      await claim(1).expect(400, { error: 'StepLocked' });
    });

    it('after the last step: claim → VestingComplete', async () => {
      await http().post('/time/skip').send({ days: 2 }).expect(200);
      await claim(1, true).expect(200);
      expect(await view(U)).toMatchObject({ released: '300.0', lastClaimedStep: 4, totalSteps: 4, tokenBalance: '300.0' });
      await claim(1).expect(400, { error: 'VestingComplete' });
      await claim(1, true).expect(400, { error: 'NothingClaimable' });
    });

    it('claim signs as account #1 by default', async () => {
      await http().post('/claim').send({}).expect(400, { error: 'VestingComplete' });
    });

    it('remove: non-owner rejected, then forfeited (allocated − released) leaves allocated', async () => {
      now = (await http().get('/time')).body.chainTime;
      await sched(U2, '300', [
        { unlockTime: now - 10, amount: '100' },
        { unlockTime: now + 86400, amount: '200' },
      ]).expect(200);
      await claim(2).expect(200);
      expect(await dash()).toMatchObject({ allocated: '600.0', claimed: '400.0', remaining: '200.0', count: 2 });

      await http().delete(`/stakeholders/${U2}?as=3`).expect(400, { error: 'OwnableUnauthorizedAccount' });
      await http().delete(`/stakeholders/${U2}`).expect(200);

      expect(await view(U2)).toMatchObject({ exists: false, allocated: '0.0', totalSteps: 0 });
      expect(await dash()).toMatchObject({ allocated: '400.0', claimed: '400.0', remaining: '0.0', count: 1 });
    });

    it('remove an address without a plan → NotStakeholder; a bad address → BadRequest', async () => {
      await http().delete(`/stakeholders/${U2}`).expect(400, { error: 'NotStakeholder' });
      const r = await http().delete('/stakeholders/nope').expect(400);
      expect(r.body.error).toBe('BadRequest');
    });
  });

  describe('admin: pause, emergency withdraw, token switch, ownership (PLAN.md 02)', () => {
    const post = (url: string, body: object = {}) => http().post(url).send(body);
    const view = async (a: string) => (await http().get(`/stakeholders/${a}`).expect(200)).body;
    const dep = async () => (await http().get('/deployment').expect(200)).body;
    const ME = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // account #3: a non-owner with no plan
    let now: number;

    beforeAll(async () => {
      await post('/setup').expect(200);
      await post('/fund', { amount: '300' }).expect(200);
      now = (await http().get('/time')).body.chainTime;
      await post('/stakeholders/schedule', {
        user: U,
        totalAmount: '300',
        schedule: [{ unlockTime: now - 10, amount: '100' }, { unlockTime: now + 86400, amount: '200' }],
      }).expect(200);
    });

    it('pause blocks claims (EnforcedPause) but admin writes still work', async () => {
      await post('/pause').expect(200);
      await post('/claim', { as: 1 }).expect(400, { error: 'EnforcedPause' });
      await post('/pause').expect(400, { error: 'EnforcedPause' });
      await post('/stakeholders/schedule', {
        user: U,
        totalAmount: '300',
        schedule: [{ unlockTime: now - 10, amount: '100' }, { unlockTime: now + 86400, amount: '200' }],
      }).expect(200);
      await post('/unpause').expect(200);
      await post('/unpause').expect(400, { error: 'ExpectedPause' });
      await post('/claim', { as: 1 }).expect(200);
      expect(await view(U)).toMatchObject({ released: '100.0', tokenBalance: '100.0' });
    });

    it('a non-owner cannot pause, withdraw, set the token or transfer ownership', async () => {
      await post('/pause', { as: 3 }).expect(400, { error: 'OwnableUnauthorizedAccount' });
      await post('/emergency-withdraw', { to: ME, amount: '1', as: 3 }).expect(400, { error: 'OwnableUnauthorizedAccount' });
      await post('/token', { token: (await dep()).token, as: 3 }).expect(400, { error: 'OwnableUnauthorizedAccount' });
      await post('/ownership/transfer', { newOwner: ME, as: 3 }).expect(400, { error: 'OwnableUnauthorizedAccount' });
    });

    it('emergency withdraw: 0 → ZeroAmount, 0x0 → ZeroAddress', async () => {
      await post('/emergency-withdraw', { to: ME, amount: '0' }).expect(400, { error: 'ZeroAmount' });
      await post('/emergency-withdraw', { to: ZERO, amount: '1' }).expect(400, { error: 'ZeroAddress' });
    });

    it('withdrawing owed tokens makes the next claim fail (ERC20InsufficientBalance); refunding fixes it', async () => {
      await post('/emergency-withdraw', { to: ME, amount: '200' }).expect(200);
      expect(await http().get('/dashboard').expect(200)).toHaveProperty('body.vaultBalance', '0.0');
      await post('/time/skip', { days: 2 }).expect(200);
      expect(await view(U)).toMatchObject({ claimable: '200.0' }); // views ignore the vault balance
      await post('/claim', { as: 1 }).expect(400, { error: 'ERC20InsufficientBalance' });
      await post('/fund', { amount: '200' }).expect(200, { vaultBalance: '200.0' });
      await post('/claim', { as: 1 }).expect(200);
      expect(await view(U)).toMatchObject({ released: '300.0', tokenBalance: '300.0' });
    });

    it('setToken: 0x0 → ZeroAddress, no code → NoCode, owed tokens → ActivePlans', async () => {
      await post('/token', { token: ZERO }).expect(400, { error: 'ZeroAddress' });
      await post('/token', { token: '0x000000000000000000000000000000000000dEaD' }).expect(400, { error: 'NoCode' });
      await post('/stakeholders/schedule', { user: U2, totalAmount: '50', schedule: [{ unlockTime: now + 864000, amount: '50' }] }).expect(400, { error: 'InsufficientVaultBalance' });
      await post('/fund', { amount: '50' }).expect(200);
      await post('/stakeholders/schedule', { user: U2, totalAmount: '50', schedule: [{ unlockTime: now + 864000, amount: '50' }] }).expect(200);
      const { token } = (await post('/tokens').expect(200)).body;
      await post('/token', { token }).expect(400, { error: 'ActivePlans' });
    });

    it('setToken once nothing is owed: the token switches and the old balance is left behind', async () => {
      await http().delete(`/stakeholders/${U2}`).expect(200);
      const before = await dep();
      const next = before.mockTokens[1];
      await post('/token', { token: next }).expect(200);
      const after = await dep();
      expect(after).toMatchObject({ token: next, mockTokens: [before.token, next] });
      // The default /fund now mints the new token; the old token's 50 stays in the vault.
      await post('/fund', { amount: '7' }).expect(200, { vaultBalance: '7.0' });
      await post('/fund', { amount: '1', token: before.token }).expect(200, { vaultBalance: '51.0' });
      // The dashboard (and the admin page's underfunded banner) reads the vault's balance of its current token only.
      expect((await http().get('/dashboard').expect(200)).body.vaultBalance).toBe('7.0');
      const r = await post('/fund', { amount: '1', token: '0x000000000000000000000000000000000000dEaD' }).expect(400);
      expect(r.body).toEqual({ error: 'BadRequest', message: 'token must be one of mockTokens' });
    });

    it('two-step ownership: only the pending owner accepts; the old owner is then rejected', async () => {
      await post('/ownership/accept', { as: 2 }).expect(400, { error: 'OwnableUnauthorizedAccount' }); // nothing pending
      await post('/ownership/transfer', { newOwner: U2 }).expect(200);
      expect((await dep()).owner).toBe(OWNER); // not yet
      await post('/ownership/accept', { as: 3 }).expect(400, { error: 'OwnableUnauthorizedAccount' });
      await post('/ownership/accept', { as: 2 }).expect(200);
      expect((await dep()).owner).toBe(U2);
      await post('/pause').expect(400, { error: 'OwnableUnauthorizedAccount' });
      await post('/pause', { as: 2 }).expect(200);
      await post('/unpause', { as: 2 }).expect(200);
    });

    it('renounceOwnership always reverts RenounceDisabled, for owner and non-owner', async () => {
      await post('/ownership/renounce', { as: 2 }).expect(400, { error: 'RenounceDisabled' });
      await post('/ownership/renounce').expect(400, { error: 'RenounceDisabled' });
      expect((await dep()).owner).toBe(U2);
    });

    it('/setup resets mockTokens to the new mock', async () => {
      const r = await post('/setup').expect(200);
      expect(r.body.mockTokens).toEqual([r.body.token]);
    });
  });

  describe('live status, accounts, events, balances, time jump (PLAN.md 03)', () => {
    const post = (url: string, body: object = {}) => http().post(url).send(body);
    const get = async (url: string) => (await http().get(url).expect(200)).body;
    const chainTime = async (): Promise<number> => (await get('/time')).chainTime;
    const U3 = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'; // account #4
    let unlock2: number;

    beforeAll(async () => {
      await post('/setup').expect(200);
      await post('/fund', { amount: '300' }).expect(200);
      const now = await chainTime();
      unlock2 = now + 86400;
      await post('/stakeholders/schedule', {
        user: U,
        totalAmount: '300',
        schedule: [{ unlockTime: now - 10, amount: '100' }, { unlockTime: unlock2, amount: '200' }],
      }).expect(200);
      await post('/claim', { as: 1 }).expect(200);
    });

    it('a user without a plan → NoNextUnlock', async () => {
      await post('/time/jump', { user: U2 }).expect(400, { error: 'NoNextUnlock' });
    });

    it('a pin at unlock − 1 survives preflight-caught reverts; a pin at the unlock lands the claim on that exact second', async () => {
      const before = await chainTime();
      const j = await post('/time/jump', { user: U, offset: -1, pin: true }).expect(200);
      expect(j.body).toEqual({ chainTime: before, target: unlock2 - 1, pinned: true });
      await post('/claim', { as: 1 }).expect(400, { error: 'StepLocked' });
      await post('/claim', { as: 1 }).expect(400, { error: 'StepLocked' }); // nothing was mined: same pinned second
      expect(await chainTime()).toBe(before);
      await post('/time/jump', { user: U, offset: 0, pin: true }).expect(200);
      await post('/claim', { as: 1 }).expect(200);
      const [last] = await get('/events');
      expect(last).toMatchObject({ name: 'Claimed', time: unlock2, args: { user: U, amount: '200.0', fromStep: 2, toStep: 2 } });
    });

    it('an unrelated mined tx uses up the pin', async () => {
      const now = await chainTime();
      const unlock = now + 1000;
      await post('/fund', { amount: '100' }).expect(200);
      await post('/stakeholders/schedule', { user: U3, totalAmount: '100', schedule: [{ unlockTime: unlock, amount: '100' }] }).expect(200);
      await post('/time/jump', { user: U3, offset: -1, pin: true }).expect(200);
      await post('/fund', { amount: '1' }).expect(200); // mined at unlock − 1
      expect(await chainTime()).toBe(unlock - 1);
      await post('/claim', { as: 4 }).expect(200); // next block is past the unlock
      expect((await get(`/stakeholders/${U3}`)).released).toBe('100.0');
    });

    it('jump without pin mines a block at the target; a target in the past → TimeInPast', async () => {
      const now = await chainTime();
      await post('/fund', { amount: '50' }).expect(200);
      await post('/stakeholders/schedule', {
        user: U2,
        totalAmount: '50',
        schedule: [{ unlockTime: now - 5, amount: '25' }, { unlockTime: now + 500, amount: '25' }],
      }).expect(200);
      // The next unclaimed step is already unlocked (now − 5) → its time is in the past.
      await post('/time/jump', { user: U2 }).expect(400, { error: 'TimeInPast' });
      await post('/claim', { as: 2 }).expect(200);
      const j = await post('/time/jump', { user: U2, offset: 1 }).expect(200);
      expect(j.body).toEqual({ chainTime: now + 501, target: now + 501, pinned: false });
      expect((await get(`/stakeholders/${U2}`)).claimable).toBe('25.0');
      await post('/time/jump', { user: U2, offset: -1 }).expect(400, { error: 'TimeInPast' });
    });

    it('/accounts lists the 20 node accounts with balances and stakeholder flags', async () => {
      const acc = await get('/accounts');
      expect(acc).toHaveLength(20);
      expect(acc[0]).toEqual({ index: 0, address: OWNER, tokenBalance: '0.0', isOwner: true, isPendingOwner: false, isStakeholder: false });
      expect(acc[1]).toMatchObject({ address: U, tokenBalance: '300.0', isStakeholder: true });
      expect(acc[4]).toMatchObject({ address: U3, tokenBalance: '100.0', isStakeholder: true });
      expect(acc[5]).toMatchObject({ isOwner: false, isStakeholder: false, tokenBalance: '0.0' });
    });

    it('a stranded token shows in /vault-balances with current:false', async () => {
      for (const a of [U, U2, U3]) await http().delete(`/stakeholders/${a}`).expect(200);
      const { mockTokens: [first] } = await get('/deployment');
      const firstLeft = (await get('/vault-balances'))[0].vaultBalance;
      expect(Number(firstLeft)).toBeGreaterThan(0);
      const { token: second } = (await post('/tokens').expect(200)).body;
      await post('/token', { token: second }).expect(200);
      expect(await get('/vault-balances')).toEqual([
        { token: first, vaultBalance: firstLeft, current: false },
        { token: second, vaultBalance: '0.0', current: true },
      ]);
    });

    it('/events: newest first, every event since deployBlock', async () => {
      const ev = await get('/events');
      const blocks = ev.map((e: { block: number }) => e.block);
      expect([...blocks].sort((a, b) => b - a)).toEqual(blocks);
      expect(ev[0]).toMatchObject({ name: 'TokenUpdated', args: { newToken: (await get('/deployment')).token } });
      expect(ev.at(-1)).toMatchObject({ name: 'OwnershipTransferred', args: { previousOwner: ZERO, newOwner: OWNER } });
      expect(ev.at(-1).block).toBe((await get('/deployment')).deployBlock);
      expect(ev.filter((e: { name: string }) => e.name === 'StakeholderRemoved')).toHaveLength(3);
    });

    it('pending owner and owner flags follow a transfer in /deployment and /accounts', async () => {
      await post('/ownership/transfer', { newOwner: U2 }).expect(200);
      expect(await get('/deployment')).toMatchObject({ owner: OWNER, pendingOwner: U2 });
      expect((await get('/accounts'))[2]).toMatchObject({ isOwner: false, isPendingOwner: true });
      await post('/ownership/accept', { as: 2 }).expect(200);
      expect(await get('/deployment')).toMatchObject({ owner: U2, pendingOwner: ZERO });
      const acc = await get('/accounts');
      expect(acc[0]).toMatchObject({ isOwner: false, isPendingOwner: false });
      expect(acc[2]).toMatchObject({ isOwner: true, isPendingOwner: false });
      await post('/pause', { as: 2 }).expect(200);
      expect((await get('/deployment')).paused).toBe(true);
      const names = (await get('/events')).slice(0, 3).map((e: { name: string }) => e.name);
      expect(names).toEqual(['Paused', 'OwnershipTransferred', 'OwnershipTransferStarted']);
    });
  });

  describe('replace preview matches the contract after the replace (PLAN.md 04 H6)', () => {
    const post = (url: string, body: object = {}) => http().post(url).send(body);
    const dash = async () => (await http().get('/dashboard').expect(200)).body;
    const U3 = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'; // account #4
    const units = (v: string) => BigInt(v.replace('.', '')) * 10n ** BigInt(18 - (v.split('.')[1]?.length ?? 0));

    /** Preview via `route`, send the same plan, then check every preview number against the new on-chain state. */
    async function checkPreview(route: 'generator' | 'schedule', body: Record<string, unknown>) {
      const before = await dash();
      const p = (await post(route === 'generator' ? '/stakeholders/preview' : '/stakeholders/schedule/preview', body).expect(200)).body;
      expect(p.wouldRevert).toBeNull();
      await post(route === 'generator' ? '/stakeholders' : '/stakeholders/schedule', body).expect(200);
      const after = await dash();
      expect(p.totalAllocatedAfter).toBe(after.allocated);
      expect(p.outstandingAfter).toBe(after.remaining);
      expect(units(p.forfeited)).toBe(units(before.allocated) - units(after.allocated) + units(p.newTotal));
      const s = units(after.remaining) - units(after.vaultBalance);
      expect(units(p.shortfall)).toBe(s > 0n ? s : 0n);
      return p;
    }

    let now: number;
    beforeAll(async () => {
      await post('/setup').expect(200);
      await post('/fund', { amount: '5000' }).expect(200);
      now = (await http().get('/time')).body.chainTime;
    });

    it('a new user (generator route): nothing forfeited, old is null', async () => {
      const p = await checkPreview('generator', { ...PLAN, user: U3, totalAmount: '1200', steps: 12 });
      expect(p).toMatchObject({ exists: false, old: null, forfeited: '0.0', newTotal: '1200.0', pastClaimsNotDeducted: false });
    });

    it('a user before any claim (schedule route): the whole old plan is forfeited', async () => {
      const p = await checkPreview('schedule', { user: U3, totalAmount: '600', schedule: [{ unlockTime: now + 86400, amount: '600' }] });
      expect(p).toMatchObject({ exists: true, old: { allocated: '1200.0', released: '0.0', totalSteps: 12 }, forfeited: '1200.0', pastClaimsNotDeducted: false });
    });

    it('a user after a partial claim (both routes): only the unclaimed part is forfeited; past claims are not deducted', async () => {
      await post('/stakeholders/schedule', {
        user: U,
        totalAmount: '300',
        schedule: [{ unlockTime: now - 10, amount: '100' }, { unlockTime: now + 86400, amount: '200' }],
      }).expect(200);
      await post('/claim', { as: 1 }).expect(200);
      const g = await checkPreview('generator', { ...PLAN, totalAmount: '400', steps: 4 });
      expect(g).toMatchObject({ old: { allocated: '300.0', released: '100.0', lastClaimedStep: 1 }, forfeited: '200.0', pastClaimsNotDeducted: true });
      // The replace reset released to 0, so the second preview of the same user forfeits the whole 400.
      const s = await checkPreview('schedule', { user: U, totalAmount: '50', schedule: [{ unlockTime: now + 999, amount: '50' }] });
      expect(s).toMatchObject({ old: { allocated: '400.0', released: '0.0' }, forfeited: '400.0', pastClaimsNotDeducted: false });
    });

    it('wouldRevert = InsufficientVaultBalance exactly when shortfall > 0, and nothing is sent', async () => {
      const before = await dash();
      const p = (await post('/stakeholders/schedule/preview', { user: U2, totalAmount: '99999', schedule: [{ unlockTime: now + 5, amount: '99999' }] }).expect(200)).body;
      expect(units(p.shortfall)).toBeGreaterThan(0n);
      expect(p.wouldRevert).toBe('InsufficientVaultBalance');
      expect(await dash()).toEqual(before);
    });

    it('other reverts too: a schedule error, and a non-owner (as:3)', async () => {
      const bad = (await post('/stakeholders/schedule/preview', { user: U2, totalAmount: '2', schedule: [{ unlockTime: 1, amount: '1' }] }).expect(200)).body;
      expect(bad.wouldRevert).toBe('AllocationMismatch');
      const g = (await post('/stakeholders/preview', { ...PLAN, user: U2, totalAmount: '10', as: 3 }).expect(200)).body;
      expect(g.wouldRevert).toBe('OwnableUnauthorizedAccount');
    });
  });

  describe('deployment record across a backend restart (PLAN.md 02 H2)', () => {
    const file = process.env.DEPLOYMENT_FILE!;
    const boot = async () => {
      const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const a = mod.createNestApplication();
      configureApp(a);
      await a.init();
      return a;
    };

    it('mockTokens and the deploy block survive a restart', async () => {
      await http().post('/setup').expect(200);
      await http().post('/tokens').expect(200);
      const saved = (await http().get('/deployment').expect(200)).body;
      const second = await boot();
      try {
        await request(second.getHttpServer()).get('/deployment').expect(200, saved);
      } finally {
        await second.close();
      }
    });

    it('an old-format deployment.json ({ token, vault, owner }) is treated as not deployed', async () => {
      const { vault, mockTokens } = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.writeFileSync(file, JSON.stringify({ token: mockTokens[0], vault, owner: OWNER }));
      const second = await boot();
      try {
        await request(second.getHttpServer()).get('/deployment').expect(404, { error: 'NotDeployed' });
        await request(second.getHttpServer()).get('/dashboard').expect(409, { error: 'NotDeployed' });
      } finally {
        await second.close();
      }
    });
  });

  describe('validation → 400 BadRequest', () => {
    it.each([
      ['/fund', { amount: '0' }],
      ['/fund', { amount: '-5' }],
      ['/fund', { amount: 'abc' }],
      ['/fund', { amount: 1200 }],
      ['/stakeholders', { ...PLAN, user: '0x123' }],
      ['/stakeholders', { ...PLAN, totalAmount: '0' }],
      ['/stakeholders', { ...PLAN, steps: 0 }],
      ['/stakeholders', { ...PLAN, steps: 101 }],
      ['/stakeholders', { ...PLAN, intervalDays: 0 }],
      ['/stakeholders', { ...PLAN, firstUnlockInDays: -1 }],
      ['/time/skip', {}],
      ['/time/skip', { days: 0 }],
      ['/time/skip', { seconds: -1 }],
      ['/stakeholders', { ...PLAN, as: 20 }],
      ['/stakeholders', { ...PLAN, as: 1.5 }],
      ['/claim', { as: 20 }],
      ['/claim', { as: -1 }],
      ['/claim', { all: 'yes' }],
      ['/stakeholders/schedule', { user: U, totalAmount: '1', schedule: [{ unlockTime: 1, amount: '1' }], as: 20 }],
      ['/stakeholders/schedule', { user: U, totalAmount: '1', schedule: [{ unlockTime: 1, amount: '-1' }] }],
      ['/stakeholders/schedule', { user: U, totalAmount: '1', schedule: [{ unlockTime: -1, amount: '1' }] }],
      ['/stakeholders/schedule', { user: U, totalAmount: '1', schedule: 'x' }],
      ['/fund', { amount: '1', token: '0x123' }],
      ['/time/jump', { user: '0x1' }],
      ['/time/jump', { user: U, offset: 2 }],
      ['/time/jump', { user: U, pin: 'yes' }],
      ['/pause', { as: 20 }],
      ['/emergency-withdraw', { to: '0x123', amount: '1' }],
      ['/emergency-withdraw', { to: U, amount: '-1' }],
      ['/emergency-withdraw', { to: U }],
      ['/token', {}],
      ['/token', { token: 'abc' }],
      ['/ownership/transfer', { newOwner: '0x1' }],
      ['/ownership/accept', { as: 'two' }],
      ['/stakeholders/schedule', { user: U, totalAmount: '151', schedule: Array.from({ length: 151 }, (_, i) => ({ unlockTime: i, amount: '1' })) }],
    ])('POST %s %j', async (url, body) => {
      const r = await http().post(url).send(body).expect(400);
      expect(r.body.error).toBe('BadRequest');
      expect(typeof r.body.message).toBe('string');
    });

    it('DELETE /stakeholders/:addr?as=20', async () => {
      const r = await http().delete(`/stakeholders/${U}?as=20`).expect(400);
      expect(r.body).toEqual({ error: 'BadRequest', message: 'as must not be greater than 19' });
    });

    it('GET /stakeholders/not-an-address', async () => {
      const r = await http().get('/stakeholders/nope').expect(400);
      expect(r.body.error).toBe('BadRequest');
    });
  });

  describe('chain restart', () => {
    it('a restarted (empty) chain makes the saved deployment stale → 409 NotDeployed', async () => {
      await stopChain();
      await startChain();
      await http().get('/dashboard').expect(409, { error: 'NotDeployed' });
      await http().get('/deployment').expect(404, { error: 'NotDeployed' });
      await http().post('/setup').expect(200);
      await http().get('/dashboard').expect(200);
    });
  });
});
