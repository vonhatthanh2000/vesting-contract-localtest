import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deployment, VaultBalance } from '../lib/api';
import { VaultCard } from './VaultCard';

const T1 = '0x' + '1'.repeat(40);
const T2 = '0x' + '2'.repeat(40);
const dep = (paused = false): Deployment => ({ vault: '0x' + '9'.repeat(40), deployBlock: 1, mockTokens: [T1, T2], token: T2, owner: '0x' + '3'.repeat(40), pendingOwner: '0x' + '0'.repeat(40), paused });
const bal = (b1: string, b2 = '5.0'): VaultBalance[] => [
  { token: T1, vaultBalance: b1, current: false },
  { token: T2, vaultBalance: b2, current: true },
];

afterEach(() => vi.unstubAllGlobals());

const rows = () => within(screen.getByRole('rowgroup', { name: 'Vault balances' })).getAllByRole('row');

describe('VaultCard', () => {
  it('flags a non-current token with a balance as stranded, and marks the current one', () => {
    render(<VaultCard deployment={dep()} balances={bal('50.0')} actAs={0} disabled={false} onAct={() => {}} />);
    expect(rows()[0]).toHaveTextContent('50.0stranded');
    expect(rows()[1]).toHaveTextContent('5.0current');
  });

  it('a non-current token with 0 balance is not stranded', () => {
    render(<VaultCard deployment={dep()} balances={bal('0.0')} actAs={0} disabled={false} onAct={() => {}} />);
    expect(rows()[0]).not.toHaveTextContent('stranded');
  });

  it('shows the live paused state and offers the opposite action', async () => {
    const onAct = vi.fn();
    const { rerender } = render(<VaultCard deployment={dep(false)} balances={[]} actAs={2} disabled={false} onAct={onAct} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onAct).toHaveBeenLastCalledWith('Paused as #2', expect.any(Function));
    rerender(<VaultCard deployment={dep(true)} balances={[]} actAs={2} disabled={false} onAct={onAct} />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unpause' }));
    expect(onAct).toHaveBeenLastCalledWith('Unpaused as #2', expect.any(Function));
  });

  it('sends pause, withdraw, fund-with-token and set-token with the right bodies', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ txHash: '0x' })));
    vi.stubGlobal('fetch', fetchMock);
    const onAct = (_l: string, fn: () => Promise<unknown>) => void fn();
    render(<VaultCard deployment={dep()} balances={[]} actAs={2} disabled={false} onAct={onAct} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await userEvent.clear(screen.getByLabelText('Withdraw amount'));
    await userEvent.type(screen.getByLabelText('Withdraw amount'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await userEvent.selectOptions(screen.getByLabelText('Fund token'), T1);
    await userEvent.click(screen.getByRole('button', { name: 'Fund' }));
    await userEvent.type(screen.getByLabelText('New token'), T1);
    await userEvent.click(screen.getByRole('button', { name: 'Set token' }));
    const calls = fetchMock.mock.calls.map(([url, init]) => [new URL(url).pathname, JSON.parse(init!.body as string)]);
    expect(calls).toEqual([
      ['/pause', { as: 2 }],
      ['/emergency-withdraw', { to: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', amount: '0', as: 2 }],
      ['/fund', { amount: '1200', token: T1 }],
      ['/token', { token: T1, as: 2 }],
    ]);
  });
});
