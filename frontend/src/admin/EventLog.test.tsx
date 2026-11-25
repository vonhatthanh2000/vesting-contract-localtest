import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { VaultEvent } from '../lib/api';
import { EventLog } from './EventLog';

const U = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const O = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const T = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ev = (block: number, name: string, args: VaultEvent['args']): VaultEvent => ({ block, time: 1_800_000_000 + block, txHash: `0x${block}`, name, args });

// One of each event the vault emits, shaped as GET /events returns them (newest first).
const all: VaultEvent[] = [
  ev(10, 'OwnershipTransferred', { previousOwner: O, newOwner: U }),
  ev(9, 'OwnershipTransferStarted', { previousOwner: O, newOwner: U }),
  ev(8, 'TokenUpdated', { oldToken: T, newToken: O }),
  ev(7, 'EmergencyWithdrawn', { to: O, amount: '1200.0' }),
  ev(6, 'Unpaused', { account: O }),
  ev(5, 'Paused', { account: O }),
  ev(4, 'StakeholderRemoved', { user: U, forfeited: '1100.0' }),
  ev(3, 'StakeholderReplaced', { user: U, oldAllocated: '1200.0', newAllocated: '600.0', totalSteps: 6 }),
  ev(2, 'Claimed', { user: U, amount: '200.0', fromStep: 1, toStep: 2 }),
  ev(1, 'StakeholderAdded', { user: U, totalAllocated: '1200.0', totalSteps: 12 }),
];

describe('EventLog', () => {
  it('renders every event type with its args, in the order given (newest first)', () => {
    render(<EventLog events={all} />);
    const items = within(screen.getByRole('list', { name: 'Event log' })).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('.font-semibold')!.textContent)).toEqual(all.map((e) => e.name));
    expect(items[8]).toHaveTextContent(`Claimed user=${U} amount=200.0 fromStep=1 toStep=2`);
    expect(items[7]).toHaveTextContent('oldAllocated=1200.0 newAllocated=600.0 totalSteps=6');
    expect(items[3]).toHaveTextContent(`EmergencyWithdrawn to=${O} amount=1200.0`);
    expect(items[0]).toHaveTextContent('#10 2027-01-15 08:00:10 UTC');
  });

  it('shows at most the latest 50', () => {
    const many = Array.from({ length: 60 }, (_, i) => ev(60 - i, 'Paused', { account: O }));
    render(<EventLog events={many} />);
    expect(within(screen.getByRole('list', { name: 'Event log' })).getAllByRole('listitem')).toHaveLength(50);
  });

  it('empty and error states', () => {
    const { rerender } = render(<EventLog events={[]} />);
    expect(screen.getByText('No events yet.')).toBeInTheDocument();
    rerender(<EventLog events={[]} error="BackendUnreachable: start the backend" />);
    expect(screen.getByRole('status')).toHaveTextContent('Could not load events: BackendUnreachable: start the backend');
    expect(screen.queryByText('No events yet.')).not.toBeInTheDocument();
  });
});
