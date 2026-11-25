import { EventFragment, Interface, Log, formatUnits, getAddress } from 'ethers';
import { DECIMALS } from './steps';

export type EventArgs = Record<string, string | number | boolean>;
export type VaultEvent = { block: number; time: number; txHash: string; name: string; args: EventArgs };

/** getLogs window: Hardhat has no hard cap, but public nodes do; keep requests bounded. */
export const LOG_CHUNK = 10_000;

/** Inclusive [from, to] block ranges of at most `size` blocks. */
export function blockChunks(from: number, to: number, size = LOG_CHUNK): [number, number][] {
  const out: [number, number][] = [];
  for (let a = from; a <= to; a += size) out.push([a, Math.min(a + size - 1, to)]);
  return out;
}

/**
 * Format one event's args by its ABI inputs: addresses checksummed; uints whose name contains "step" stay numbers
 * (fromStep, toStep, totalSteps); every other uint is a token amount at 18 decimals; bools stay bools.
 */
export function formatEventArgs(fragment: EventFragment, values: readonly unknown[]): EventArgs {
  const args: EventArgs = {};
  fragment.inputs.forEach((input, i) => {
    const v = values[i];
    if (input.type === 'address') args[input.name] = getAddress(v as string);
    else if (typeof v === 'bigint') args[input.name] = /step/i.test(input.name) ? Number(v) : formatUnits(v, DECIMALS);
    else if (typeof v === 'boolean') args[input.name] = v;
    else args[input.name] = String(v);
  });
  return args;
}

/** Decode a vault log, or null for a log the ABI doesn't know (skipped, never thrown). */
export function decodeLog(iface: Interface, log: Pick<Log, 'topics' | 'data'>): { name: string; args: EventArgs } | null {
  let parsed;
  try {
    parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
  } catch {
    return null;
  }
  return parsed ? { name: parsed.name, args: formatEventArgs(parsed.fragment, parsed.args) } : null;
}
