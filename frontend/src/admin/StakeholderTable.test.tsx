import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StakeholderRow } from '../lib/api';
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
    expect(cells).toEqual(['0x7099…79C8', '1200.0', '0.0', '200.0 (2 steps)', '0 / 12', '2026-12-20 07:26:19 UTC']);
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
