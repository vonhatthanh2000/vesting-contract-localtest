import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScenarioRun } from '../lib/api';
import ScenariosPage from './ScenariosPage';

const list = [
  { id: 'a-scenario', title: 'A', description: 'first' },
  { id: 'b-scenario', title: 'B', description: 'second' },
];
const pass = (id: string): ScenarioRun => ({
  id,
  vault: '0x' + '7'.repeat(40),
  pass: true,
  steps: [{ label: 'fund 1200', pass: true, expected: {}, actual: {}, time: 1_800_000_000, events: [{ name: 'Claimed', args: { amount: '300.0', fromStep: 1, toStep: 3 } }] }],
});
const fail = (id: string): ScenarioRun => ({
  id,
  vault: '0x' + '8'.repeat(40),
  pass: false,
  steps: [
    { label: 'ok step', pass: true, expected: {}, actual: {}, events: [] },
    { label: 'bad step', pass: false, expected: { dashboard: { vaultBalance: '999.0' } }, actual: { dashboard: { vaultBalance: '100.0' } }, events: [] },
  ],
});
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const page = () =>
  render(
    <MemoryRouter>
      <ScenariosPage />
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('ScenariosPage', () => {
  it('lists the catalog with the clock note', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(list)));
    page();
    expect(await screen.findByRole('button', { name: 'a-scenario' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/runs share the chain clock/);
  });

  it("a failing step shows expected vs actual; passing steps show their time and events", async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (new URL(url).pathname === '/scenarios' ? json(list) : json(fail('a-scenario')))));
    page();
    const a = await screen.findByRole('listitem', { name: 'a-scenario' });
    await userEvent.click(within(a).getByRole('button', { name: 'Run' }));
    expect(await within(a).findByText('✗ fail')).toBeInTheDocument();
    await userEvent.click(within(a).getByRole('button', { name: 'a-scenario' }));
    const pres = within(a).getAllByText(/expected|actual/, { selector: 'pre' });
    expect(pres[0]).toHaveTextContent('"vaultBalance": "999.0"');
    expect(pres[1]).toHaveTextContent('"vaultBalance": "100.0"');
    expect(pres).toHaveLength(2); // only the failing step gets the diff
  });

  it('shows each step chain time and events', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (new URL(url).pathname === '/scenarios' ? json(list) : json(pass('a-scenario')))));
    page();
    const a = await screen.findByRole('listitem', { name: 'a-scenario' });
    await userEvent.click(within(a).getByRole('button', { name: 'Run' }));
    await within(a).findByText('✓ pass');
    await userEvent.click(within(a).getByRole('button', { name: 'a-scenario' }));
    expect(within(a).getByText('2027-01-15 08:00:00 UTC')).toBeInTheDocument();
    expect(within(a).getByText('Claimed amount=300.0 fromStep=1 toStep=3')).toBeInTheDocument();
  });

  it('Run all runs one scenario at a time and disables every Run button while busy', async () => {
    const releases: (() => void)[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/scenarios') return json(list);
      await new Promise<void>((r) => releases.push(r));
      return json(pass(path.split('/')[2]));
    });
    vi.stubGlobal('fetch', fetchMock);
    page();
    await screen.findByRole('button', { name: 'a-scenario' });
    await userEvent.click(screen.getByRole('button', { name: 'Run all' }));
    const runCalls = () => fetchMock.mock.calls.filter(([u]) => new URL(u).pathname.endsWith('/run')).map(([u]) => new URL(u).pathname);

    await waitFor(() => expect(runCalls()).toEqual(['/scenarios/a-scenario/run']));
    for (const b of screen.getAllByRole('button', { name: /^Run( all)?$/ })) expect(b).toBeDisabled();
    releases.shift()!();
    await waitFor(() => expect(runCalls()).toEqual(['/scenarios/a-scenario/run', '/scenarios/b-scenario/run']));
    expect(screen.getByText('Running…')).toBeInTheDocument();
    releases.shift()!();
    await waitFor(() => expect(screen.queryByText('Running…')).not.toBeInTheDocument());
    expect(screen.getAllByText('✓ pass')).toHaveLength(2);
    for (const b of screen.getAllByRole('button', { name: /^Run( all)?$/ })) expect(b).toBeEnabled();
  });

  it('ScenarioBusy (a run from another tab) shows a toast and marks that scenario', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (new URL(url).pathname === '/scenarios' ? json(list) : json({ error: 'ScenarioBusy' }, 409))),
    );
    page();
    const b = await screen.findByRole('listitem', { name: 'b-scenario' });
    await userEvent.click(within(b).getByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('b-scenario: ScenarioBusy: a scenario is running; try again when it finishes');
    expect(within(b).getByText('✗ error')).toBeInTheDocument();
  });
});
