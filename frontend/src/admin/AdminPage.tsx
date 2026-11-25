import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type Account, type Dashboard, type Deployment, type PlanRequest, type StakeholderRow, type VaultBalance, type VaultEvent } from '../lib/api';
import { scheduleToRows } from '../lib/schedule';
import { ActAs } from './ActAs';
import { EventLog } from './EventLog';
import { OwnershipCard } from './OwnershipCard';
import { VaultCard } from './VaultCard';
import { describeError } from '../lib/errors';
import { fmtChainTime, forfeitedOf } from '../lib/format';
import { PlanEditor, type PlanPrefill } from './PlanEditor';
import { StakeholderTable, type RowAction } from './StakeholderTable';
import { StatsCard } from './StatsCard';
import { TimeControls } from './TimeControls';
import { Toasts, type ToastMsg } from './Toast';
import { btn, card } from './ui';

let toastId = 0;

export default function AdminPage() {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [rows, setRows] = useState<StakeholderRow[]>([]);
  const [chainTime, setChainTime] = useState<number>();
  const [events, setEvents] = useState<VaultEvent[]>([]);
  const [eventsError, setEventsError] = useState<string>();
  const [balances, setBalances] = useState<VaultBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [actAs, setActAs] = useState(0); // signer of every admin write
  const [prefill, setPrefill] = useState<PlanPrefill>();
  const [version, setVersion] = useState(0); // bumps after every refresh so the replace preview re-reads chain state

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
          setEvents([]);
          setBalances([]);
          return;
        }
        throw e;
      }
      // Events load on their own: a log failure is shown in the log, not as a page-wide error.
      const evs = api.events().then(
        (e) => (setEventsError(undefined), e),
        (e) => (setEventsError(describeError(e)), [] as VaultEvent[]),
      );
      const [dash, list, accs, bals] = await Promise.all([api.dashboard(), api.stakeholders(), api.accounts(), api.vaultBalances()]);
      setDeployment(d);
      setDashboard(dash);
      setRows(list);
      setAccounts(accs);
      setEvents(await evs);
      setBalances(bals);
    } catch (e) {
      toast('error', describeError(e));
    } finally {
      setLoaded(true);
      setVersion((v) => v + 1);
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

  const short = (a: string) => `${a.slice(0, 10)}…`;
  const onRow = (r: RowAction) => {
    const u = r.row.address;
    if (r.kind === 'edit') return setPrefill({ key: (prefill?.key ?? 0) + 1, user: u, rows: scheduleToRows(r.row.schedule) });
    if (r.kind === 'remove') {
      const lost = forfeitedOf(r.row);
      if (!window.confirm(`Remove ${u}'s plan? ${lost} unclaimed tokens (including unlocked ones) are forfeited and become withdrawable excess.`)) return;
      return act(`Removed ${short(u)} (forfeited ${lost})`, () => api.remove(u, actAs));
    }
    if (r.kind === 'claim') return act(`${r.all ? 'Claimed all' : 'Claimed'} as #${r.as}`, () => api.claim(r.as, r.all));
    return act(`Jumped to ${short(u)} next unlock ${r.offset >= 0 ? '+' : ''}${r.offset} s${r.pin ? ' (pinned)' : ''}`, () => api.jump({ user: u, offset: r.offset, pin: r.pin }));
  };

  const notDeployed = loaded && !deployment;
  const locked = busy || !deployment; // everything except Setup

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 text-slate-800">
      <Toasts items={toasts} onDismiss={dismiss} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vesting admin</h1>
        <Link className="text-sm text-blue-600 underline" to="/scenarios">scenarios</Link>
        {busy && <span className="text-sm text-slate-500">Working…</span>}
      </div>

      <section className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} disabled={busy} onClick={() => act('Deployed token and vault', api.setup)}>
            {deployment ? 'Setup (redeploy)' : 'Setup'}
          </button>
        </div>
        <ActAs accounts={accounts} value={actAs} disabled={locked} onChange={setActAs} />
        <PlanEditor
          disabled={locked}
          chainTime={chainTime}
          refreshKey={version}
          actAs={actAs}
          prefill={prefill}
          onSend={(r: PlanRequest) => act(`Sent plan for ${short(r.body.user)} as #${actAs}`, () => api.sendPlan(r, actAs))}
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

      <StakeholderTable rows={rows} accounts={accounts} disabled={locked} onAction={onRow} />

      <section className="grid gap-4 md:grid-cols-2">
        <VaultCard deployment={deployment} balances={balances} actAs={actAs} disabled={locked} onAct={act} />
        <OwnershipCard deployment={deployment} accounts={accounts} actAs={actAs} disabled={locked} onAct={act} />
      </section>

      <EventLog events={events} error={eventsError} />
    </div>
  );
}
