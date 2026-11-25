import { ZeroAddress } from 'ethers';
import { Ctx, Scenario, units } from './runner';

const DAY = 86400;
const U1 = 1; // Hardhat account #1
const U2 = 2; // Hardhat account #2
const NON_OWNER = 3; // Hardhat account #3

type StepIn = { unlockTime: bigint; amount: bigint };

/** n equal steps of total/n, "monthly" = first unlock +30 d, then every 30 d, relative to chain time *now*. */
async function monthly(c: Ctx, total: string, n: number): Promise<StepIn[]> {
  const now = await c.now();
  const each = units(total) / BigInt(n);
  return Array.from({ length: n }, (_, i) => ({ unlockTime: BigInt(now + 30 * DAY * (i + 1)), amount: each }));
}

/** One step per `secs` offset from chain time now, `amount` each (offsets may be negative: already unlocked). */
async function at(c: Ctx, secs: number[], amount: string): Promise<StepIn[]> {
  const now = await c.now();
  return secs.map((d) => ({ unlockTime: BigInt(now + d), amount: units(amount) }));
}

const replace = async (c: Ctx, user: number, steps: StepIn[], total: string, as = 0) =>
  c.send(as, 'replaceStakeholder', [await c.addr(user), steps, units(total)]);

export const CATALOG: Scenario[] = [
  {
    id: 'replace-new-user',
    title: 'Replace on a new user adds the plan',
    description: 'replaceStakeholder for an address with no plan behaves as an add: StakeholderAdded, count 1.',
    users: [U1],
    steps: [
      { label: 'fund 1200', act: (c) => c.fund('1200'), expect: { dashboard: { vaultBalance: '1200.0' } } },
      {
        label: 'replace U1 with 12×100 monthly → StakeholderAdded',
        act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200'),
        expect: {
          events: ['StakeholderAdded'],
          dashboard: { count: 1, allocated: '1200.0', remaining: '1200.0' },
          users: { [U1]: { allocated: '1200.0', released: '0.0', totalSteps: 12 } },
        },
      },
    ],
  },
  {
    id: 'replace-after-partial-claim',
    title: 'Replace after a partial claim pays the full new total again',
    description:
      'U1 claims 300 of a 1200 plan, then gets a new 1200 plan. Past claims are not deducted: the vault needs 300 more, and U1 ends with 1500.',
    users: [U1],
    steps: [
      { label: 'fund 1200', act: (c) => c.fund('1200'), expect: { dashboard: { vaultBalance: '1200.0' } } },
      {
        label: 'U1 gets 1200 in 12 monthly steps',
        act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200'),
        expect: { events: ['StakeholderAdded'], dashboard: { allocated: '1200.0' } },
      },
      { label: 'jump past step 3', act: (c) => c.jumpPastStep(U1, 3), expect: { users: { [U1]: { claimable: '300.0' } } } },
      {
        label: 'claimAll as U1 → 300',
        act: (c) => c.send(U1, 'claimAll', []),
        expect: { events: ['Claimed'], users: { [U1]: { released: '300.0', lastClaimedStep: 3, tokenBalance: '300.0' } }, dashboard: { vaultBalance: '900.0' } },
      },
      {
        label: 'replace without top-up → InsufficientVaultBalance (vault 900 < outstanding 1200)',
        act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200'),
        expect: { revert: 'InsufficientVaultBalance' },
      },
      { label: 'fund 300', act: (c) => c.fund('300'), expect: { dashboard: { vaultBalance: '1200.0' } } },
      {
        label: 'replace U1 with a new 1200/12 → StakeholderReplaced',
        act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200'),
        expect: {
          events: ['StakeholderReplaced'],
          dashboard: { allocated: '1500.0', claimed: '300.0', remaining: '1200.0' },
          users: { [U1]: { allocated: '1200.0', released: '0.0', lastClaimedStep: 0 } },
        },
      },
      { label: 'jump past step 12', act: (c) => c.jumpPastStep(U1, 12), expect: { users: { [U1]: { claimable: '1200.0' } } } },
      {
        label: 'claimAll → U1 tokenBalance 1500.0 (past claims not deducted)',
        act: (c) => c.send(U1, 'claimAll', []),
        expect: { events: ['Claimed'], users: { [U1]: { tokenBalance: '1500.0' } }, dashboard: { remaining: '0.0' } },
      },
    ],
  },
  {
    id: 'replace-invalid-schedules',
    title: 'Invalid schedules are rejected and change nothing',
    description: 'Each bad plan reverts with its own error; state is unchanged after every attempt.',
    users: [U1],
    steps: [
      { label: 'fund 1200', act: (c) => c.fund('1200'), expect: { dashboard: { vaultBalance: '1200.0' } } },
      { label: '0 steps → InvalidSchedule', act: (c) => replace(c, U1, [], '0'), expect: { revert: 'InvalidSchedule' } },
      {
        label: '101 steps → InvalidSchedule',
        act: async (c) => {
          const now = await c.now();
          return replace(c, U1, Array.from({ length: 101 }, (_, i) => ({ unlockTime: BigInt(now + i + 1), amount: units('1') })), '101');
        },
        expect: { revert: 'InvalidSchedule' },
      },
      {
        label: 'a zero amount → InvalidSchedule',
        act: async (c) => {
          const now = await c.now();
          return replace(c, U1, [{ unlockTime: BigInt(now + 1), amount: units('1') }, { unlockTime: BigInt(now + 2), amount: 0n }], '1');
        },
        expect: { revert: 'InvalidSchedule' },
      },
      {
        label: 'equal unlock times → InvalidSchedule',
        act: async (c) => {
          const t = BigInt((await c.now()) + 100);
          return replace(c, U1, [{ unlockTime: t, amount: units('1') }, { unlockTime: t, amount: units('1') }], '2');
        },
        expect: { revert: 'InvalidSchedule' },
      },
      {
        label: 'decreasing unlock times → InvalidSchedule',
        act: async (c) => {
          const now = await c.now();
          return replace(c, U1, [{ unlockTime: BigInt(now + 200), amount: units('1') }, { unlockTime: BigInt(now + 100), amount: units('1') }], '2');
        },
        expect: { revert: 'InvalidSchedule' },
      },
      {
        label: 'sum ≠ total → AllocationMismatch',
        act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1000'),
        expect: { revert: 'AllocationMismatch' },
      },
      {
        label: 'user 0x0 → ZeroAddress',
        act: async (c) => c.send(0, 'replaceStakeholder', [ZeroAddress, await monthly(c, '100', 1), units('100')]),
        expect: { revert: 'ZeroAddress' },
      },
      { label: 'nothing changed: no plan, nothing allocated', act: async () => undefined, expect: { dashboard: { count: 0, allocated: '0.0' }, users: { [U1]: { totalSteps: 0 } } } },
    ],
  },
  {
    id: 'replace-before-claim',
    title: 'Replace before any claim swaps the whole plan',
    description: 'A smaller plan frees the difference as excess; a larger one needs the vault topped up first.',
    users: [U1],
    steps: [
      { label: 'fund 1200', act: (c) => c.fund('1200'), expect: { dashboard: { vaultBalance: '1200.0' } } },
      { label: 'U1 gets 1200/12', act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200'), expect: { events: ['StakeholderAdded'] } },
      {
        label: 'replace with 600/6 → StakeholderReplaced, 600 becomes excess',
        act: async (c) => replace(c, U1, await monthly(c, '600', 6), '600'),
        expect: { events: ['StakeholderReplaced'], dashboard: { allocated: '600.0', remaining: '600.0', vaultBalance: '1200.0' }, users: { [U1]: { totalSteps: 6 } } },
      },
      {
        label: 'replace with 1500/15 without funding → InsufficientVaultBalance',
        act: async (c) => replace(c, U1, await monthly(c, '1500', 15), '1500'),
        expect: { revert: 'InsufficientVaultBalance' },
      },
      { label: 'fund 300 (the minimal top-up)', act: (c) => c.fund('300'), expect: { dashboard: { vaultBalance: '1500.0' } } },
      {
        label: 'retry 1500/15 → ok',
        act: async (c) => replace(c, U1, await monthly(c, '1500', 15), '1500'),
        expect: { events: ['StakeholderReplaced'], dashboard: { allocated: '1500.0', remaining: '1500.0' }, users: { [U1]: { totalSteps: 15 } } },
      },
    ],
  },
  {
    id: 'replace-forfeits-unlocked',
    title: 'Replace forfeits unlocked but unclaimed steps',
    description: 'Steps that unlocked but were not claimed are gone after a replace; only the new plan counts.',
    users: [U1],
    steps: [
      { label: 'fund 1200', act: (c) => c.fund('1200'), expect: { dashboard: { vaultBalance: '1200.0' } } },
      { label: 'U1 gets 1200/12', act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200'), expect: { events: ['StakeholderAdded'] } },
      { label: 'jump past step 3 (no claim)', act: (c) => c.jumpPastStep(U1, 3), expect: { users: { [U1]: { claimable: '300.0', released: '0.0' } } } },
      {
        label: 'replace with 100/1 at +30 d → the unlocked 300 is gone',
        act: async (c) => replace(c, U1, await at(c, [30 * DAY], '100'), '100'),
        expect: {
          events: ['StakeholderReplaced'],
          dashboard: { allocated: '100.0', remaining: '100.0', vaultBalance: '1200.0' },
          users: { [U1]: { claimable: '0.0', allocated: '100.0', totalSteps: 1 } },
        },
      },
    ],
  },
  {
    id: 'replace-after-complete',
    title: 'Replace after a completed plan starts a new one',
    description: 'Once every step is claimed, a replace gives the user a fresh plan on top of what they already got.',
    users: [U1],
    steps: [
      { label: 'fund 300', act: (c) => c.fund('300'), expect: { dashboard: { vaultBalance: '300.0' } } },
      { label: 'U1 gets 300/3 monthly', act: async (c) => replace(c, U1, await monthly(c, '300', 3), '300'), expect: { events: ['StakeholderAdded'] } },
      { label: 'jump past step 3', act: (c) => c.jumpPastStep(U1, 3), expect: { users: { [U1]: { claimable: '300.0' } } } },
      { label: 'claimAll → 300', act: (c) => c.send(U1, 'claimAll', []), expect: { users: { [U1]: { tokenBalance: '300.0', lastClaimedStep: 3 } } } },
      { label: 'claim → VestingComplete', act: (c) => c.send(U1, 'claim', []), expect: { revert: 'VestingComplete' } },
      { label: 'fund 100', act: (c) => c.fund('100'), expect: { dashboard: { vaultBalance: '100.0' } } },
      {
        label: 'replace with 100/1 at +30 d',
        act: async (c) => replace(c, U1, await at(c, [30 * DAY], '100'), '100'),
        expect: { events: ['StakeholderReplaced'], users: { [U1]: { allocated: '100.0', released: '0.0', lastClaimedStep: 0, totalSteps: 1 } } },
      },
      { label: 'jump past step 1', act: (c) => c.jumpPastStep(U1, 1), expect: { users: { [U1]: { claimable: '100.0' } } } },
      { label: 'claimAll → U1 tokenBalance 400.0', act: (c) => c.send(U1, 'claimAll', []), expect: { events: ['Claimed'], users: { [U1]: { tokenBalance: '400.0' } } } },
    ],
  },
  {
    id: 'replace-removed-user',
    title: 'Replace on a removed user adds a new plan',
    description: 'After removeStakeholder the user has no plan, so a replace takes the add path (StakeholderAdded, not Replaced).',
    users: [U1],
    steps: [
      { label: 'fund 1200', act: (c) => c.fund('1200'), expect: { dashboard: { vaultBalance: '1200.0' } } },
      { label: 'add U1 1200/12', act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200'), expect: { events: ['StakeholderAdded'] } },
      {
        label: 'remove U1 → StakeholderRemoved(forfeited 1200)',
        act: async (c) => c.send(0, 'removeStakeholder', [await c.addr(U1)]),
        expect: { events: ['StakeholderRemoved'], log: [{ name: 'StakeholderRemoved', args: { forfeited: '1200.0' } }], dashboard: { count: 0, allocated: '0.0' } },
      },
      {
        label: 'replace U1 1200/12 → StakeholderAdded (not Replaced)',
        act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200'),
        expect: { events: ['StakeholderAdded'], dashboard: { count: 1, allocated: '1200.0' } },
      },
    ],
  },
  {
    id: 'replace-past-unlocks',
    title: 'A plan with past unlock times is claimable at once',
    description: 'The contract does not require future unlocks: a plan whose steps are all in the past pays out in one claimAll.',
    users: [U1],
    steps: [
      { label: 'fund 300', act: (c) => c.fund('300'), expect: { dashboard: { vaultBalance: '300.0' } } },
      {
        label: 'replace U1 with 3×100 at now − 300 s, − 200 s, − 100 s',
        act: async (c) => replace(c, U1, await at(c, [-300, -200, -100], '100'), '300'),
        expect: { events: ['StakeholderAdded'], users: { [U1]: { claimable: '300.0' } } },
      },
      {
        label: 'claimAll pays 300 → Claimed(fromStep 1, toStep 3)',
        act: (c) => c.send(U1, 'claimAll', []),
        expect: { log: [{ name: 'Claimed', args: { amount: '300.0', fromStep: 1, toStep: 3 } }], users: { [U1]: { tokenBalance: '300.0', released: '300.0' } } },
      },
    ],
  },
  {
    id: 'replace-boundary',
    title: 'The exact unlock second',
    description: 'With the next block pinned at unlock − 1 the claim is StepLocked (and nothing is mined, so the pin stays); pinned at the unlock, it succeeds.',
    users: [U1],
    steps: [
      { label: 'fund 1200', act: (c) => c.fund('1200'), expect: { dashboard: { vaultBalance: '1200.0' } } },
      { label: 'U1 gets 1200/12 monthly', act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200'), expect: { events: ['StakeholderAdded'] } },
      { label: 'pin the next block at the first unlock − 1', act: async (c) => c.pin((await c.unlockOf(U1, 1)) - 1), expect: { users: { [U1]: { released: '0.0' } } } },
      { label: 'claim → StepLocked (nothing mined, pin kept)', act: (c) => c.send(U1, 'claim', []), expect: { revert: 'StepLocked' } },
      { label: 'pin the next block at the first unlock', act: async (c) => c.pin(await c.unlockOf(U1, 1)), expect: { users: { [U1]: { released: '0.0' } } } },
      { label: 'claim → ok, released 100.0', act: (c) => c.send(U1, 'claim', []), expect: { events: ['Claimed'], users: { [U1]: { released: '100.0', lastClaimedStep: 1 } } } },
    ],
  },
  {
    id: 'replace-non-owner',
    title: 'Only the owner can replace',
    description: 'replaceStakeholder from a non-owner account reverts with OwnableUnauthorizedAccount and adds nothing.',
    users: [U1],
    steps: [
      { label: 'fund 1200', act: (c) => c.fund('1200'), expect: { dashboard: { vaultBalance: '1200.0' } } },
      {
        label: 'replace U1 as #3 → OwnableUnauthorizedAccount',
        act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200', NON_OWNER),
        expect: { revert: 'OwnableUnauthorizedAccount' },
      },
      { label: 'count is still 0', act: async () => undefined, expect: { dashboard: { count: 0 } } },
    ],
  },
  {
    id: 'replace-while-paused',
    title: 'Replace works while paused; claims do not',
    description: 'pause() blocks claim/claimAll only; the owner can still replace plans, and claims resume after unpause.',
    users: [U1],
    steps: [
      { label: 'fund 300', act: (c) => c.fund('300'), expect: { dashboard: { vaultBalance: '300.0' } } },
      { label: 'pause', act: (c) => c.send(0, 'pause', []), expect: { events: ['Paused'] } },
      {
        label: 'replace U1 with 3×100 in the past → ok (StakeholderAdded)',
        act: async (c) => replace(c, U1, await at(c, [-300, -200, -100], '100'), '300'),
        expect: { events: ['StakeholderAdded'], users: { [U1]: { claimable: '300.0' } } },
      },
      { label: 'claim as U1 → EnforcedPause', act: (c) => c.send(U1, 'claim', []), expect: { revert: 'EnforcedPause' } },
      { label: 'unpause', act: (c) => c.send(0, 'unpause', []), expect: { events: ['Unpaused'] } },
      { label: 'claim → released 100.0', act: (c) => c.send(U1, 'claim', []), expect: { events: ['Claimed'], users: { [U1]: { released: '100.0' } } } },
    ],
  },
  {
    id: 'replace-keeps-others',
    title: 'Replacing one user leaves the others alone',
    description: "Replacing U1 changes neither U2's plan nor the order of getStakeholders.",
    users: [U1, U2],
    steps: [
      { label: 'fund 2400', act: (c) => c.fund('2400'), expect: { dashboard: { vaultBalance: '2400.0' } } },
      { label: 'add U1 1200/12', act: async (c) => replace(c, U1, await monthly(c, '1200', 12), '1200'), expect: { holders: [U1] } },
      { label: 'add U2 1200/12', act: async (c) => replace(c, U2, await monthly(c, '1200', 12), '1200'), expect: { holders: [U1, U2] } },
      {
        label: "replace U1 with 600/6 → U2 unchanged, order still [U1, U2]",
        act: async (c) => replace(c, U1, await monthly(c, '600', 6), '600'),
        expect: {
          events: ['StakeholderReplaced'],
          holders: [U1, U2],
          users: {
            [U1]: { allocated: '600.0', totalSteps: 6 },
            [U2]: { allocated: '1200.0', released: '0.0', lastClaimedStep: 0, totalSteps: 12, claimable: '0.0' },
          },
          dashboard: { count: 2, allocated: '1800.0' },
        },
      },
    ],
  },
];
