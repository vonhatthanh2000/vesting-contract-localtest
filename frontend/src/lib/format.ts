/** Chain timestamp (seconds) → "YYYY-MM-DD HH:MM:SS UTC". Times always come from the chain, never the browser clock. */
export const fmtChainTime = (t?: number) =>
  t ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '–';

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Decimal string (as the backend returns, e.g. "1200.0") → bigint in 18-decimal units, for exact comparisons. */
export function toUnits(v: string, decimals = 18): bigint {
  const [i, f = ''] = v.split('.');
  return BigInt(i || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

export function isUnderfunded(d: { vaultBalance: string; remaining: string }): boolean {
  return toUnits(d.vaultBalance) < toUnits(d.remaining);
}

/** 18-decimal bigint → "1200.0" (same shape as the backend's formatUnits output). */
export function formatToken(v: bigint, decimals = 18): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const frac = (a % base).toString().padStart(decimals, '0').replace(/0+$/, '') || '0';
  return `${neg ? '-' : ''}${a / base}.${frac}`;
}
