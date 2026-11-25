import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Account, Deployment } from '../lib/api';
import { OwnershipCard } from './OwnershipCard';

const ZERO = '0x' + '0'.repeat(40);
const A = ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'];
const accounts: Account[] = A.map((address, index) => ({ index, address, tokenBalance: '0.0', isOwner: index === 0, isPendingOwner: index === 2, isStakeholder: false }));
const dep = (pendingOwner: string): Deployment => ({ vault: '0x' + '9'.repeat(40), deployBlock: 1, mockTokens: [], token: '0x' + '1'.repeat(40), owner: A[0], pendingOwner, paused: false });

describe('OwnershipCard', () => {
  it('shows owner and pending owner as #index address, or none', () => {
    render(<OwnershipCard deployment={dep(ZERO)} accounts={accounts} actAs={0} disabled={false} onAct={() => {}} />);
    expect(screen.getByText(`#0 ${A[0]}`)).toBeInTheDocument();
    expect(screen.getByText('none')).toBeInTheDocument();
  });

  it('Accept shows only when Act as is the pending owner', () => {
    const { rerender } = render(<OwnershipCard deployment={dep(ZERO)} accounts={accounts} actAs={2} disabled={false} onAct={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument(); // nothing pending

    rerender(<OwnershipCard deployment={dep(A[2])} accounts={accounts} actAs={0} disabled={false} onAct={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(screen.getByText('To accept, switch Act as to the pending owner.')).toBeInTheDocument();

    rerender(<OwnershipCard deployment={dep(A[2])} accounts={accounts} actAs={2} disabled={false} onAct={() => {}} />);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(screen.queryByText(/switch Act as/)).not.toBeInTheDocument();
  });

  it('Transfer and Renounce are always offered (the contract decides)', () => {
    render(<OwnershipCard deployment={dep(ZERO)} accounts={accounts} actAs={1} disabled={false} onAct={() => {}} />);
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Renounce' })).toBeEnabled();
  });
});
