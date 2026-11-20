import type { StakeholderRow } from '../lib/api';
import { fmtChainTime, shortAddr } from '../lib/format';
import { card } from './ui';

export function StakeholderTable({ rows }: { rows: StakeholderRow[] }) {
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
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.address} className="border-b font-mono">
              <td className="py-1" title={s.address}>{shortAddr(s.address)}</td>
              <td>{s.allocated}</td>
              <td>{s.released}</td>
              <td>{s.claimable} ({s.claimableSteps} steps)</td>
              <td>{s.lastClaimedStep} / {s.totalSteps}</td>
              <td>{s.nextReleaseTime ? fmtChainTime(s.nextReleaseTime) : 'complete'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-2 text-slate-500">No stakeholders yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
