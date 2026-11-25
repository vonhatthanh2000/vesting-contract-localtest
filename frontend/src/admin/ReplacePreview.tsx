import { useEffect, useRef, useState } from 'react';
import { api, type PlanRequest, type Preview } from '../lib/api';
import { describeError, HINTS } from '../lib/errors';

/**
 * Asks the backend what this replace would do (debounced 300 ms) and shows old vs new, forfeited, the new
 * outstanding, the vault shortfall, the past-claims warning and the revert it would hit. Never blocks sending.
 */
export function ReplacePreview({
  request,
  refreshKey,
  as,
  onExists,
}: {
  request: PlanRequest | null;
  refreshKey: number;
  /** Signer the preview's `wouldRevert` is computed for (the Act-as account). */
  as?: number;
  onExists: (exists: boolean | undefined) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string>();
  const key = JSON.stringify(request);
  const seq = useRef(0); // only the latest request may set state: a slow older response is dropped

  useEffect(() => {
    if (!request) {
      seq.current++;
      setPreview(null);
      setError(undefined);
      onExists(undefined);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api
        .preview(request, as)
        .then((p) => {
          if (mine !== seq.current) return;
          setPreview(p);
          setError(undefined);
          onExists(p.exists);
        })
        .catch((e) => {
          if (mine !== seq.current) return;
          setPreview(null);
          setError(describeError(e));
          onExists(undefined);
        });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey, as]);

  if (error) return <p role="status" aria-label="Replace preview" className="text-xs text-red-600">Preview failed: {error}</p>;
  if (!preview) return null;
  const p = preview;
  return (
    <div aria-label="Replace preview" className="space-y-1 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
      <p className="font-semibold">{p.exists ? 'Replace an existing plan' : 'New plan'}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 font-mono">
        {p.old && (
          <>
            <dt>Old allocated / released</dt>
            <dd>
              {p.old.allocated} / {p.old.released} (step {p.old.lastClaimedStep} of {p.old.totalSteps} claimed)
            </dd>
          </>
        )}
        <dt>Forfeited</dt><dd>{p.forfeited}</dd>
        <dt>New total</dt><dd>{p.newTotal}</dd>
        <dt>Total allocated after</dt><dd>{p.totalAllocatedAfter}</dd>
        <dt>Outstanding after</dt><dd>{p.outstandingAfter}</dd>
        <dt>Vault balance</dt><dd>{p.vaultBalance}</dd>
        <dt>Shortfall</dt><dd className={p.shortfall !== '0.0' ? 'text-red-600' : ''}>{p.shortfall}</dd>
      </dl>
      {p.pastClaimsNotDeducted && (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
          Already claimed {p.old!.released}; the new plan pays the full new total ({p.newTotal}) on top.
        </p>
      )}
      {p.wouldRevert && (
        <p className="text-red-700">
          Would revert: {p.wouldRevert}
          {HINTS[p.wouldRevert] && ` (${HINTS[p.wouldRevert]})`}
        </p>
      )}
    </div>
  );
}
