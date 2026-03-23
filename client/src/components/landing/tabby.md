# TABBY

Tabby is a Plasma borrowing and LP protocol.

- debt asset: `USDT0`
- supported collateral: `WETH`, `XAUt0`, `wstETH`, `WXPL`
- borrower runtime: `tabby-borrower`
- LP runtime: `tabby-lp`
- user-owned vaults can bind the borrower skill wallet as operator

## Repo

```bash
git clone https://github.com/chigozzdevv/tabby-cli.git
cd tabby-cli
```

Repo layout:

- `contracts/` -> Solidity contracts and deploy scripts
- `server/` -> Fastify API and assistant routes
- `client/` -> React web app
- `skills/` -> borrower and LP CLIs

## Install And Build

### Server

```bash
cd server
cp .env.example .env
npm install
npm run build
```

For local dev:

```bash
npm run dev
```

For production:

```bash
npm start
```

Minimum `server/.env`:

```bash
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=tabby
RPC_URL=https://rpc.plasma.to
CHAIN_ID=9745
TIMELOCK_ADDRESS=0x648443185a261ff713d7347a8228e89da446a565
TREASURY_ADDRESS=0x6e3fae03b2150ab01f31cdf3f1fce7d7249faefb
PRICE_ORACLE_ADDRESS=0x90604513f086c5e0d3175cb62ee37314dbc0f49b
MARKET_CONFIG_ADDRESS=0xbad47d072b0632ac7883b0a03a655fecf941b412
DEBT_POOL_ADDRESS=0x7b57dda1e5ed2fcafb7b811cfa6bcf248f398d4f
VAULT_MANAGER_ADDRESS=0x25633ccac9a35302f6536547ae5a532c1744cbaa
DEBT_ASSET_ADDRESS=0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb
COLLATERAL_ASSETS=0x9895D81bB462A195b4922ED7De0e3ACD007c32CB,0x1B64B9025EEbb9A6239575dF9Ea4b9Ac46D4d193,0xe48D935e6C9e735463ccCf29a7F11e32bC09136E,0x6100E367285b01F48D07953803A2d8dCA5D19873
ACTIVITY_SYNC_ENABLED=true
ACTIVITY_START_BLOCK=17369848
```

### Client

```bash
cd client
npm install
npm run build
```

For local dev:

```bash
npm run dev
```

Minimum client env:

```bash
VITE_TABBY_API_BASE_URL=http://localhost:3000
VITE_OPENCLAW_GATEWAY_URL=ws://localhost:18789
VITE_OPENCLAW_TOKEN=<token>
```

### Skills

```bash
cd skills
npm install
npm run build
```

Minimum `skills/.env`:

```bash
TABBY_API_BASE_URL=http://127.0.0.1:3000
CHAIN_ID=9745
RPC_URL=https://rpc.plasma.to
MARKET_CONFIG_ADDRESS=0xbad47d072b0632ac7883b0a03a655fecf941b412
DEBT_POOL_ADDRESS=0x7b57dda1e5ed2fcafb7b811cfa6bcf248f398d4f
VAULT_MANAGER_ADDRESS=0x25633ccac9a35302f6536547ae5a532c1744cbaa
DEBT_ASSET_ADDRESS=0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb
COLLATERAL_ASSETS=0x9895D81bB462A195b4922ED7De0e3ACD007c32CB,0x1B64B9025EEbb9A6239575dF9Ea4b9Ac46D4d193,0xe48D935e6C9e735463ccCf29a7F11e32bC09136E,0x6100E367285b01F48D07953803A2d8dCA5D19873
```

## Wrapper Setup

Tabby skills should run through stable wrapper paths, not `cd ... && node ...`.

Borrower wrapper:

```bash
mkdir -p /home/tabby/bin
nano /home/tabby/bin/tabby-borrower.sh
```

```bash
#!/usr/bin/env bash
set -euo pipefail
export TABBY_API_BASE_URL="http://127.0.0.1:3000"
cd /home/tabby/tabby-cli/skills
exec node dist/tabby-borrower/bin/tabby-borrower.js "$@"
```

```bash
chmod +x /home/tabby/bin/tabby-borrower.sh
```

LP wrapper:

```bash
nano /home/tabby/bin/tabby-lp.sh
```

```bash
#!/usr/bin/env bash
set -euo pipefail
export TABBY_API_BASE_URL="http://127.0.0.1:3000"
cd /home/tabby/tabby-cli/skills
exec node dist/tabby-lp/bin/tabby-lp.js "$@"
```

```bash
chmod +x /home/tabby/bin/tabby-lp.sh
```

## OpenClaw Gateway

Allowlist the wrappers so borrower and LP commands run without permission prompts.

```bash
openclaw approvals allowlist add --gateway --agent "*" "/home/tabby/bin/tabby-borrower.sh"
openclaw approvals allowlist add --gateway --agent "*" "/home/tabby/bin/tabby-lp.sh"
```

Set gateway defaults to allowlist mode:

```json
{
  "version": 1,
  "defaults": {
    "security": "allowlist",
    "ask": "off",
    "askFallback": "deny",
    "autoAllowSkills": false
  }
}
```

Apply it:

```bash
openclaw approvals set --gateway --file /home/tabby/exec-approvals.json
openclaw gateway restart
```

## Borrower Skill

All borrower commands should use:

```bash
/home/tabby/bin/tabby-borrower.sh <command>
```

Initialize wallet:

```bash
/home/tabby/bin/tabby-borrower.sh init-wallet
```

Read market:

