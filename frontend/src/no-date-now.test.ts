import { describe, expect, it } from 'vitest';

// PLAN 03 H4: "now" is always the chain's latest block timestamp. Grep every source file for the browser clock.
const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('no browser clock', () => {
  it('scans the source files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });
  it.each(Object.entries(sources))('%s has no Date.now() / new Date() without args', (_file, src) => {
    expect(src).not.toMatch(/Date\.now\s*\(/);
    expect(src).not.toMatch(/new Date\(\s*\)/);
    expect(src).not.toMatch(/performance\.now\s*\(/);
  });
});
