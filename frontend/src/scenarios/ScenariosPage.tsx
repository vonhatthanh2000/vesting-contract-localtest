import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Toasts, type ToastMsg } from '../admin/Toast';
import { api, ApiError, type ScenarioInfo, type ScenarioRun } from '../lib/api';
import { describeError } from '../lib/errors';
import { fmtChainTime } from '../lib/format';

let toastId = 0;

const btn = 'rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300';
const card = 'rounded border p-4';

type RunState = { kind: 'running' } | { kind: 'done'; run: ScenarioRun } | { kind: 'error'; message: string };

/** The replaceStakeholder scenario catalog: run one or all (one after another) and see each step's result. */
export default function ScenariosPage() {
  const [list, setList] = useState<ScenarioInfo[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useEffect(() => {
    api.scenarios().then(setList, (e) => setLoadError(describeError(e)));
  }, []);

  const runOne = async (id: string) => {
    setRuns((r) => ({ ...r, [id]: { kind: 'running' } }));
    try {
      const run = await api.runScenario(id);
      setRuns((r) => ({ ...r, [id]: { kind: 'done', run } }));
    } catch (e) {
      const message = describeError(e);
      setRuns((r) => ({ ...r, [id]: { kind: 'error', message } }));
      // ScenarioBusy: another tab (or a manual action elsewhere) is running one; say so loudly.
      if (e instanceof ApiError) setToasts((t) => [...t, { id: ++toastId, kind: 'error', text: `${id}: ${message}` }]);
    }
  };

  const run = async (ids: string[]) => {
    if (busy) return;
    setBusy(true);
    try {
      for (const id of ids) await runOne(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 text-slate-800">
      <Toasts items={toasts} onDismiss={dismiss} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Replace scenarios</h1>
        <Link className="text-sm text-blue-600 underline" to="/admin">admin</Link>
      </div>
      <div className="flex items-center gap-3">
        <button className={btn} disabled={busy || list.length === 0} onClick={() => run(list.map((s) => s.id))}>
          Run all
        </button>
        {busy && <span className="text-sm text-slate-500">Running…</span>}
      </div>
      <p role="note" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Each run deploys its own vault, so your admin vault is untouched, but runs share the chain clock: their time jumps move
        the chain forward for everything, including your manual plans. While a run is going, admin writes and time moves are
        refused (ScenarioBusy).
      </p>
      {loadError && <p className="text-red-600">{loadError}</p>}

      <ul className="space-y-2">
        {list.map((s) => {
          const r = runs[s.id];
          const status = !r ? '' : r.kind === 'running' ? 'running…' : r.kind === 'error' ? '✗ error' : r.run.pass ? '✓ pass' : '✗ fail';
          return (
            <li key={s.id} aria-label={s.id} className={card}>
              <div className="flex flex-wrap items-center gap-2">
                <button className={btn} disabled={busy} onClick={() => run([s.id])}>Run</button>
                <button className="font-mono text-sm underline" onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
                  {s.id}
                </button>
                <span className="text-sm">{s.title}</span>
                <span className={`ml-auto text-sm font-semibold ${status.startsWith('✓') ? 'text-emerald-700' : status.startsWith('✗') ? 'text-red-700' : 'text-slate-500'}`}>
                  {status}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{s.description}</p>
              {r?.kind === 'error' && <p className="mt-1 text-sm text-red-600">{r.message}</p>}
              {r?.kind === 'done' && open[s.id] && (
                <div className="mt-2 space-y-1 text-sm">
                  <p className="text-xs text-slate-500">Vault: <span className="font-mono">{r.run.vault}</span></p>
                  <ol className="space-y-1">
                    {r.run.steps.map((st, i) => (
                      <li key={i}>
                        <span className={st.pass ? 'text-emerald-700' : 'text-red-700'}>{st.pass ? '✓' : '✗'}</span> {st.label}
                        {st.error && <span className="text-red-600"> — {st.error}</span>}
                        <span className="ml-2 font-mono text-xs text-slate-500">{fmtChainTime(st.time)}</span>
                        {st.events.length > 0 && (
                          <ul className="ml-5 font-mono text-xs text-slate-600">
                            {st.events.map((ev, j) => (
                              <li key={j}>
                                {ev.name}{' '}
                                {Object.entries(ev.args)
                                  .map(([k, v]) => `${k}=${v}`)
                                  .join(' ')}
                              </li>
                            ))}
                          </ul>
                        )}
                        {!st.pass && (
                          <div className="grid gap-2 md:grid-cols-2">
                            <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">expected {JSON.stringify(st.expected, null, 2)}</pre>
                            <pre className="overflow-x-auto rounded bg-red-50 p-2 text-xs">actual {JSON.stringify(st.actual, null, 2)}</pre>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
