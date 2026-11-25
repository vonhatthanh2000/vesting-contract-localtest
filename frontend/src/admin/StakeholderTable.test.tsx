import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Account, StakeholderRow } from '../lib/api';
import { StakeholderTable } from './StakeholderTable';

// Shape of a real GET /stakeholders response after setup → fund 1200 → add (12×100, first in 30d) → skip 61d.
const row: StakeholderRow = {
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  exists: true,
  allocated: '1200.0',
  released: '0.0',
  lastClaimedStep: 0,
  totalSteps: 12,
  claimable: '200.0',
  claimableSteps: 2,
  nextReleaseTime: 1797751579,
  chainTime: 1800429980,
  tokenBalance: '0.0',
  schedule: [{ unlockTime: 1797751579, amount: '100.0' }],
};

describe('StakeholderTable', () => {
  it('renders a row per stakeholder from a /stakeholders response', () => {
    render(<StakeholderTable rows={[row]} />);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2); // header + 1
    const cells = within(rows[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(0, 6)).toEqual(['0x7099…79C8', '1200.0', '0.0', '200.0 (2 steps)', '0 / 12', '2026-12-20 07:26:19 UTC']);
    expect(cells).toHaveLength(7); // + Actions
    expect(within(rows[1]).getByTitle(row.address)).toBeInTheDocument();
  });

  it('shows "complete" when there is no next release', () => {
    render(<StakeholderTable rows={[{ ...row, lastClaimedStep: 12, claimable: '0.0', claimableSteps: 0, nextReleaseTime: 0 }]} />);
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(screen.getByText('12 / 12')).toBeInTheDocument();
  });

  it('shows an empty state with no stakeholders', () => {
    render(<StakeholderTable rows={[]} />);
    expect(screen.getByText('No stakeholders yet.')).toBeInTheDocument();
  });
});

const acc = (index: number, address: string): Account => ({ index, address, tokenBalance: '0.0', isOwner: index === 0, isPendingOwner: false, isStakeholder: false });
const accounts = [acc(0, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'), acc(1, row.address)];

describe('StakeholderTable row actions (PLAN 05)', () => {
  it("claims are signed by the row's own account index", async () => {
    const onAction = vi.fn();
    render(<StakeholderTable rows={[row]} accounts={accounts} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: `Claim as ${'0x7099…79C8'}` }));
    await userEvent.click(screen.getByRole('button', { name: `Claim all as ${'0x7099…79C8'}` }));
    expect(onAction.mock.calls.map(([a]) => [a.kind, a.as, a.all])).toEqual([['claim', 1, false], ['claim', 1, true]]);
    expect(screen.getByRole('button', { name: 'Claim as 0x7099…79C8' })).toHaveTextContent('Claim as #1');
  });

  it('an address that is not one of the 20 node accounts cannot be claimed for (disabled, with a tooltip)', () => {
    render(<StakeholderTable rows={[{ ...row, address: '0x000000000000000000000000000000000000bEEF' }]} accounts={accounts} />);
    for (const name of ['Claim as 0x0000…bEEF', 'Claim all as 0x0000…bEEF']) {
      const b = screen.getByRole('button', { name });
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', expect.stringMatching(/not one of the node’s 20 accounts/i));
    }
  });

  it('Jump sends the chosen offset and pin', async () => {
    const onAction = vi.fn();
    render(<StakeholderTable rows={[row]} accounts={accounts} onAction={onAction} />);
    await userEvent.selectOptions(screen.getByLabelText('Jump offset 0x7099…79C8'), '-1');
    await userEvent.click(screen.getByLabelText('Pin next tx 0x7099…79C8'));
    await userEvent.click(screen.getByRole('button', { name: 'Jump 0x7099…79C8' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'jump', row, offset: -1, pin: true });
  });

  it('Jump is disabled when there is no next unlock', () => {
    render(<StakeholderTable rows={[{ ...row, nextReleaseTime: 0 }]} accounts={accounts} />);
    const b = screen.getByRole('button', { name: 'Jump 0x7099…79C8' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', expect.stringMatching(/No locked step left/));
  });

  it('Edit plan and Remove hand the row to the page; everything is disabled while busy', async () => {
    const onAction = vi.fn();
    const { rerender } = render(<StakeholderTable rows={[row]} accounts={accounts} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit plan 0x7099…79C8' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove 0x7099…79C8' }));
    expect(onAction.mock.calls.map(([a]) => a.kind)).toEqual(['edit', 'remove']);
    rerender(<StakeholderTable rows={[row]} accounts={accounts} disabled onAction={onAction} />);
    for (const b of within(screen.getAllByRole('row')[1]).getAllByRole('button')) expect(b).toBeDisabled();
  });
});
