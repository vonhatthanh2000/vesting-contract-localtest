import { formatToken } from '../lib/format';
import { fmtChainTime } from '../lib/format';
import { stepStatus } from '../lib/schedule';

const COLORS = { claimed: 'text-slate-400', unlocked: 'text-emerald-700', locked: 'text-slate-600' } as const;

export function ScheduleTable(p: { schedule: { unlockTime: number; amount: bigint }[]; lastClaimedStep: number; chainTime: number }) {
  return (
    <section className="rounded border p-4 text-sm">
      <h2 className="mb-2 font-semibold">Schedule</h2>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b"><th className="py-1">#</th><th>Unlocks</th><th>Amount</th><th>Status</th></tr>
        </thead>
        <tbody>
          {p.schedule.map((s, i) => {
            const st = stepStatus(i, s.unlockTime, p.lastClaimedStep, p.chainTime);
            return (
              <tr key={i} className="border-b font-mono">
                <td className="py-1">{i + 1}</td>
                <td>{fmtChainTime(s.unlockTime)}</td>
                <td>{formatToken(s.amount)}</td>
                <td className={COLORS[st]}>{st}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
