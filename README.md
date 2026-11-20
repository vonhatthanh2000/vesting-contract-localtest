# TonPass vesting testbed

Run the MultiVesting flow end to end on a local Hardhat chain in a few minutes. An admin deploys a fake token and the vault, funds it, and adds a stakeholder with monthly steps. Time is skipped forward, and the stakeholder claims from MetaMask.

Local only. The keys below are Hardhat's public test keys. Never use them on a real network.

| Part | Where | Port |
|---|---|---|
| Hardhat node (chainId 31337) | `chain/` | 8545 |
| Backend (NestJS + ethers, signs admin txs with account #0) | `backend/` | 3001 |
| Frontend (React + wagmi): `/admin` and `/` (stakeholder) | `frontend/` | 30141 |

## Prerequisites

- Node 20+ and npm 10+
- MetaMask in your browser (only for the claim step)

## Start

```bash
npm install
npm run dev
```

`npm run dev` starts the chain, then the backend once the chain answers on 8545, and the frontend. Ctrl+C stops all three. The chain starts empty every time.

Each part on its own, in three terminals: `npm run chain`, `npm run backend`, `npm run frontend`.

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

The admin (account #0, `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) lives only in the backend. You don't need it in MetaMask.

## Test flow (5 steps)

Open http://localhost:30141/admin:

1. **Setup**: deploys MockUSDT and the vault.
2. **Fund** 1200.
3. **Add stakeholder** with the defaults: account #1, 1200 over 12 steps, every 30 days, first unlock in 30 days.
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

Claiming is done by the stakeholder's wallet (step 5 above), not by the backend.

### API

| Method | Path | Body |
|---|---|---|
| POST | `/setup` | – |
| GET | `/deployment` | – |
| POST | `/fund` | `{ amount }` |
| POST | `/stakeholders` | `{ user, totalAmount, steps, intervalDays, firstUnlockInDays }` |
| GET | `/stakeholders` | – |
| GET | `/stakeholders/:addr` | – |
| GET | `/dashboard` | – |
| GET | `/time` | – |
| POST | `/time/skip` | `{ days }` or `{ seconds }` |

Amounts are decimal strings ("1200"). Errors look like `{ "error": "<Name>" }`: 400 for bad input or a contract revert, 409 `NotDeployed` before `/setup`.

## Tests

```bash
npm run test
```

This runs the backend unit tests, the backend e2e test and the frontend Vitest tests. The e2e test starts its own Hardhat node on port 8546, so it doesn't need `npm run dev` and doesn't touch your dev chain on 8545.

## Reset

1. **Restart the chain.** Ctrl+C, then `npm run dev` again. The chain starts empty, and the backend notices that the old vault is gone (`NotDeployed`).
2. **Clear MetaMask's activity data.** Settings → Advanced → **Clear activity tab data**, with Hardhat Local selected.
   - MetaMask remembers the old chain's nonces.
   - If you skip this, txs fail with a nonce mismatch ("Nonce too high" / "nonce has already been used").
3. **Click Setup again** on `/admin`, then Fund and Add stakeholder.

## Updating the contract

1. Recompile in the contract repo: `cd ../tonpass-smartcontract/bsc && npx hardhat compile`.
2. Copy the new artifacts here: `./scripts/sync-artifacts.sh`.
3. Restart `npm run dev`, then click Setup. The ABIs are read when the backend and frontend start.
4. Commit the updated `shared/artifacts/*.json` so the testbed runs without the other repo.

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
