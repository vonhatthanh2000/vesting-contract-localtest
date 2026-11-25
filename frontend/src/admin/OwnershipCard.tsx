import { useState } from 'react';
import { api, type Account, type Deployment } from '../lib/api';
import { btn, card, input } from './ui';

const ZERO = '0x0000000000000000000000000000000000000000';
type Act = (label: string, fn: () => Promise<unknown>) => void;

/** Owner and pending owner (live), plus the two-step transfer, accept and renounce, all signed by Act as. */
export function OwnershipCard({
  deployment,
  accounts,
  actAs,
  disabled,
  onAct,
}: {
  deployment: Deployment | null;
  accounts: Account[];
  actAs: number;
  disabled: boolean;
  onAct: Act;
}) {
  const actAsAddr = accounts.find((a) => a.index === actAs)?.address;
  const isPending = !!deployment && !!actAsAddr && deployment.pendingOwner !== ZERO && actAsAddr.toLowerCase() === deployment.pendingOwner.toLowerCase();
  const [newOwner, setNewOwner] = useState('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'); // account #2
  const who = (addr?: string) => {
    if (!addr || addr === ZERO) return 'none';
    const i = accounts.find((a) => a.address.toLowerCase() === addr.toLowerCase())?.index;
    return i === undefined ? addr : `#${i} ${addr}`;
  };
  return (
    <section className={`${card} space-y-2 text-sm`}>
      <h2 className="font-semibold">Ownership</h2>
      <p>Owner: <span className="font-mono">{who(deployment?.owner)}</span></p>
      <p>Pending owner: <span className="font-mono">{who(deployment?.pendingOwner)}</span></p>
      {deployment && deployment.pendingOwner !== ZERO && !isPending && (
        <p className="text-xs text-slate-500">To accept, switch Act as to the pending owner.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="New owner" className={`${input} w-96 font-mono`} disabled={disabled} value={newOwner} onChange={(e) => setNewOwner(e.target.value)} />
        <button type="button" className={btn} disabled={disabled} onClick={() => onAct(`Transfer started as #${actAs}`, () => api.transferOwnership(newOwner.trim(), actAs))}>
          Transfer
        </button>
        {isPending && (
          <button type="button" className={btn} disabled={disabled} onClick={() => onAct(`Accepted ownership as #${actAs}`, () => api.acceptOwnership(actAs))}>
            Accept
          </button>
        )}
        <button type="button" className={btn} disabled={disabled} onClick={() => onAct(`Renounce as #${actAs}`, () => api.renounceOwnership(actAs))}>
          Renounce
        </button>
      </div>
    </section>
  );
}
