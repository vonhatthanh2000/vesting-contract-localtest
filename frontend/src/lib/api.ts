// Typed client for the backend (backend/src/vesting/vesting.controller.ts).
export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

/** Saved record + live vault state (token, owner, pendingOwner, paused). */
export type Deployment = {
  vault: string;
  deployBlock: number;
  mockTokens: string[];
  token: string;
  owner: string;
  pendingOwner: string;
  paused: boolean;
};
export type Dashboard = { allocated: string; claimed: string; remaining: string; count: number; vaultBalance: string };
export type ScheduleStep = { unlockTime: number; amount: string };
export type StakeholderView = {
  exists: boolean;
  allocated: string;
  released: string;
  lastClaimedStep: number;
  totalSteps: number;
  claimable: string;
  claimableSteps: number;
  nextReleaseTime: number;
  chainTime: number;
  tokenBalance: string;
  schedule: ScheduleStep[];
};
export type StakeholderRow = StakeholderView & { address: string };
export type AddStakeholderInput = {
  user: string;
  totalAmount: string;
  steps: number;
  intervalDays: number;
  firstUnlockInDays: number;
};

/** Custom schedule, sent as is (the contract does the checks). unlockTime is chain-time unix seconds. */
export type ScheduleInput = { user: string; totalAmount: string; schedule: ScheduleStep[] };

/** What a replaceStakeholder would do (backend computes it with the contract's formulas). */
export type Preview = {
  exists: boolean;
  old: { allocated: string; released: string; lastClaimedStep: number; totalSteps: number } | null;
  forfeited: string;
  newTotal: string;
  totalAllocatedAfter: string;
  outstandingAfter: string;
  vaultBalance: string;
  shortfall: string;
  pastClaimsNotDeducted: boolean;
  wouldRevert: string | null;
};

/** One vault event (GET /events): amounts formatted, *Step* args as numbers, addresses checksummed. */
export type VaultEvent = { block: number; time: number; txHash: string; name: string; args: Record<string, string | number | boolean> };
/** The vault's balance of one mock token; a non-current token with a balance is stranded. */
export type VaultBalance = { token: string; vaultBalance: string; current: boolean };

/** A catalog entry (GET /scenarios). */
export type ScenarioInfo = { id: string; title: string; description: string };
/** One step of a scenario run: pass/fail, what was expected and what the chain showed. */
export type ScenarioStepResult = {
  label: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
  error?: string;
  /** Chain time right after the step. */
  time?: number;
  /** Vault events the step emitted. */
  events: { name: string; args: Record<string, string | number | boolean> }[];
};
/** POST /scenarios/:id/run: the run's own fresh vault and a result per step. */
export type ScenarioRun = { id: string; vault: string; pass: boolean; steps: ScenarioStepResult[] };

/** One of the node's 20 unlocked accounts, with its role. */
export type Account = { index: number; address: string; tokenBalance: string; isOwner: boolean; isPendingOwner: boolean; isStakeholder: boolean };
export type JumpInput = { user: string; offset?: -1 | 0 | 1; pin?: boolean };
type Tx = { txHash: string };
/** `as` (Hardhat account index) is added to a write's body only when set. */
const withAs = (body: object, as?: number) => (as === undefined ? body : { ...body, as });

/** A plan request in either form, as the plan editor builds it. */
export type PlanRequest = { kind: 'generator'; body: AddStakeholderInput } | { kind: 'schedule'; body: ScheduleInput };

/** A backend error: `name` is the `{ error }` field (e.g. AllocationMismatch, NotDeployed, BadRequest). */
export class ApiError extends Error {
  constructor(public readonly name: string, public readonly status: number, public readonly detail?: string) {
    super(detail ? `${name}: ${detail}` : name);
  }
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('BackendUnreachable', 0, `cannot reach ${API_BASE}; is \`npm run backend\` running?`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `HTTP${res.status}`, res.status, json.message);
  return json as T;
}

export const api = {
  setup: () => request<Deployment>('POST', '/setup'),
  deployment: () => request<Deployment>('GET', '/deployment'),
  /** Mint to the vault: the current token, or `token` (one of mockTokens). */
  fund: (amount: string, token?: string) => request<{ vaultBalance: string }>('POST', '/fund', token ? { amount, token } : { amount }),
  pause: (as?: number) => request<Tx>('POST', '/pause', withAs({}, as)),
  unpause: (as?: number) => request<Tx>('POST', '/unpause', withAs({}, as)),
  emergencyWithdraw: (to: string, amount: string, as?: number) => request<Tx>('POST', '/emergency-withdraw', withAs({ to, amount }, as)),
  deployMockToken: () => request<{ token: string }>('POST', '/tokens'),
  setToken: (token: string, as?: number) => request<Tx>('POST', '/token', withAs({ token }, as)),
  transferOwnership: (newOwner: string, as?: number) => request<Tx>('POST', '/ownership/transfer', withAs({ newOwner }, as)),
  acceptOwnership: (as?: number) => request<Tx>('POST', '/ownership/accept', withAs({}, as)),
  renounceOwnership: (as?: number) => request<Tx>('POST', '/ownership/renounce', withAs({}, as)),
  events: () => request<VaultEvent[]>('GET', '/events'),
  vaultBalances: () => request<VaultBalance[]>('GET', '/vault-balances'),
  scenarios: () => request<ScenarioInfo[]>('GET', '/scenarios'),
  runScenario: (id: string) => request<ScenarioRun>('POST', `/scenarios/${id}/run`),
  addStakeholder: (input: AddStakeholderInput) => request<{ txHash: string }>('POST', '/stakeholders', input),
  replaceSchedule: (input: ScheduleInput) => request<{ txHash: string }>('POST', '/stakeholders/schedule', input),
  /** Send a plan in either form (replaceStakeholder). */
  sendPlan: (r: PlanRequest, as?: number) =>
    request<Tx>('POST', r.kind === 'generator' ? '/stakeholders' : '/stakeholders/schedule', withAs(r.body, as)),
  /** Preview as signer `as`, so `wouldRevert` matches what sending as that account would hit. */
  preview: (r: PlanRequest, as?: number) =>
    request<Preview>('POST', r.kind === 'generator' ? '/stakeholders/preview' : '/stakeholders/schedule/preview', withAs(r.body, as)),
  remove: (addr: string, as?: number) => request<Tx>('DELETE', `/stakeholders/${addr}${as === undefined ? '' : `?as=${as}`}`),
  /** claim() (next step) or claimAll() signed by account `as`. */
  claim: (as: number, all = false) => request<Tx>('POST', '/claim', { as, all }),
  accounts: () => request<Account[]>('GET', '/accounts'),
  jump: (j: JumpInput) => request<{ chainTime: number; target: number; pinned: boolean }>('POST', '/time/jump', j),
  stakeholders: () => request<StakeholderRow[]>('GET', '/stakeholders'),
  stakeholder: (addr: string) => request<StakeholderView>('GET', `/stakeholders/${addr}`),
  dashboard: () => request<Dashboard>('GET', '/dashboard'),
  time: () => request<{ chainTime: number }>('GET', '/time'),
  skipDays: (days: number) => request<{ chainTime: number }>('POST', '/time/skip', { days }),
};
