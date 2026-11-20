/**
 * End-to-end spec for the backend API.
 * Self-contained: it starts its own `hardhat node` on port 8546 (see e2e-env.ts) from the chain workspace,
 * so `npm run chain` is NOT required and a running dev chain on 8545 is left alone.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup-app';
import { E2E_PORT } from './e2e-env';

const U = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PLAN = { user: U, totalAmount: '1200', steps: 12, intervalDays: 30, firstUnlockInDays: 30 };
const CHAIN_DIR = path.resolve(__dirname, '..', '..', 'chain');
const HARDHAT = path.resolve(__dirname, '..', '..', 'node_modules', '.bin', 'hardhat');

let chain: ChildProcess | undefined;

function startChain(): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(HARDHAT, ['node', '--port', String(E2E_PORT)], { cwd: CHAIN_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    chain = p;
    const timer = setTimeout(() => reject(new Error('hardhat node did not start in 30s')), 30_000);
    p.stdout!.on('data', (b: Buffer) => {
      if (b.toString().includes('Started HTTP')) {
        clearTimeout(timer);
        resolve();
      }
    });
    p.on('exit', (code) => code && reject(new Error(`hardhat node exited with ${code}`)));
  });
}

function stopChain(): Promise<void> {
  return new Promise((resolve) => {
    if (!chain || chain.exitCode !== null) return resolve();
    chain.once('exit', () => resolve());
    chain.kill('SIGTERM');
  });
}

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
      expect(r.body).toEqual({ token: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/), vault: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/), owner: OWNER });
      vault = r.body.vault;
      expect(JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_FILE!, 'utf8')).vault).toBe(vault);
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

    it('adding the same user twice → 400 AlreadyStakeholder', async () => {
      await http().post('/stakeholders').send(PLAN).expect(400, { error: 'AlreadyStakeholder' });
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
    ])('POST %s %j', async (url, body) => {
      const r = await http().post(url).send(body).expect(400);
      expect(r.body.error).toBe('BadRequest');
      expect(typeof r.body.message).toBe('string');
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
