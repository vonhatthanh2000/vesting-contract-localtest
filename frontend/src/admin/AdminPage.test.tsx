import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import AdminPage from './AdminPage';

// AdminPage links to /scenarios, so it needs a router.
const Page = () => (
  <MemoryRouter>
    <AdminPage />
  </MemoryRouter>
);

// PLAN 02 acceptance: "A backend error appears as a toast with the error name."
const deployment = {
  vault: '0x' + '2'.repeat(40),
  deployBlock: 1,
  mockTokens: ['0x' + '1'.repeat(40)],
  token: '0x' + '1'.repeat(40),
  owner: '0x' + '3'.repeat(40),
  pendingOwner: '0x' + '0'.repeat(40),
  paused: false,
};
const U1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const accounts = Array.from({ length: 4 }, (_, index) => ({
  index,
  address: [deployment.owner, U1, '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', '0x90F79bf6EB2c4f870365E785982E1f101E93b906'][index],
  tokenBalance: '0.0',
  isOwner: index === 0,
  isPendingOwner: false,
  isStakeholder: index === 1,
}));
const schedule = [
  { unlockTime: 1_800_086_401, amount: '100.0' },
  { unlockTime: 1_802_678_401, amount: '200.5' },
  { unlockTime: 1_805_270_401, amount: '0.000000000000000001' },
];
const stakeholder = {
  address: U1, exists: true, allocated: '300.500000000000000001', released: '100.0', lastClaimedStep: 1, totalSteps: 3,
  claimable: '0.0', claimableSteps: 0, nextReleaseTime: schedule[1].unlockTime, chainTime: 1_800_000_000, tokenBalance: '100.0', schedule,
};
const tx = () => json({ txHash: '0x' + 'a'.repeat(64) });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const posted = (m: ReturnType<typeof vi.fn>, path: string) =>
  m.mock.calls.filter(([url, init]) => init?.method === 'POST' && new URL(url).pathname === path).map(([, init]) => JSON.parse(init!.body as string));
const preview = { exists: false, old: null, forfeited: '0.0', newTotal: '1200.0', totalAllocatedAfter: '2400.0', outstandingAfter: '2400.0', vaultBalance: '1200.0', shortfall: '1200.0', pastClaimsNotDeducted: false, wouldRevert: 'InsufficientVaultBalance' };
const dashboard = { allocated: '1200.0', claimed: '0.0', remaining: '1200.0', count: 1, vaultBalance: '1200.0' };

