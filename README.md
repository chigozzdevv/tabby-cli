# Tabby

Tabby is an overcollateralized `USDT0` credit rail on Plasma for humans and OpenClaw agents.

Borrowers open reusable vaults, lock supported collateral, and borrow `USDT0`. Liquidity providers supply `USDT0` to the pool and earn yield from borrower interest. Agent wallets can operate human-owned vaults through explicit onchain operator permissions.

## What it does

- Borrow `USDT0` against approved collateral.
- Bind agent wallets to human-owned vaults as vault operators.
- Supply `USDT0` to the lending pool and earn native pool yield.
- Monitor vault health, borrowing capacity, and protocol activity through the server and skill.

## Repository layout

- `contracts/` core protocol contracts: `DebtPool`, `VaultManager`, `MarketConfig`, `ChainlinkPriceOracle`, `Treasury`, and deployment scripts.
- `server/` Fastify API for public config, market/vault monitoring, activity indexing, liquidity snapshots, and assistant-style quote/binding flows.
- `skills/` OpenClaw skills, including `skills/tabby-borrower/` for wallet, vault, and operator workflows.
- `client/` web app for landing, LP access, and operator/borrower UX.

## Integrations

- Plasma for settlement and execution.
- `USDT0` as the single debt and LP asset.
- `WETH` and `XAUt0` as the current live collateral set.
- Chainlink for oracle pricing and stale-feed protection.
- OpenClaw for agent skill execution and recurring monitoring.
- Fastify + MongoDB for the API and indexed activity layer.
- Foundry for Solidity build, test, and deployment.

## Architecture

### Onchain

- `DebtPool`
  - single `USDT0` pool for LP deposits and borrower liquidity.
  - LP shares accrue value as interest is paid.
- `VaultManager`
  - reusable borrower vaults.
  - collateral deposit, borrow, repay, withdraw, liquidation, and operator binding.
- `MarketConfig`
  - collateral parameters, debt caps, rate model, pause flags, and market-level controls.
- `ChainlinkPriceOracle`
  - feed mapping and alias support for approved assets.
- Governance stack
  - timelock governance.
  - treasury, emergency, and risk roles.

### Offchain

- `server/`
  - public protocol config.
  - market and vault monitoring.
  - pool snapshots and LP position reads.
  - activity indexing for deposits, borrows, repayments, liquidations, and operator updates.
  - assistant endpoints for preflight borrow quotes and operator-binding preparation.
- `skills/tabby-borrower/`
  - local wallet creation.
  - vault operations.
  - operator binding flows.
  - health monitoring and notifications.

## Core flows

### Human borrower

1. Connect or create a wallet.
2. Quote borrowing power from intended collateral.
3. Open a vault.
4. Deposit collateral.
5. Optionally bind an agent wallet as operator.
6. Borrow `USDT0`.
7. Monitor health factor and repay or top up collateral as needed.

### Agent borrower

1. Initialize the `tabby-borrower` skill wallet.
2. Read live market config and quote borrow capacity.
3. Open a vault owned by the skill wallet, or bind the skill wallet to a human-owned vault.
4. Deposit collateral and borrow `USDT0`.
5. Monitor vault health and execute repay / collateral-management actions.

### Liquidity provider

1. Deposit `USDT0` into `DebtPool`.
2. Receive internal pool shares.
3. Earn lending yield as borrower interest accrues.
4. Withdraw `USDT0` by burning shares, subject to available liquidity.

## Monitoring and API surface

Public endpoints:

- `GET /public/config`
- `GET /public/monitoring/market`
- `GET /public/monitoring/vaults?owner=:address`
- `GET /public/monitoring/vaults/:vaultId`
- `GET /public/activity`
- `GET /liquidity/pool`
- `GET /liquidity/position?account=:address`
- `GET /liquidity/quote/deposit?assetsWei=:wei`
- `GET /liquidity/quote/withdraw?shares=:shares`

Assistant endpoints:

- `POST /assistant/sessions`
- `GET /assistant/sessions/:sessionId`
- `POST /assistant/sessions/:sessionId/messages`
- `POST /assistant/quotes/preflight`
- `POST /assistant/bindings/operator-wallet`
- `POST /assistant/bindings/prepare`
- `POST /assistant/bindings/confirm`

## Deployment

Current live deployment is on Plasma mainnet.

- RPC: `https://rpc.plasma.to`
- Public API: `http://localhost:3000` in local development

### Core contracts

| Component | Address |
| --- | --- |
| `TimelockController` | `0xf33e2d7d633e722a24045171985c84c9fec3203f` |
| `Treasury` | `0x3c4938bca1fb7305113c1615c8f80e5a98151a34` |
| `ChainlinkPriceOracle` | `0x79ffe24187968c3302e4f19c7051d20a61fb3bc3` |
| `MarketConfig` | `0x6eedc0adc27c97da39add56a86f254761d523e64` |
| `DebtPool` | `0xbf48a0c38bcda0c8a0b3611d397cb68bfd31dc90` |
| `VaultManager` | `0x6287799a8f21b3395ebcb673c32440e47e9de45e` |

### Assets

- `USDT0` debt asset: `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb`
- `WETH` collateral: `0x9895D81bB462A195b4922ED7De0e3ACD007c32CB`
- `XAUt0` collateral: `0x1B64B9025EEbb9A6239575dF9Ea4b9Ac46D4d193`

### Oracle feeds

- `USDT0/USD`: `0x3205B49b3C8c5D593589e1e70567993f72C5F845`
- `ETH/USD`: `0x43A7dd2125266c5c4c26EB86cd61241132426Fe7`
- `XAUT/USD`: `0x354Df1ca4AE838A45405B3486ED0161AA7f01191`

`BTC/USD` is oracle-ready on Plasma, but BTC collateral is not enabled in the current live config until a canonical Plasma BTC token is finalized.

## Requirements

- Node.js 18+
- Foundry
- MongoDB

## Local development

### Contracts

```bash
cd contracts
forge test
```

### Server

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

### Borrower skill

```bash
cd skills/tabby-borrower
npm install
npm run build
cp .env.example .env

node dist/bin/tabby-borrower.js init-wallet
node dist/bin/tabby-borrower.js market
node dist/bin/tabby-borrower.js quote-borrow \
  --collateral 0x9895D81bB462A195b4922ED7De0e3ACD007c32CB:1 \
  --desired-borrow 500
node dist/bin/tabby-borrower.js open-vault
```

For recurring monitoring, use the included OpenClaw cron job:

```json
{
  "cron": {
    "jobs": [
      {
        "id": "tabby-vault-monitor",
        "schedule": "*/5 * * * *",
        "command": "cd /path/to/skills/tabby-borrower && node dist/bin/tabby-borrower.js monitor-vaults --quiet-ok",
        "enabled": true
      }
    ]
  }
}
```

### Client

```bash
cd client
npm install
npm run dev
```

## Deploying contracts

Deploy script:

- `contracts/script/DeployProtocol.s.sol`

Dry run:

```bash
cd contracts
forge script script/DeployProtocol.s.sol:DeployProtocol \
  --rpc-url https://rpc.plasma.to --sig "run()" -vvv
```

Broadcast:

```bash
cd contracts
forge script script/DeployProtocol.s.sol:DeployProtocol \
  --rpc-url https://rpc.plasma.to --broadcast --sig "run()"
```

Use `contracts/.env.example` as the source of truth for deployment configuration.
