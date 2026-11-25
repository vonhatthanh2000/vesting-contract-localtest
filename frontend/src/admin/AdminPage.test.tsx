import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminPage from './AdminPage';

// PLAN 02 acceptance: "A backend error appears as a toast with the error name."
const deployment = { token: '0x' + '1'.repeat(40), vault: '0x' + '2'.repeat(40), owner: '0x' + '3'.repeat(40) };
const dashboard = { allocated: '1200.0', claimed: '0.0', remaining: '1200.0', count: 1, vaultBalance: '1200.0' };

function mockBackend(overrides: Record<string, () => Response> = {}) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const routes: Record<string, () => Response> = {
    'GET /time': () => json({ chainTime: 1_800_000_000 }),
    'GET /deployment': () => json(deployment),
    'GET /dashboard': () => json(dashboard),
    'GET /stakeholders': () => json([]),
    ...overrides,
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unmocked ${key}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('AdminPage', () => {
  it('shows a backend error as a toast with the error name', async () => {
    const fetchMock = mockBackend({
      'POST /stakeholders': () => new Response(JSON.stringify({ error: 'AllocationMismatch' }), { status: 400 }),
    });
    render(<AdminPage />);
    const add = await screen.findByRole('button', { name: 'Add stakeholder' });
    await waitFor(() => expect(add).toBeEnabled());
    await userEvent.click(add);
    expect(await screen.findByRole('alert')).toHaveTextContent('AllocationMismatch: step amounts do not add up to the total');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(post![1]!.body as string)).toEqual({
      user: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      totalAmount: '1200',
      steps: 12,
      intervalDays: 30,
      firstUnlockInDays: 30,
    });
  });

  it('locks everything except Setup when not deployed', async () => {
    mockBackend({ 'GET /deployment': () => new Response(JSON.stringify({ error: 'NotDeployed' }), { status: 404 }) });
    render(<AdminPage />);
    await screen.findByText(/Not deployed\. Click Setup/);
    expect(screen.getByRole('button', { name: 'Setup' })).toBeEnabled();
    for (const name of ['Fund', 'Add stakeholder', '+30 days', '+1 day', '+N days']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
});