```bash
/home/tabby/bin/tabby-borrower.sh market
```

Quote borrow power:

```bash
/home/tabby/bin/tabby-borrower.sh quote-borrow --collateral WXPL:2
/home/tabby/bin/tabby-borrower.sh quote-borrow --collateral WETH:1.25 --desired-borrow 500
```

Agent-owned vault flow:

```bash
/home/tabby/bin/tabby-borrower.sh open-vault
/home/tabby/bin/tabby-borrower.sh approve-collateral --asset 0x6100E367285b01F48D07953803A2d8dCA5D19873 --amount 2
/home/tabby/bin/tabby-borrower.sh deposit-collateral --vault-id 1 --asset 0x6100E367285b01F48D07953803A2d8dCA5D19873 --amount 2
/home/tabby/bin/tabby-borrower.sh borrow --vault-id 1 --amount 0.05
/home/tabby/bin/tabby-borrower.sh vault-status --vault-id 1
/home/tabby/bin/tabby-borrower.sh repay --vault-id 1 --amount 0.01
/home/tabby/bin/tabby-borrower.sh withdraw-collateral --vault-id 1 --asset 0x6100E367285b01F48D07953803A2d8dCA5D19873 --amount 0.5
```

Owner-wallet operator flow:

```bash
/home/tabby/bin/tabby-borrower.sh prepare-bind-operator --vault-id 1
/home/tabby/bin/tabby-borrower.sh confirm-bind-operator --vault-id 1
```

Monitoring:

```bash
/home/tabby/bin/tabby-borrower.sh monitor-vaults --quiet-ok
```

Liquidation:

```bash
/home/tabby/bin/tabby-borrower.sh liquidate --vault-id 1 --amount 0.01 --asset 0x6100E367285b01F48D07953803A2d8dCA5D19873
```

## LP Skill

All LP commands should use:

```bash
/home/tabby/bin/tabby-lp.sh <command>
```

Initialize wallet:

```bash
/home/tabby/bin/tabby-lp.sh init-wallet
```

Pool reads:

```bash
/home/tabby/bin/tabby-lp.sh pool-status --json
/home/tabby/bin/tabby-lp.sh position --json
```

Provide liquidity:

```bash
/home/tabby/bin/tabby-lp.sh approve-asset --amount 0.25
/home/tabby/bin/tabby-lp.sh deposit-liquidity --amount 0.25
```

Withdraw liquidity:

```bash
/home/tabby/bin/tabby-lp.sh withdraw-liquidity --amount 0.05
/home/tabby/bin/tabby-lp.sh withdraw-liquidity --all
```

Monitoring:

```bash
/home/tabby/bin/tabby-lp.sh monitor-pool
```

## Human Wallet Borrow Flow

This is the intended web flow for a user-owned wallet:

1. User asks for a quote.
2. Quote card computes the real borrowable amount.
3. User clicks borrow.
4. Browser wallet signs:
   - `openVault()` if no vault exists
   - collateral `approve(...)`
   - `depositCollateral(...)`
   - `setVaultOperator(vaultId, operator, true)`
5. After binding succeeds, the agent runs `borrow`.

This keeps the human wallet as vault owner while the borrower skill wallet acts as operator afterward.

## Current Live Plasma Deployment

Core contracts:

- `TimelockController`: `0x648443185a261ff713d7347a8228e89da446a565`
- `Treasury`: `0x6e3fae03b2150ab01f31cdf3f1fce7d7249faefb`
- `ChainlinkPriceOracle`: `0x90604513f086c5e0d3175cb62ee37314dbc0f49b`
- `MarketConfig`: `0xbad47d072b0632ac7883b0a03a655fecf941b412`
- `DebtPool`: `0x7b57dda1e5ed2fcafb7b811cfa6bcf248f398d4f`
- `VaultManager`: `0x25633ccac9a35302f6536547ae5a532c1744cbaa`

Assets:

- `USDT0`: `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb`
- `WETH`: `0x9895D81bB462A195b4922ED7De0e3ACD007c32CB`
- `XAUt0`: `0x1B64B9025EEbb9A6239575dF9Ea4b9Ac46D4d193`
- `wstETH`: `0xe48D935e6C9e735463ccCf29a7F11e32bC09136E`
- `WXPL`: `0x6100E367285b01F48D07953803A2d8dCA5D19873`

Current test-market policy:

- debt asset: `USDT0`
- `minBorrowAmount = 1000` -> `0.001 USDT0`
- `minDebtAmount = 1000` -> `0.001 USDT0`
- `debtCap = 0` -> uncapped

Collateral policy:

- `WETH`: `70%` borrow LTV, `77.5%` liquidation threshold
- `wstETH`: `70%` borrow LTV, `77.5%` liquidation threshold
- `XAUt0`: `55%` borrow LTV, `65%` liquidation threshold
- `WXPL`: `45%` borrow LTV, `55%` liquidation threshold

## Quick Checks

Server:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/public/config
curl http://127.0.0.1:3000/public/monitoring/market
```

Borrow quote:

```bash
/home/tabby/bin/tabby-borrower.sh quote-borrow --collateral WXPL:2
```

LP state:

```bash
/home/tabby/bin/tabby-lp.sh pool-status --json
```

## Notes

- There is no due date on Tabby borrows.
- Interest accrues until the debt is repaid or the vault is liquidated.
- LP deposits add `USDT0` liquidity to `DebtPool`.
- Borrow capacity is limited by collateral value, risk params, pool liquidity, and any applicable caps.
- If `quote-borrow` succeeds, use that result instead of manual estimates.
