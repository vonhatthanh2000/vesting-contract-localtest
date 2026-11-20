import { useCallback, useEffect, useState } from 'react';
import type { Address } from 'viem';
import { usePublicClient } from 'wagmi';
import { api, ApiError, type Deployment } from '../lib/api';
import { tokenAbi, vestingAbi } from '../lib/contracts';
import { hardhatLocal } from '../wagmi';

export type VestingView = {
  exists: boolean;
  allocated: bigint;
  released: bigint;
  lastClaimedStep: number;
  totalSteps: number;
  claimable: bigint;
  claimableSteps: number;
  canClaimNow: boolean;
  nextReleaseTime: number;
  balance: bigint;
  schedule: { unlockTime: number; amount: bigint }[];
};

export type VestingState =
  | { kind: 'loading' }
  | { kind: 'notDeployed' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; deployment: Deployment; view?: VestingView };

/** Reads the connected user's plan straight from the vault, re-reading whenever `blockNumber` changes. */
export function useVesting(user: Address | undefined, blockNumber: bigint | undefined) {
  const client = usePublicClient({ chainId: hardhatLocal.id })!;
  const [state, setState] = useState<VestingState>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    let deployment: Deployment;
    try {
      deployment = await api.deployment();
    } catch (e) {
      setState(e instanceof ApiError && e.name === 'NotDeployed' ? { kind: 'notDeployed' } : { kind: 'error', message: (e as Error).message });
      return;
    }
    if (!user) return setState({ kind: 'ready', deployment });
    try {
      const vault = deployment.vault as Address;
      const read = <T,>(functionName: string) => client.readContract({ address: vault, abi: vestingAbi, functionName, args: [user] }) as Promise<T>;
      const [dash, cl, can, next, sched, balance] = await Promise.all([
        read<[boolean, bigint, bigint, number, number]>('getUserDashboard'),
        read<[bigint, number]>('claimable'),
        read<boolean>('canClaimNow'),
        read<bigint>('getNextReleaseTime'),
        read<{ unlockTime: bigint; amount: bigint }[]>('getSchedule'),
        client.readContract({ address: deployment.token as Address, abi: tokenAbi, functionName: 'balanceOf', args: [user] }) as Promise<bigint>,
      ]);
      setState({
        kind: 'ready',
        deployment,
        view: {
          exists: dash[0],
          allocated: dash[1],
          released: dash[2],
          lastClaimedStep: Number(dash[3]),
          totalSteps: Number(dash[4]),
          claimable: cl[0],
          claimableSteps: Number(cl[1]),
          canClaimNow: can,
          nextReleaseTime: Number(next),
          balance,
          schedule: sched.map((s) => ({ unlockTime: Number(s.unlockTime), amount: s.amount })),
        },
      });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message.split('\n')[0] });
    }
  }, [client, user]);

  useEffect(() => {
    refresh();
  }, [refresh, blockNumber]);

  return { state, refresh };
}
