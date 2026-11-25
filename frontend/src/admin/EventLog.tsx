import type { VaultEvent } from '../lib/api';
import { fmtChainTime } from '../lib/format';
import { card } from './ui';

/** The latest 50 vault events, newest first (as GET /events returns them). */
export function EventLog({ events, error }: { events: VaultEvent[]; error?: string }) {
  return (
    <section className={card}>
      <h2 className="mb-2 font-semibold">Event log</h2>
      {error && <p role="status" className="text-xs text-red-600">Could not load events: {error}</p>}
      {!error && events.length === 0 && <p className="text-xs text-slate-500">No events yet.</p>}
      <ol aria-label="Event log" className="space-y-1 text-xs">
        {events.slice(0, 50).map((e) => (
          <li key={`${e.txHash}-${e.name}-${JSON.stringify(e.args)}`} className="font-mono">
            <span className="text-slate-500">#{e.block} {fmtChainTime(e.time)}</span> <span className="font-semibold">{e.name}</span>{' '}
            {Object.entries(e.args)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ')}
          </li>
        ))}
      </ol>
    </section>
  );
}
