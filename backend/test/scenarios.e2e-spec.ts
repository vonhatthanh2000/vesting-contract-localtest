/**
 * E2E for the scenario runner (PLAN.md 07). Starts its own hardhat node on E2E_PORT (see chain.ts); the e2e specs run
 * in band, so this never overlaps with vesting.e2e-spec.ts.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CATALOG } from '../src/scenarios/catalog';
import { runScenario } from '../src/scenarios/runner';
import type { Scenario } from '../src/scenarios/types';
import { configureApp } from '../src/setup-app';
import { startChain, stopChain } from './chain';

describe('Scenario runner (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    fs.rmSync(process.env.DEPLOYMENT_FILE!, { force: true });
    await startChain();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await stopChain();
    fs.rmSync(process.env.DEPLOYMENT_FILE!, { force: true });
  });

  it('GET /scenarios lists the 12 replaceStakeholder scenarios', async () => {
    const r = await http().get('/scenarios').expect(200);
    expect(r.body.map((s: { id: string }) => s.id)).toEqual([
      'replace-new-user',
      'replace-after-partial-claim',
      'replace-invalid-schedules',
      'replace-before-claim',
      'replace-forfeits-unlocked',
      'replace-after-complete',
      'replace-removed-user',
      'replace-past-unlocks',
      'replace-boundary',
      'replace-non-owner',
      'replace-while-paused',
      'replace-keeps-others',
    ]);
    for (const s of r.body) expect(s).toEqual({ id: s.id, title: expect.any(String), description: expect.any(String) });
  });

  it.each(CATALOG.map((s) => s.id))('%s passes through the API', async (id) => {
    const r = await http().post(`/scenarios/${id}/run`).expect(200);
    const failed = r.body.steps.filter((s: { pass: boolean }) => !s.pass);
    expect(failed).toEqual([]);
    expect(r.body).toMatchObject({ id, pass: true, vault: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/) });
    expect(r.body.steps).toHaveLength(CATALOG.find((s) => s.id === id)!.steps.length);
    for (const st of r.body.steps) expect(st).toMatchObject({ time: expect.any(Number), events: expect.any(Array) });
  });

  it('an unknown id → 404 UnknownScenario', async () => {
    await http().post('/scenarios/nope/run').expect(404, { error: 'UnknownScenario' });
  });

  it('a wrong expectation is reported as pass:false with expected and actual; the run continues', async () => {
    const s: Scenario = {
      id: 'wrong',
      title: 't',
      description: 'd',
      users: [1],
      steps: [
        { label: 'fund 100, expecting 999', act: (c) => c.fund('100'), expect: { dashboard: { vaultBalance: '999.0' } } },
        { label: 'expect a revert that does not happen', act: (c) => c.fund('1'), expect: { revert: 'StepLocked' } },
        { label: 'a correct step after the failures', act: (c) => c.fund('1'), expect: { dashboard: { vaultBalance: '102.0' } } },
      ],
    };
    const r = await runScenario(s);
    expect(r.pass).toBe(false);
    expect(r.steps.map((x) => x.pass)).toEqual([false, false, true]);
    expect(r.steps[0]).toMatchObject({ expected: { dashboard: { vaultBalance: '999.0' } }, actual: { dashboard: { vaultBalance: '100.0' } } });
    expect(r.steps[1].actual).toMatchObject({ dashboard: { vaultBalance: '101.0' } });
  });

  it('an unexpected throw inside a step fails that step with `error`, and the run goes on', async () => {
    const r = await runScenario({
      id: 'throws',
      title: 't',
      description: 'd',
      users: [],
      steps: [
        { label: 'boom', act: async () => { throw new Error('not a revert'); }, expect: { dashboard: {} } },
        { label: 'after', act: (c) => c.fund('5'), expect: { dashboard: { vaultBalance: '5.0' } } },
      ],
    });
    expect(r.steps[0]).toMatchObject({ pass: false, error: 'not a revert' });
    expect(r.steps[1].pass).toBe(true);
  });

  it('a revert expectation also fails if the state changed', async () => {
    const r = await runScenario({
      id: 'changed',
      title: 't',
      description: 'd',
      users: [1],
      steps: [
        { label: 'fund then revert', act: async (c) => { await c.fund('10'); return c.send(1, 'claim', []); }, expect: { revert: 'NotStakeholder' } },
      ],
    });
    expect(r.steps[0]).toMatchObject({ pass: false, actual: { revert: 'NotStakeholder' } });
  });

  it('while a run is going: a second run, manual writes and /time/* → 409 ScenarioBusy; reads and previews still work', async () => {
    const running = http().post('/scenarios/replace-after-partial-claim/run').then((r) => r);
    await new Promise((r) => setTimeout(r, 300));
    await http().post('/scenarios/replace-new-user/run').expect(409, { error: 'ScenarioBusy' });
    await http().post('/fund').send({ amount: '1' }).expect(409, { error: 'ScenarioBusy' });
    await http().post('/time/skip').send({ days: 1 }).expect(409, { error: 'ScenarioBusy' });
    await http().post('/time/jump').send({ user: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' }).expect(409, { error: 'ScenarioBusy' });
    await http().delete('/stakeholders/0x70997970C51812dc3A010C7d01b50e0d17dc79C8').expect(409, { error: 'ScenarioBusy' });
    await http().get('/time').expect(200);
    const preview = await http().post('/stakeholders/preview').send({ user: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', totalAmount: '1', steps: 1, intervalDays: 1, firstUnlockInDays: 1 });
    expect(preview.body.error).not.toBe('ScenarioBusy');
    expect((await running).body.pass).toBe(true);
    // After the run, writes work again.
    await http().post('/time/skip').send({ seconds: 1 }).expect(200);
  });

  it("a run never touches the main deployment's dashboard", async () => {
    await http().post('/setup').expect(200);
    await http().post('/fund').send({ amount: '1200' }).expect(200);
    await http().post('/stakeholders').send({ user: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', totalAmount: '1200', steps: 12, intervalDays: 30, firstUnlockInDays: 30 }).expect(200);
    const before = (await http().get('/dashboard').expect(200)).body;
    const r = await http().post('/scenarios/replace-after-partial-claim/run').expect(200);
    expect(r.body.vault).not.toBe((await http().get('/deployment').expect(200)).body.vault);
    expect((await http().get('/dashboard').expect(200)).body).toEqual(before);
  });

  it('each step reports its chain time and its events with args', async () => {
    const r = await http().post('/scenarios/replace-past-unlocks/run').expect(200);
    const [fund, add, claim] = r.body.steps;
    expect(fund.events).toEqual([]); // a mint is a token event, not a vault event
    expect(add.events).toEqual([{ name: 'StakeholderAdded', args: expect.objectContaining({ totalAllocated: '300.0', totalSteps: 3 }) }]);
    expect(claim.events).toEqual([{ name: 'Claimed', args: expect.objectContaining({ amount: '300.0', fromStep: 1, toStep: 3 }) }]);
    expect(add.time).toBeGreaterThan(fund.time);
    expect(claim.time).toBeGreaterThan(add.time);
  });
});
