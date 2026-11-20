import { useState } from 'react';
import { Link } from 'react-router';
import type { Address } from 'viem';
import { useAccount, useConnect, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { claimMessage, describeClaimError } from '../lib/claimErrors';
import { vestingAbi } from '../lib/contracts';
import { fmtChainTime, formatToken } from '../lib/format';
import { hardhatLocal } from '../wagmi';
import { ScheduleTable } from './ScheduleTable';
import { useChainTime } from './useChainTime';
import { useVesting } from './useVesting';

const btn = 'rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300';
const box = 'rounded border p-4 text-sm';

export default function StakeholderPage() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const client = usePublicClient({ chainId: hardhatLocal.id })!;
  const { writeContractAsync } = useWriteContract();
  const { chainTime, blockNumber } = useChainTime();
  const { state, refresh } = useVesting(isConnected ? address : undefined, blockNumber);
  const [sending, setSending] = useState<'claim' | 'claimAll' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string }>();

  const wrongNetwork = isConnected && chainId !== hardhatLocal.id;
  const view = state.kind === 'ready' ? state.view : undefined;

  const send = async (functionName: 'claim' | 'claimAll') => {
    if (state.kind !== 'ready' || !address) return;
    setSending(functionName);
    setMessage(undefined);
    const req = { address: state.deployment.vault as Address, abi: vestingAbi, functionName, account: address, chainId: hardhatLocal.id } as const;
    try {
      await client.simulateContract(req); // preflight: a revert is decoded before the wallet pops up
      const hash = await writeContractAsync(req);
      const receipt = await client.waitForTransactionReceipt({ hash });
      setMessage(receipt.status === 'success' ? { kind: 'ok', text: `Claimed (tx ${hash.slice(0, 10)}…)` } : { kind: 'err', text: 'Transaction reverted' });
    } catch (e) {
      setMessage({ kind: 'err', text: describeClaimError(e, view?.nextReleaseTime) });
    } finally {
      setSending(null);
      await refresh();
    }
  };

  const pct = view && view.allocated > 0n ? Number((view.released * 10000n) / view.allocated) / 100 : 0;
  const claimHint = !view || !view.exists ? undefined
    : view.lastClaimedStep >= view.totalSteps ? claimMessage('VestingComplete')
    : !view.canClaimNow ? claimMessage('StepLocked', view.nextReleaseTime)
    : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 text-slate-800">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My vesting</h1>
        <Link className="text-sm text-blue-600 underline" to="/admin">admin</Link>
      </div>

      <section className={`${box} flex flex-wrap items-center gap-3`}>
        {!isConnected ? (
          <>
            <span>Not connected.</span>
            <button className={btn} disabled={connecting || !connectors[0]} onClick={() => connect({ connector: connectors[0], chainId: hardhatLocal.id })}>
              {connecting ? 'Connecting…' : 'Connect wallet'}
            </button>
            {!connectors[0] && <span className="text-amber-700">No browser wallet found. Install MetaMask.</span>}
            {connectError && <span className="text-red-600">{connectError.message.split('\n')[0]}</span>}
          </>
        ) : (
          <>
            <span className="font-mono">{address}</span>
            <button className={btn} onClick={() => disconnect()}>Disconnect</button>
          </>
        )}
        <span className="ml-auto text-slate-500">Chain time: <span className="font-mono">{fmtChainTime(chainTime)}</span></span>
      </section>

      {wrongNetwork && (
        <section role="alert" className={`${box} flex items-center gap-3 border-amber-300 bg-amber-50 text-amber-800`}>
          Wrong network (chain {chainId}). This page needs Hardhat Local (31337).
          <button className={btn} disabled={switching} onClick={() => switchChain({ chainId: hardhatLocal.id })}>
            {switching ? 'Switching…' : 'Switch to Hardhat Local'}
          </button>
        </section>
      )}

      {state.kind === 'notDeployed' && <p className="text-amber-700">The vault isn't deployed yet. Ask the admin to run Setup on <Link className="underline" to="/admin">/admin</Link>.</p>}
      {state.kind === 'error' && <p className="text-red-600">{state.message}</p>}

      {isConnected && !wrongNetwork && view && !view.exists && <p className={box}>{claimMessage('NotStakeholder')}.</p>}

      {isConnected && !wrongNetwork && view?.exists && chainTime !== undefined && (
        <>
          <section className={`${box} space-y-2`}>
            <div className="h-3 w-full rounded bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-3 rounded bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <dl className="grid grid-cols-2 gap-1">
              <dt>Released / allocated</dt><dd className="font-mono">{formatToken(view.released)} / {formatToken(view.allocated)} ({pct}%)</dd>
              <dt>Steps claimed</dt><dd className="font-mono">{view.lastClaimedStep} / {view.totalSteps}</dd>
              <dt>Claimable now</dt><dd className="font-mono">{formatToken(view.claimable)} ({view.claimableSteps} steps)</dd>
              <dt>Next release</dt><dd className="font-mono">{view.nextReleaseTime ? fmtChainTime(view.nextReleaseTime) : '–'}</dd>
              <dt>Token balance</dt><dd className="font-mono">{formatToken(view.balance)}</dd>
            </dl>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button className={btn} disabled={!!sending || !view.canClaimNow} onClick={() => send('claim')}>
                {sending === 'claim' ? 'Claiming…' : 'Claim (next step)'}
              </button>
              <button className={btn} disabled={!!sending || view.claimable === 0n} onClick={() => send('claimAll')}>
                {sending === 'claimAll' ? 'Claiming…' : 'Claim all'}
              </button>
              {claimHint && <span className="text-slate-600">{claimHint}</span>}
            </div>
            {message && <p role={message.kind === 'err' ? 'alert' : 'status'} className={`break-all ${message.kind === 'err' ? 'text-red-600' : 'text-emerald-700'}`}>{message.text}</p>}
          </section>
          <ScheduleTable schedule={view.schedule} lastClaimedStep={view.lastClaimedStep} chainTime={chainTime} />
        </>
      )}
    </div>
  );
}
