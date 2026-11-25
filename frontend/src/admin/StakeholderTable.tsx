import { useState } from 'react';
import type { Account, StakeholderRow } from '../lib/api';
import { fmtChainTime, shortAddr } from '../lib/format';
import { card } from './ui';

export type RowAction =
  | { kind: 'edit'; row: StakeholderRow }
  | { kind: 'remove'; row: StakeholderRow }
  | { kind: 'claim'; row: StakeholderRow; as: number; all: boolean }
  | { kind: 'jump'; row: StakeholderRow; offset: -1 | 0 | 1; pin: boolean };

const small = 'rounded border px-1.5 py-0.5 text-xs hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400';

/** Per-row jump controls: offset around the next unlock and whether to only pin the next block's time. */
function JumpControls({
  row,
  disabled,
  noUnlock,
  onJump,
}: {
  row: StakeholderRow;
  disabled: boolean;
  noUnlock: boolean;
  onJump: (offset: -1 | 0 | 1, pin: boolean) => void;
}) {
  const [offset, setOffset] = useState<-1 | 0 | 1>(0);
  const [pin, setPin] = useState(false);
  const a = shortAddr(row.address);
  return (
    <span className="inline-flex items-center gap-1">
      <select aria-label={`Jump offset ${a}`} className="rounded border text-xs" disabled={disabled} value={offset} onChange={(e) => setOffset(Number(e.target.value) as -1 | 0 | 1)}>
        <option value={-1}>−1 s</option>
        <option value={0}>0</option>
        <option value={1}>+1 s</option>
      </select>
      <label className="inline-flex items-center gap-0.5 text-xs">
        <input type="checkbox" aria-label={`Pin next tx ${a}`} checked={pin} disabled={disabled} onChange={(e) => setPin(e.target.checked)} />
        pin
      </label>
      <button
        type="button"
        className={small}
        aria-label={`Jump ${a}`}
        disabled={disabled || noUnlock}
        title={noUnlock ? 'No locked step left: every step is claimed' : undefined}
        onClick={() => onJump(offset, pin)}
      >
        Jump
      </button>
    </span>
  );
}

/**
 * Stakeholders with per-row actions. Claims are signed by the row's own account; rows whose address isn't one
 * of the node's 20 accounts can't be claimed for (the backend has no key for them).
 */
export function StakeholderTable({
  rows,
  accounts = [],
  disabled = false,
  onAction = () => {},
}: {
  rows: StakeholderRow[];
  accounts?: Account[];
  disabled?: boolean;
  onAction?: (a: RowAction) => void;
}) {
  const indexOf = (addr: string) => accounts.find((x) => x.address.toLowerCase() === addr.toLowerCase())?.index;
  return (
    <section className={card}>
      <h2 className="mb-2 font-semibold">Stakeholders</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-1">Address</th>
            <th>Allocated</th>
            <th>Released</th>
            <th>Claimable</th>
            <th>Steps claimed</th>
            <th>Next release</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const a = shortAddr(s.address);
            const claimAs = indexOf(s.address); // only the node's 20 accounts can be signed for
            const noSigner = claimAs === undefined ? 'Not one of the node’s 20 accounts, so the backend cannot sign its claims' : undefined;
            return (
              <tr key={s.address} className="border-b align-top font-mono">
                <td className="py-1" title={s.address}>{a}</td>
                <td>{s.allocated}</td>
                <td>{s.released}</td>
                <td>{s.claimable} ({s.claimableSteps} steps)</td>
                <td>{s.lastClaimedStep} / {s.totalSteps}</td>
                <td>{s.nextReleaseTime ? fmtChainTime(s.nextReleaseTime) : 'complete'}</td>
                <td className="space-y-1 py-1 font-sans">
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className={small} disabled={disabled} aria-label={`Edit plan ${a}`} onClick={() => onAction({ kind: 'edit', row: s })}>Edit plan</button>
                    <button type="button" className={small} disabled={disabled} aria-label={`Remove ${a}`} onClick={() => onAction({ kind: 'remove', row: s })}>Remove</button>
                    <button type="button" className={small} disabled={disabled || claimAs === undefined} title={noSigner} aria-label={`Claim as ${a}`} onClick={() => onAction({ kind: 'claim', row: s, as: claimAs!, all: false })}>
                      Claim{claimAs === undefined ? '' : ` as #${claimAs}`}
                    </button>
                    <button type="button" className={small} disabled={disabled || claimAs === undefined} title={noSigner} aria-label={`Claim all as ${a}`} onClick={() => onAction({ kind: 'claim', row: s, as: claimAs!, all: true })}>
                      Claim all{claimAs === undefined ? '' : ` as #${claimAs}`}
                    </button>
                  </div>
                  <JumpControls row={s} disabled={disabled} noUnlock={!s.nextReleaseTime} onJump={(offset, pin) => onAction({ kind: 'jump', row: s, offset, pin })} />
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-2 text-slate-500">No stakeholders yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
