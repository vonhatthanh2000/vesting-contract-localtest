import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type AddStakeholderInput, type Dashboard, type Deployment, type StakeholderRow } from '../lib/api';
import { describeError } from '../lib/errors';
import { fmtChainTime } from '../lib/format';
import { validateAmount } from '../lib/validation';
import { AddStakeholderForm } from './AddStakeholderForm';
import { StakeholderTable } from './StakeholderTable';
import { StatsCard } from './StatsCard';
import { TimeControls } from './TimeControls';
import { Toasts, type ToastMsg } from './Toast';
import { btn, card, input } from './ui';

let toastId = 0;

export default function AdminPage() {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [rows, setRows] = useState<StakeholderRow[]>([]);
  const [chainTime, setChainTime] = useState<number>();
  const [fundAmount, setFundAmount] = useState('1200');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const toast = useCallback((kind: ToastMsg['kind'], text: string) => setToasts((t) => [...t, { id: ++toastId, kind, text }]), []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    try {
      setChainTime((await api.time()).chainTime);
      let d: Deployment;
      try {
        d = await api.deployment();
      } catch (e) {
        if (e instanceof ApiError && e.name === 'NotDeployed') {
          setDeployment(null);
          setDashboard(null);
          setRows([]);
          return;
        }
        throw e;
      }
      const [dash, list] = await Promise.all([api.dashboard(), api.stakeholders()]);
      setDeployment(d);
      setDashboard(dash);
      setRows(list);
    } catch (e) {
      toast('error', describeError(e));
    } finally {
      setLoaded(true);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Run one admin action: disable every control while it runs, toast the result, then refresh. */
  const act = async (label: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast('success', label);
    } catch (e) {
      toast('error', describeError(e));
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const notDeployed = loaded && !deployment;
  const locked = busy || !deployment; // everything except Setup
  const fundErr = validateAmount(fundAmount);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 text-slate-800">
      <Toasts items={toasts} onDismiss={dismiss} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vesting admin</h1>
        {busy && <span className="text-sm text-slate-500">Working…</span>}
      </div>

      <section className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} disabled={busy} onClick={() => act('Deployed token and vault', api.setup)}>
            {deployment ? 'Setup (redeploy)' : 'Setup'}
          </button>
          <input aria-label="Fund amount" className={`${input} w-28`} disabled={locked} value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
          <button className={btn} disabled={locked || !!fundErr} onClick={() => act(`Funded ${fundAmount}`, () => api.fund(fundAmount))}>
            Fund
          </button>
          {fundErr && fundAmount !== '' && <span className="text-xs text-red-600">{fundErr}</span>}
        </div>
        <AddStakeholderForm
          disabled={locked}
          onAdd={(i: AddStakeholderInput) => act(`Added ${i.user.slice(0, 10)}…`, () => api.addStakeholder(i))}
        />
        <TimeControls disabled={locked} onSkip={(days) => act(`Skipped ${days} day(s)`, () => api.skipDays(days))} />
        {notDeployed && <p className="text-sm text-amber-700">Not deployed. Click Setup; the other actions unlock after it.</p>}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className={`${card} text-sm`}>
          <h2 className="mb-2 font-semibold">Chain</h2>
          <p>Chain time: <span className="font-mono">{fmtChainTime(chainTime)}</span></p>
          {deployment ? (
            <>
              <p>Token: <span className="font-mono">{deployment.token}</span></p>
              <p>Vault: <span className="font-mono">{deployment.vault}</span></p>
              <p>Owner: <span className="font-mono">{deployment.owner}</span></p>
            </>
          ) : (
            <p className="text-amber-700">Not deployed.</p>
          )}
        </div>
        <StatsCard dashboard={dashboard} />
      </section>

      <StakeholderTable rows={rows} />
    </div>
  );
}
