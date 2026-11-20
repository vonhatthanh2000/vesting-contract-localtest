import { useBlock } from 'wagmi';
import { hardhatLocal } from '../wagmi';

/**
 * The one source of "now" for the stakeholder page: the latest block's timestamp (seconds), updated
 * on every new block. Never the browser clock: the chain clock is moved by evm_increaseTime.
 */
export function useChainTime(): { chainTime?: number; blockNumber?: bigint } {
  const { data } = useBlock({ chainId: hardhatLocal.id, blockTag: 'latest', watch: true });
  return { chainTime: data ? Number(data.timestamp) : undefined, blockNumber: data?.number ?? undefined };
}
