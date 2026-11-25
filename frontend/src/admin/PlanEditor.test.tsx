import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PlanEditor } from './PlanEditor';

const T = 1_800_000_000;
const DAY = 86400;
const U1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const U2 = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const preview = { exists: false, old: null, forfeited: '0.0', newTotal: '0.0', totalAllocatedAfter: '0.0', outstandingAfter: '0.0', vaultBalance: '0.0', shortfall: '0.0', pastClaimsNotDeducted: false, wouldRevert: null };

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(preview)))));
afterEach(() => vi.unstubAllGlobals());

const setup = () => {
  const onSend = vi.fn();
  render(<PlanEditor disabled={false} chainTime={T} refreshKey={0} onSend={onSend} />);
  return { onSend, user: userEvent.setup() };
};
const send = () => screen.getByRole('button', { name: /Add plan|Replace plan/ });

describe('PlanEditor', () => {
  it('generator: sends the even-steps body', async () => {
    const { onSend, user } = setup();
    await user.click(send());
    expect(onSend).toHaveBeenCalledWith({ kind: 'generator', body: { user: U1, totalAmount: '1200', steps: 12, intervalDays: 30, firstUnlockInDays: 30 } });
  });

  it('switching modes keeps the user', async () => {
    const { user } = setup();
    await user.clear(screen.getByLabelText('User'));
    await user.type(screen.getByLabelText('User'), U2);
    await user.click(screen.getByRole('tab', { name: 'Custom' }));
    expect(screen.getByLabelText('User')).toHaveValue(U2);
    await user.click(screen.getByRole('tab', { name: 'Generator' }));
    expect(screen.getByLabelText('User')).toHaveValue(U2);
  });

  it('custom: the total defaults to the sum, can be overridden, and "Use sum" resets it', async () => {
    const { onSend, user } = setup();
    await user.click(screen.getByRole('tab', { name: 'Custom' }));
    expect(screen.getByLabelText('Custom total')).toHaveValue('1200.0');
    await user.clear(screen.getByLabelText('Step 1 amount'));
    await user.type(screen.getByLabelText('Step 1 amount'), '100');
    expect(screen.getByLabelText('Custom total')).toHaveValue('700.0');

    await user.clear(screen.getByLabelText('Custom total'));
    await user.type(screen.getByLabelText('Custom total'), '5');
    expect(screen.getByText('Total 5 ≠ sum of steps 700.0')).toBeInTheDocument();
    expect(send()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Use sum' }));
    expect(screen.getByLabelText('Custom total')).toHaveValue('700.0');
    await user.click(send());
    expect(onSend).toHaveBeenCalledWith({
      kind: 'schedule',
      body: { user: U1, totalAmount: '700.0', schedule: [{ unlockTime: T + 30 * DAY, amount: '100' }, { unlockTime: T + 60 * DAY, amount: '600' }] },
    });
  });

  it('"Send as is" lets 0 rows, a zero amount and a mismatch through', async () => {
    const { onSend, user } = setup();
    await user.click(screen.getByRole('tab', { name: 'Custom' }));

    await user.clear(screen.getByLabelText('Step 2 amount'));
    await user.type(screen.getByLabelText('Step 2 amount'), '0');
    expect(screen.getByText('Amounts must be above 0')).toBeInTheDocument();
    expect(send()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Send as is/ }));
    await user.click(send());
    expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ totalAmount: '600.0', schedule: [expect.anything(), { unlockTime: T + 60 * DAY, amount: '0' }] }) }));

    await user.clear(screen.getByLabelText('Custom total'));
    await user.type(screen.getByLabelText('Custom total'), '1');
    await user.click(send());
    expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ totalAmount: '1' }) }));

    await user.click(screen.getByRole('button', { name: 'Remove step 2' }));
    await user.click(screen.getByRole('button', { name: 'Remove step 1' }));
    await user.click(send());
    expect(onSend).toHaveBeenLastCalledWith({ kind: 'schedule', body: { user: U1, totalAmount: '1', schedule: [] } });
  });

  it('rows can be reordered; moving a later unlock first fails the order check', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: 'Custom' }));
    expect(screen.getByRole('button', { name: 'Move step 1 up' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }));
    expect(screen.getByLabelText('Step 1 days')).toHaveValue('60');
    expect(screen.getByText('Unlock times must increase')).toBeInTheDocument();
  });

  it('a row switches to a UTC date-time and keeps its unlock time', async () => {
    const { onSend, user } = setup();
    await user.click(screen.getByRole('tab', { name: 'Custom' }));
    await user.click(screen.getByRole('button', { name: 'Step 2 switch unlock input' }));
    expect(screen.getByLabelText('Step 2 date')).toHaveValue(new Date((T + 60 * DAY) * 1000).toISOString().slice(0, 16));
    await user.click(send());
    const sent = onSend.mock.calls[0][0].body.schedule[1].unlockTime;
    expect(sent).toBe(T + 60 * DAY - ((T + 60 * DAY) % 60)); // minute precision
  });

  it('the button says Replace plan once the preview reports an existing plan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...preview, exists: true, old: { allocated: '1.0', released: '0.0', lastClaimedStep: 0, totalSteps: 1 } }))));
    setup();
    await waitFor(() => expect(send()).toHaveTextContent('Replace plan'));
  });
});
