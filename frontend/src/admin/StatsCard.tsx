import type { Dashboard } from '../lib/api';
import { isUnderfunded } from '../lib/format';
import { card } from './ui';

export function StatsCard({ dashboard }: { dashboard: Dashboard | null }) {
  return (
    <div className={`${card} text-sm`}>
      <h2 className="mb-2 font-semibold">Stats</h2>
      {!dashboard ? (
        <p>–</p>
      ) : (
        <>
          {isUnderfunded(dashboard) && (
            <p role="alert" className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
              Underfunded: the vault holds {dashboard.vaultBalance} but {dashboard.remaining} is still owed. Fund it, or claims will fail.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-1">
            <dt>Allocated</dt><dd className="font-mono">{dashboard.allocated}</dd>
            <dt>Claimed</dt><dd className="font-mono">{dashboard.claimed}</dd>
            <dt>Remaining</dt><dd className="font-mono">{dashboard.remaining}</dd>
            <dt>Count</dt><dd className="font-mono">{dashboard.count}</dd>
            <dt>Vault balance</dt><dd className="font-mono">{dashboard.vaultBalance}</dd>
          </dl>
        </>
      )}
    </div>
  );
}
