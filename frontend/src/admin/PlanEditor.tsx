import { useEffect, useState } from 'react';
import type { PlanRequest } from '../lib/api';
import { buildCustomRequest, moveRow, rowUnlockTime, sumAmounts, toUtcDateTimeInput, type CustomRow } from '../lib/schedule';

/** Load a plan into Custom mode ("Edit plan"); a new `key` re-applies it. */
export type PlanPrefill = { key: number; user: string; rows: CustomRow[] };
import { validateAddForm, type AddForm } from '../lib/validation';
import { ReplacePreview } from './ReplacePreview';
import { btn, input } from './ui';

const GEN_FIELDS: { key: Exclude<keyof AddForm, 'user'>; label: string; width: string }[] = [
  { key: 'totalAmount', label: 'Total', width: 'w-28' },
  { key: 'steps', label: 'Steps', width: 'w-16' },
  { key: 'intervalDays', label: 'Interval (days)', width: 'w-20' },
  { key: 'firstUnlockInDays', label: 'First unlock in (days)', width: 'w-20' },
];

const row = (days: string, amount: string): CustomRow => ({ unlock: 'days', days, date: '', amount });

/**
 * Builds a replaceStakeholder request, either as even steps (Generator) or step by step (Custom: each unlock as
 * "+N days from chain now" or a UTC date-time), previews it, and sends it. "Send as is" skips the frontend checks
 * so the contract's own errors (InvalidSchedule, AllocationMismatch, ZeroAddress) can be triggered.
 */
export function PlanEditor({
  disabled,
  chainTime,
  refreshKey,
  actAs,
  prefill,
  onSend,
}: {
  disabled: boolean;
  chainTime?: number;
  refreshKey: number;
  actAs?: number;
  prefill?: PlanPrefill;
  onSend: (r: PlanRequest) => void;
}) {
  const [mode, setMode] = useState<'generator' | 'custom'>('generator');
  const [user, setUser] = useState('0x70997970C51812dc3A010C7d01b50e0d17dc79C8'); // Hardhat account #1
  const [gen, setGen] = useState<Omit<AddForm, 'user'>>({ totalAmount: '1200', steps: '12', intervalDays: '30', firstUnlockInDays: '30' });
  const [rows, setRows] = useState<CustomRow[]>([row('30', '600'), row('60', '600')]);
  const [totalOverride, setTotalOverride] = useState<string | null>(null);
  const [asIs, setAsIs] = useState(false);
  const [exists, setExists] = useState<boolean>();

  useEffect(() => {
    if (!prefill) return;
    setMode('custom');
    setUser(prefill.user);
    setRows(prefill.rows);
    setTotalOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.key]);

  const sum = sumAmounts(rows);
  const total = totalOverride ?? sum;

  let request: PlanRequest | undefined;
  let error: string | undefined;
  if (mode === 'generator') {
    const v = validateAddForm({ user, ...gen });
    if (v.input) request = { kind: 'generator', body: v.input };
    else error = Object.values(v.errors)[0];
  } else {
    ({ request, error } = buildCustomRequest({ user, rows, total, asIs, chainTime }));
  }

  const setRow = (i: number, patch: Partial<CustomRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  /** Switch a row between "+days" and a date-time, carrying its current unlock time over. */
  const toggleUnlock = (i: number) => {
    const r = rows[i];
    const t = chainTime === undefined ? NaN : rowUnlockTime(r, chainTime);
    if (r.unlock === 'days') setRow(i, { unlock: 'date', date: Number.isNaN(t) ? '' : toUtcDateTimeInput(t) });
    else setRow(i, { unlock: 'days', days: Number.isNaN(t) || chainTime === undefined ? r.days : String(Math.max(0, Math.round((t - chainTime) / 86400))) });
  };

  return (
    <form
      aria-label="Plan editor"
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (request) onSend(request);
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex text-sm" role="tablist">
          {(['generator', 'custom'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`border px-2 py-1 ${mode === m ? 'bg-slate-800 text-white' : 'bg-white'}`}
              onClick={() => setMode(m)}
            >
              {m === 'generator' ? 'Generator' : 'Custom'}
            </button>
          ))}
        </div>
        <label className="flex flex-col text-xs">
          User
          <input aria-label="User" className={`${input} w-96 font-mono`} disabled={disabled} value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
      </div>

      {mode === 'generator' ? (
        <div className="flex flex-wrap items-end gap-2">
          {GEN_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col text-xs">
              {f.label}
              <input
                aria-label={f.label}
                className={`${input} ${f.width} font-mono`}
                disabled={disabled}
                value={gen[f.key]}
                onChange={(e) => setGen({ ...gen, [f.key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      ) : (
        <div className="space-y-1 text-xs">
          <table>
            <thead>
              <tr className="text-left">
                <th className="pr-2">#</th>
                <th className="pr-2">Unlock (+days from chain now, or UTC date-time)</th>
                <th className="pr-2">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="pr-2">{i + 1}</td>
                  <td className="flex items-center gap-1 pr-2">
                    {r.unlock === 'days' ? (
                      <input aria-label={`Step ${i + 1} days`} className={`${input} w-24 font-mono`} disabled={disabled} value={r.days} onChange={(e) => setRow(i, { days: e.target.value })} />
                    ) : (
                      <input
                        type="datetime-local"
                        step={1}
                        aria-label={`Step ${i + 1} date`}
                        className={`${input} font-mono`}
                        disabled={disabled}
                        value={r.date}
                        onChange={(e) => setRow(i, { date: e.target.value })}
                      />
                    )}
                    <button type="button" className="underline" disabled={disabled} aria-label={`Step ${i + 1} switch unlock input`} onClick={() => toggleUnlock(i)}>
                      {r.unlock === 'days' ? 'use date' : 'use days'}
                    </button>
                  </td>
                  <td className="pr-2">
                    <input aria-label={`Step ${i + 1} amount`} className={`${input} w-28 font-mono`} disabled={disabled} value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
                  </td>
                  <td className="space-x-1 whitespace-nowrap">
                    <button type="button" aria-label={`Move step ${i + 1} up`} disabled={disabled || i === 0} onClick={() => setRows(moveRow(rows, i, -1))}>↑</button>
                    <button type="button" aria-label={`Move step ${i + 1} down`} disabled={disabled || i === rows.length - 1} onClick={() => setRows(moveRow(rows, i, 1))}>↓</button>
                    <button type="button" className="text-red-600" aria-label={`Remove step ${i + 1}`} disabled={disabled} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              className="underline"
              disabled={disabled}
              onClick={() => setRows([...rows, row(String((Number(rows.at(-1)?.days) || 0) + 30), rows.at(-1)?.amount ?? '100')])}
            >
              + Add step
            </button>
            <label className="flex flex-col">
              <span>Total {totalOverride === null && <span className="text-slate-500">(sum of steps)</span>}</span>
              <input aria-label="Custom total" className={`${input} w-28 font-mono`} disabled={disabled} value={total} onChange={(e) => setTotalOverride(e.target.value)} />
            </label>
            {totalOverride !== null && (
              <button type="button" className="underline" onClick={() => setTotalOverride(null)}>
                Use sum
              </button>
            )}
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={asIs} disabled={disabled} onChange={(e) => setAsIs(e.target.checked)} />
              Send as is (skip checks, let the contract reject it)
            </label>
          </div>
        </div>
      )}

      <ReplacePreview request={request ?? null} refreshKey={refreshKey} as={actAs} onExists={setExists} />
      <div className="flex items-center gap-2">
        <button type="submit" className={btn} disabled={disabled || !request}>
          {exists ? 'Replace plan' : 'Add plan'}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  );
}
