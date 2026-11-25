# TonPass vesting testbed

Run the FamilyVesting flow end to end on a local Hardhat chain in a few minutes. An admin deploys a fake token and the vault, funds it, and adds a stakeholder with monthly steps. Time is skipped forward, and the stakeholder claims from MetaMask.

Local only. The keys below are Hardhat's public test keys. Never use them on a real network.

| Part | Where | Port |
|---|---|---|
| Contracts (`FamilyVesting`, `mocks/MockUSDT`) | `contracts/` | – |
| Hardhat node (chainId 31337) | `chain/` | 8545 |
| Backend (NestJS + ethers; signs with the node's unlocked accounts: #0 by default, any of #0–#19 via `as`) | `backend/` | 3001 |
| Frontend (React + wagmi): `/admin` and `/` (stakeholder) | `frontend/` | 30141 |

## Prerequisites

- Node 20+ and npm 10+
- MetaMask in your browser (only for the claim step)

## Start

```bash
npm install
npm run dev
```

`npm run dev` compiles `contracts/` first, then starts the chain, then the backend once the chain answers on 8545, and the frontend. Ctrl+C stops all three. The chain starts empty every time.

Each part on its own, in three terminals: `npm run chain`, `npm run backend`, `npm run frontend`. Run `npm run compile` before them.

## MetaMask setup (once)

1. **Add the network.** Settings → Networks → Add a network manually:
   - Network name: `Hardhat Local`
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency symbol: `ETH`
2. **Import the stakeholder account (Hardhat account #1).** Account menu → Add account → Import account, then paste:
   ```
   0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
   ```
   That's address `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`.

The admin is account #0 (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) by default. The backend signs through the Hardhat node's unlocked accounts, so no private key is configured, and you don't need the admin in MetaMask. Any write can be sent from another account with `as` (0–19).

## Test flow (5 steps)

Open http://localhost:30141/admin:

1. **Setup**: deploys MockUSDT and the vault, then calls `setToken(MockUSDT)` (the constructor sets the BSC mainnet token).
2. **Fund** 1200.
3. **Add plan** with the defaults: account #1, 1200 over 12 steps, every 30 days, first unlock in 30 days.
4. **Skip time**: +30 days, +30 days, +1 day. The row shows claimable 200.0 (2 steps).
5. Open http://localhost:30141/, click **Connect wallet** (MetaMask, account #1), then **Claim all** and confirm.
   - Balance 200.0, released 200.0, 2 / 12 steps.
   - The next release is step 3.
   - Skip +30 days on `/admin`: the page updates by itself, and **Claim** pays 100.0 more.

## The same flow with curl

```bash
B=localhost:3001; U=0x70997970C51812dc3A010C7d01b50e0d17dc79C8; J='content-type: application/json'
curl -s -X POST $B/setup
curl -s -X POST $B/fund -H "$J" -d '{"amount":"1200"}'
curl -s -X POST $B/stakeholders -H "$J" -d "{\"user\":\"$U\",\"totalAmount\":\"1200\",\"steps\":12,\"intervalDays\":30,\"firstUnlockInDays\":30}"
curl -s -X POST $B/time/skip -H "$J" -d '{"days":61}'
curl -s $B/stakeholders/$U | jq '{allocated,claimable,claimableSteps,totalSteps}'
# → {"allocated":"1200.0","claimable":"200.0","claimableSteps":2,"totalSteps":12}
curl -s $B/dashboard
# → {"allocated":"1200.0","claimed":"0.0","remaining":"1200.0","count":1,"vaultBalance":"1200.0"}
```

Claims can be sent from the stakeholder's wallet (step 5 above) or by the backend with `POST /claim { as }`.

### API

Every write takes an optional `as`: the Hardhat account index (0–19) that signs it. It defaults to 0 (the owner), or to 1 for `/claim`. Writes return `{ txHash }` unless noted.

| Method | Path | Body | Does |
|---|---|---|---|
| POST | `/setup` | – | Deploys MockUSDT(18) and FamilyVesting, then `setToken(mock)`. Returns the deployment. |
| GET | `/deployment` | – | `{ vault, deployBlock, mockTokens, token, owner, pendingOwner, paused }`; everything after `mockTokens` is read live from the vault. |
| POST | `/fund` | `{ amount, token? }` | Mints to the vault: the current token by default, or any token in `mockTokens`. Returns `{ vaultBalance }`. |
| POST | `/stakeholders` | `{ user, totalAmount, steps, intervalDays, firstUnlockInDays, as? }` | `replaceStakeholder` with even steps. For an existing user it replaces the whole plan; tokens they already claimed are **not** deducted. |
| POST | `/stakeholders/schedule` | `{ user, totalAmount, schedule: [{ unlockTime, amount }], as? }` | `replaceStakeholder` with the steps exactly as sent (zero amounts, 0x0 and bad orders reach the contract). |
| POST | `/stakeholders/preview` | same body as `POST /stakeholders` | Read-only: what that replace would do, with the contract's own formulas. Returns `{ exists, old, forfeited, newTotal, totalAllocatedAfter, outstandingAfter, vaultBalance, shortfall, pastClaimsNotDeducted, wouldRevert }`. `wouldRevert` is the custom error a send would hit (e.g. `InsufficientVaultBalance`), or null. |
| POST | `/stakeholders/schedule/preview` | same body as `POST /stakeholders/schedule` | Same preview for a custom schedule. |
| DELETE | `/stakeholders/:addr?as=N` | – | `removeStakeholder`. |
| POST | `/claim` | `{ as?, all? }` | `claim()` (next step), or `claimAll()` when `all` is true. |
| POST | `/pause`, `/unpause` | `{ as? }` | `pause` / `unpause`. |
| POST | `/emergency-withdraw` | `{ to, amount, as? }` | `emergencyWithdraw` (can take tokens still owed). `0` and 0x0 are allowed, to reach `ZeroAmount` / `ZeroAddress`. |
| POST | `/tokens` | – | Deploys another MockUSDT(18) and adds it to `mockTokens`. Returns `{ token }`. |
| POST | `/token` | `{ token, as? }` | `setToken`. A non-zero address with no code → 400 `NoCode`. |
| POST | `/ownership/transfer` | `{ newOwner, as? }` | `transferOwnership` (step 1 of 2). |
| POST | `/ownership/accept` | `{ as? }` | `acceptOwnership`, signed by the pending owner. |
| POST | `/ownership/renounce` | `{ as? }` | Always 400 `RenounceDisabled`. |
| GET | `/stakeholders` | – | |
| GET | `/stakeholders/:addr` | – | |
| GET | `/dashboard` | – | |
| GET | `/accounts` | – | The node's 20 accounts: `{ index, address, tokenBalance, isOwner, isPendingOwner, isStakeholder }`. |
| GET | `/events` | – | Every vault event since `deployBlock`, newest first: `{ block, time, txHash, name, args }`. Amounts are formatted; `*Step*` args stay numbers. |
| GET | `/vault-balances` | – | `[{ token, vaultBalance, current }]` for every mock token. A non-current token with a balance is stranded after `setToken`. |
| GET | `/time` | – | |
| POST | `/time/skip` | `{ days }` or `{ seconds }` | `evm_increaseTime` + mine. |
| POST | `/time/jump` | `{ user, offset?: -1\|0\|1, pin? }` | Moves to `user`'s next unlock + `offset` seconds. By default it mines a block there. `pin: true` only sets the next block's time, so the next *mined* tx lands on exactly that second (a revert caught before sending mines nothing and keeps the pin). Returns `{ chainTime, target, pinned }`. Errors: `NoNextUnlock`, `TimeInPast`. |

Amounts are decimal strings ("1200"); times are chain-time unix seconds. Errors look like `{ "error": "<Name>" }`: 400 for bad input or a contract revert (the name is the contract's custom error, e.g. `StepLocked`, `EnforcedPause`, `OwnableUnauthorizedAccount`), and 409 `NotDeployed` before `/setup`.

## Scenarios

### Scripted: `/scenarios`

http://localhost:30141/scenarios lists 12 scripted `replaceStakeholder` scenarios (new user, before/after claims, after completion, removed user, underfunded vault, invalid schedules, past unlocks, the exact unlock second, non-owner, paused vault, other users unaffected). **Run** runs one; **Run all** runs them one after another.

- Each run deploys its **own** token and vault, so the vault on `/admin` is never touched. Each step shows ✓/✗, its chain time and its events; a failing step shows expected vs actual.
- Runs share the chain clock: their time jumps move time forward for everything, including your plans on `/admin`.
- While a run is going, every admin write and time move returns `409 ScenarioBusy` (reads and previews still work).
- The same runs are in `npm test` (`backend/test/scenarios.e2e-spec.ts`). API: `GET /scenarios`, `POST /scenarios/:id/run`.

### Manual checklist (everything that isn't scripted)

All on http://localhost:30141/admin with **Act as #0** unless a line says otherwise. Each group starts with **Setup** (a fresh vault), then **Fund 1200**. "Add plan" means the plan editor's defaults (account #1, 1200 over 12 steps every 30 days) with **First unlock in (days)** as given. Errors appear as a toast `Name: hint`. Lines marked *curl* have no UI path, because the UI never offers that action.

**Remove**
- [ ] R1 · before any claim: Add plan (first unlock 30) → **Remove** on the #1 row; the confirm says "1200.0 unclaimed tokens…" → OK → the row is gone; Stats allocated 0.0; the event log shows `StakeholderRemoved forfeited=1200.0`.
- [ ] R2 · after a claim: Add plan (first unlock 0) → **Claim as #1** (released 100.0) → **Remove**; the confirm says "1100.0" → OK → Stats allocated 100.0, claimed 100.0, remaining 0.0.
- [ ] R3 · cancel: on any row, **Remove** → **Cancel** → nothing is sent and the row stays.
- [ ] R4 · unknown user (*curl*): `curl -s -X DELETE http://127.0.0.1:3001/stakeholders/0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` → `{"error":"NotStakeholder"}`.
- [ ] R5 · swap-and-pop order: Fund 3600 more (Fund amount 3600 → Fund) → Add plan for #1, then change **User** to #2 (`0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`) → Add plan, then #3 (`0x90F79bf6EB2c4f870365E785982E1f101E93b906`) → Add plan. The table order is #1, #2, #3 → Remove #1 → the order is now **#3, #2** (the last stakeholder moves into the removed slot).
- [ ] R6 · non-owner: **Act as #3** → Remove → `OwnableUnauthorizedAccount`.

**Claims** (Add plan, first unlock 30)
- [ ] C1 · **Claim as #1** → `StepLocked: the next step has not unlocked yet`.
- [ ] C2 · **Claim all as #1** → `NothingClaimable`.
- [ ] C3 · Skip **+30 days**, **+30 days**, **+1 day** → the row shows claimable 200.0 (2 steps) → **Claim as #1** → released 100.0, 1 / 12 → **Claim all as #1** → released 200.0, 2 / 12.
- [ ] C4 · exact unlock: on the #1 row pick **−1 s**, tick **pin**, **Jump** → Claim as #1 → `StepLocked` (nothing was mined; the pin stays) → pick **0**, keep **pin**, **Jump** → Claim as #1 → success, released 300.0, 3 / 12.
- [ ] C5 · VestingComplete: Setup → Fund 100 → **Custom**, one row (days 0, amount 100), Remove the other row → Add plan → **Claim as #1** → **Claim as #1** → `VestingComplete`; **Claim all as #1** → `NothingClaimable`; Jump is disabled ("No locked step left").
- [ ] C6 · not a stakeholder (*curl*): `curl -s -X POST http://127.0.0.1:3001/claim -H 'content-type: application/json' -d '{"as":5}'` → `{"error":"NotStakeholder"}`. On `/` with a wallet that has no plan: "This wallet has no vesting plan".

**Pause** (Add plan, first unlock 0)
- [ ] P1 · **Pause** → the Vault badge says Paused → **Claim as #1** → `EnforcedPause: the vault is paused`; http://localhost:30141/ shows "Vault is paused" with the claim buttons disabled.
- [ ] P2 · while paused, **Edit plan** on #1 → **Replace plan** → succeeds (admin writes still work).
- [ ] P3 · **Unpause** → Claim as #1 → success. The event log shows `Paused` and `Unpaused`.

**Emergency withdraw and refund** (Add plan, first unlock 0)
- [ ] E1 · Emergency withdraw **1200** to #0 → the Stats card shows the underfunded banner → **Claim as #1** → `ERC20InsufficientBalance` → **Fund 1200** → Claim as #1 → success.
- [ ] E2 · Withdraw amount **0** → `ZeroAmount`; withdraw 1 to `0x0000000000000000000000000000000000000000` → `ZeroAddress`.
- [ ] E3 · **Act as #3** → Withdraw → `OwnableUnauthorizedAccount`.

**Token switch** (continue from E1, so the vault holds 1100 of the first token and #1 has a plan)
- [ ] T1 · **Deploy mock token** → put it in **New token** (it's suggested in the field) → **Set token** → `ActivePlans` (tokens are still owed).
- [ ] T2 · **Set token** `0x000000000000000000000000000000000000dEaD` → `NoCode`.
- [ ] T3 · Remove #1 → Set token to the new mock → success; the event log shows `TokenUpdated`; Vault balances: the first token 1100.0 **stranded**, the new one 0.0 **current**. **Fund 7** → the new token shows 7.0; **Fund token** = the first token, Fund 1 → the first token shows 1101.0.

**Ownership**
- [ ] O1 · **Transfer** (new owner #2) → Pending owner `#2 …` and the hint "To accept, switch Act as to the pending owner." → **Act as #2** → **Accept** appears → Accept → Owner `#2 …`, Pending owner none; the event log shows `OwnershipTransferStarted` then `OwnershipTransferred`.
- [ ] O2 · **Act as #0** → Pause → `OwnableUnauthorizedAccount` (#0 isn't the owner any more); Act as #2 → Pause → success.
- [ ] O3 · **Renounce** (any Act as) → `RenounceDisabled`.
- [ ] O4 · accept by someone who isn't pending (*curl*): `curl -s -X POST http://127.0.0.1:3001/ownership/accept -H 'content-type: application/json' -d '{"as":3}'` → `{"error":"OwnableUnauthorizedAccount"}`.

## Tests

```bash
npm run test
```

This compiles `contracts/`, then runs the backend unit tests, the backend e2e test and the frontend Vitest tests. The e2e test starts its own Hardhat node on port 8546, so it doesn't need `npm run dev` and doesn't touch your dev chain on 8545.

## Reset

1. **Restart the chain.** Ctrl+C, then `npm run dev` again. The chain starts empty, and the backend notices that the old vault is gone (`NotDeployed`).
2. **Clear MetaMask's activity data.** Settings → Advanced → **Clear activity tab data**, with Hardhat Local selected.
   - MetaMask remembers the old chain's nonces.
   - If you skip this, txs fail with a nonce mismatch ("Nonce too high" / "nonce has already been used").
3. **Click Setup again** on `/admin`, then Fund and Add stakeholder.

## Working on the contract

The sources live in `contracts/`. `npm run compile` runs `hardhat compile` (solc 0.8.28, optimizer 200, evm `paris`, config in `chain/hardhat.config.ts`). It then writes each contract's ABI and bytecode to `shared/artifacts/<ContractName>.json`, which is where the backend and frontend read them. `shared/artifacts/` and `chain/artifacts/` are generated and not committed.

After you edit a contract:

1. Stop `npm run dev` and start it again. It recompiles, and the backend reads the new ABI when it starts.
2. Click **Setup** on `/admin`, then Fund and Add stakeholder. The old vault holds the old code.
3. If you changed a function the backend or frontend calls, update `backend/src/vesting/vesting.service.ts` or `frontend/src/stakeholder/`.

A compile error shows up in the terminal, and the chain, backend and frontend don't start.

## Gotchas

- **Use the page's chain clock.** Skip time moves the chain clock (`evm_increaseTime`), not your computer's. Every "now" on the pages is the latest block's timestamp. Unlock dates can be months or years ahead of today's real date.
- **MetaMask caches.** MetaMask caches block time and balances, and refreshes only when a new block arrives. If a balance looks stale, mine a block (`/time/skip` with `{ "seconds": 1 }`) or switch networks and back.
- **"The requested method and/or account has not been authorized by the user"** when claiming. MetaMask hasn't connected this account or network to `localhost:30141`. Open the connected-site icon in MetaMask and enable both the account and **Hardhat Local**. Or disconnect the site, switch MetaMask to Hardhat Local, and click **Connect wallet** again.
- **A custom stakeholder address needs gas.** Only the 20 built-in Hardhat accounts start with ETH. To claim from your own address, give it test ETH first. This is lost when the chain restarts.
  ```bash
  A=0xYourAddress
  curl -s -X POST 127.0.0.1:8545 -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"hardhat_setBalance\",\"params\":[\"$A\",\"0x56BC75E2D63100000\"]}"   # 100 ETH
  curl -s -X POST 127.0.0.1:8545 -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"evm_mine","params":[]}'   # so MetaMask refreshes
  ```
- **The Hardhat keys are public and local only.** The backend refuses to start unless `RPC_URL` is `localhost` or `127.0.0.1`. Never send real funds to these addresses or reuse the keys on any real network.
- **One admin tab at a time.** Two `/admin` tabs (or a tab plus curl) share the same backend and chain, so their actions add up (e.g. two Fund clicks = 2400).
