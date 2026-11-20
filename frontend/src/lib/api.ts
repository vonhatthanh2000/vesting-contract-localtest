// Typed client for the backend (backend/src/vesting/vesting.controller.ts).
export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export type Deployment = { token: string; vault: string; owner: string };
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

/** A backend error: `name` is the `{ error }` field (e.g. AlreadyStakeholder, NotDeployed, BadRequest). */
export class ApiError extends Error {
  constructor(public readonly name: string, public readonly status: number, public readonly detail?: string) {
    super(detail ? `${name}: ${detail}` : name);
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
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
  fund: (amount: string) => request<{ vaultBalance: string }>('POST', '/fund', { amount }),
  addStakeholder: (input: AddStakeholderInput) => request<{ txHash: string }>('POST', '/stakeholders', input),
  stakeholders: () => request<StakeholderRow[]>('GET', '/stakeholders'),
  stakeholder: (addr: string) => request<StakeholderView>('GET', `/stakeholders/${addr}`),
  dashboard: () => request<Dashboard>('GET', '/dashboard'),
  time: () => request<{ chainTime: number }>('GET', '/time'),
  skipDays: (days: number) => request<{ chainTime: number }>('POST', '/time/skip', { days }),
};