function mockBackend(overrides: Record<string, () => Response> = {}) {
  const routes: Record<string, () => Response> = {
    'GET /time': () => json({ chainTime: 1_800_000_000 }),
    'GET /deployment': () => json(deployment),
    'GET /dashboard': () => json(dashboard),
    'GET /stakeholders': () => json([]),
    'GET /accounts': () => json(accounts),
    'GET /events': () => json([]),
    'GET /vault-balances': () => json([{ token: deployment.token, vaultBalance: '1200.0', current: true }]),
    'POST /stakeholders/preview': () => json(preview),
    ...overrides,
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`.replace(/^DELETE \/stakeholders\/.*/, 'DELETE /stakeholders/:addr');
    const handler = routes[key];
    if (!handler) throw new Error(`unmocked ${key}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AdminPage', () => {
  it('shows a backend error as a toast with the error name', async () => {
    const fetchMock = mockBackend({
      'POST /stakeholders': () => new Response(JSON.stringify({ error: 'AllocationMismatch' }), { status: 400 }),
    });
    render(<Page />);
    const add = await screen.findByRole('button', { name: 'Add plan' });
    await waitFor(() => expect(add).toBeEnabled());
    await userEvent.click(add);
    expect(await screen.findByText('AllocationMismatch: step amounts do not add up to the total')).toBeInTheDocument();
    // The preview still says the send would revert, but sending stays allowed.
    expect(await screen.findByText(/Would revert: InsufficientVaultBalance/)).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([url, init]) => init?.method === 'POST' && new URL(url).pathname === '/stakeholders');
    expect(JSON.parse(post![1]!.body as string)).toEqual({
      user: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      totalAmount: '1200',
      steps: 12,
      intervalDays: 30,
      firstUnlockInDays: 30,
      as: 0, // Act as defaults to the owner, #0
    });
  });

  it('locks everything except Setup when not deployed', async () => {
    mockBackend({ 'GET /deployment': () => new Response(JSON.stringify({ error: 'NotDeployed' }), { status: 404 }) });
    render(<Page />);
    await screen.findByText(/Not deployed\. Click Setup/);
    expect(screen.getByRole('button', { name: 'Setup' })).toBeEnabled();
    for (const name of ['Fund', 'Add plan', '+30 days', '+1 day', '+N days']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
});

describe('AdminPage: Act as and row actions (PLAN 05)', () => {
  const withRow = { 'GET /stakeholders': () => json([stakeholder]) };
  const ready = async () => {
    const add = await screen.findByRole('button', { name: /Add plan|Replace plan/ });
    await waitFor(() => expect(add).toBeEnabled());
    await screen.findByRole('option', { name: /#3/ });
  };

  it('the Act-as value reaches the write and the preview', async () => {
    const fetchMock = mockBackend({ 'POST /stakeholders': tx });
    render(<Page />);
    await ready();
    await userEvent.selectOptions(screen.getByLabelText('Act as'), '3');
    await waitFor(() => expect(posted(fetchMock, '/stakeholders/preview').at(-1)).toMatchObject({ as: 3 }));
    await userEvent.click(screen.getByRole('button', { name: /Add plan|Replace plan/ }));
    await waitFor(() => expect(posted(fetchMock, '/stakeholders')).toHaveLength(1));
    expect(posted(fetchMock, '/stakeholders')[0]).toMatchObject({ user: U1, as: 3 });
    expect(await screen.findByText(/Sent plan for .* as #3/)).toBeInTheDocument();
  });

  it("row claims post the row's account index, not Act as", async () => {
    const fetchMock = mockBackend({ ...withRow, 'POST /claim': tx });
    render(<Page />);
    await ready();
    await userEvent.selectOptions(screen.getByLabelText('Act as'), '3');
    await userEvent.click(await screen.findByRole('button', { name: 'Claim all as 0x7099…79C8' }));
    await waitFor(() => expect(posted(fetchMock, '/claim')).toEqual([{ as: 1, all: true }]));
  });

  it('Jump posts the user, offset and pin', async () => {
    const fetchMock = mockBackend({ ...withRow, 'POST /time/jump': () => json({ chainTime: 1, target: 2, pinned: true }) });
    render(<Page />);
    await ready();
    await userEvent.selectOptions(await screen.findByLabelText('Jump offset 0x7099…79C8'), '1');
    await userEvent.click(screen.getByLabelText('Pin next tx 0x7099…79C8'));
    await userEvent.click(screen.getByRole('button', { name: 'Jump 0x7099…79C8' }));
    await waitFor(() => expect(posted(fetchMock, '/time/jump')).toEqual([{ user: U1, offset: 1, pin: true }]));
  });

  it('Edit plan prefills every step in Custom mode, exact to the second', async () => {
    mockBackend(withRow);
    render(<Page />);
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit plan 0x7099…79C8' }));
    expect(screen.getByRole('tab', { name: 'Custom' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('User')).toHaveValue(U1);
    schedule.forEach((st, i) => {
      expect(screen.getByLabelText(`Step ${i + 1} date`)).toHaveValue(new Date(st.unlockTime * 1000).toISOString().slice(0, 19));
      expect(screen.getByLabelText(`Step ${i + 1} amount`)).toHaveValue(st.amount);
    });
    expect(screen.queryByLabelText('Step 4 amount')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Custom total')).toHaveValue('300.500000000000000001');
  });

  it('Remove asks first, showing the forfeited amount; cancel sends nothing, OK removes as the Act-as account', async () => {
    const fetchMock = mockBackend({ ...withRow, 'DELETE /stakeholders/:addr': tx });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<Page />);
    await ready();
    await userEvent.selectOptions(screen.getByLabelText('Act as'), '2');
    const remove = await screen.findByRole('button', { name: 'Remove 0x7099…79C8' });
    const deletes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => url as string);

    await userEvent.click(remove);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('200.500000000000000001 unclaimed tokens'));
    expect(deletes()).toEqual([]);

    await userEvent.click(remove);
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(new URL(deletes()[0]).pathname + new URL(deletes()[0]).search).toBe(`/stakeholders/${U1}?as=2`);
  });

  it('an event-log failure stays in the log; the rest of the page still loads', async () => {
    mockBackend({ 'GET /events': () => json({ error: 'BadRequest', message: 'logs failed' }, 400) });
    render(<Page />);
    expect(await screen.findByText('Could not load events: BadRequest: logs failed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Add plan|Replace plan/ })).toBeEnabled());
  });
});
