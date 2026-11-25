import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanRequest, Preview } from '../lib/api';
import { ReplacePreview } from './ReplacePreview';

const U1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const req = (total: string): PlanRequest => ({ kind: 'schedule', body: { user: U1, totalAmount: total, schedule: [{ unlockTime: 1, amount: total }] } });
const base: Preview = {
  exists: true,
  old: { allocated: '1200.0', released: '0.0', lastClaimedStep: 0, totalSteps: 12 },
  forfeited: '1200.0',
  newTotal: '600.0',
  totalAllocatedAfter: '600.0',
  outstandingAfter: '600.0',
  vaultBalance: '1200.0',
  shortfall: '0.0',
  pastClaimsNotDeducted: false,
  wouldRevert: null,
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

afterEach(() => vi.unstubAllGlobals());

describe('ReplacePreview', () => {
  it('posts to the route of the request kind and shows the numbers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(base));
    vi.stubGlobal('fetch', fetchMock);
    const onExists = vi.fn();
    render(<ReplacePreview request={req('600')} refreshKey={0} onExists={onExists} />);
    expect(await screen.findByText('Replace an existing plan')).toBeInTheDocument();
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/stakeholders/schedule/preview');
    expect(screen.getByText('1200.0 / 0.0 (step 0 of 12 claimed)')).toBeInTheDocument();
    expect(onExists).toHaveBeenLastCalledWith(true);
  });

  it('the past-claims warning shows only when pastClaimsNotDeducted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(base)));
    const { unmount } = render(<ReplacePreview request={req('600')} refreshKey={0} onExists={() => {}} />);
    await screen.findByText('Replace an existing plan');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();

    vi.stubGlobal('fetch', vi.fn(async () => json({ ...base, pastClaimsNotDeducted: true, old: { ...base.old!, released: '100.0' } })));
    render(<ReplacePreview request={req('600')} refreshKey={0} onExists={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Already claimed 100.0; the new plan pays the full new total (600.0) on top.');
  });

  it('wouldRevert is shown with its hint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...base, shortfall: '100.0', wouldRevert: 'InsufficientVaultBalance' })));
    render(<ReplacePreview request={req('600')} refreshKey={0} onExists={() => {}} />);
    expect(await screen.findByText(/Would revert: InsufficientVaultBalance/)).toHaveTextContent('(the vault holds less than every plan needs; fund it first)');
  });

  it('a failed preview is shown inline, not thrown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'NotDeployed' }, 409)));
    const onExists = vi.fn();
    render(<ReplacePreview request={req('600')} refreshKey={0} onExists={onExists} />);
    expect(await screen.findByText('Preview failed: NotDeployed: click Setup first')).toBeInTheDocument();
    expect(onExists).toHaveBeenLastCalledWith(undefined);
  });

  it('a slow older response is dropped (latest request wins)', async () => {
    let releaseFirst!: () => void;
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => {
      const total = JSON.parse(init!.body as string).totalAmount;
      if (total === '1') await new Promise<void>((r) => (releaseFirst = r));
      return json({ ...base, newTotal: `${total}.0` });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<ReplacePreview request={req('1')} refreshKey={0} onExists={() => {}} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender(<ReplacePreview request={req('2')} refreshKey={0} onExists={() => {}} />);
    expect(await screen.findByText('2.0')).toBeInTheDocument();
    releaseFirst();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('2.0')).toBeInTheDocument();
    expect(screen.queryByText('1.0')).not.toBeInTheDocument();
  });

  it('re-reads when refreshKey changes, and clears when there is no request', async () => {
    const fetchMock = vi.fn(async () => json(base));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<ReplacePreview request={req('600')} refreshKey={0} onExists={() => {}} />);
    await screen.findByText('Replace an existing plan');
    rerender(<ReplacePreview request={req('600')} refreshKey={1} onExists={() => {}} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    rerender(<ReplacePreview request={null} refreshKey={1} onExists={() => {}} />);
    expect(screen.queryByText('Replace an existing plan')).not.toBeInTheDocument();
  });
});
