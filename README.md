# Tabby

Tabby is a permissionless, overcollateralized USDT0 lending protocol on Plasma for borrowers, LPs, and autonomous agents.

Borrowers open reusable vaults, lock `WETH`, `wstETH`, `XAUt0`, or `WXPL` as collateral, and borrow `USDT0` through perpetual overcollateralized positions with no fixed due date. Liquidity providers supply `USDT0` to `DebtPool` and earn yield through pool shares. Agents can either borrow from their own vaults or operate human-owned vaults through explicit onchain permissions.

## Demo

- Video Demo: [https://youtu.be/frlohQT-7is](https://youtu.be/frlohQT-7is)
- Try Live: [https://tabby-bot.vercel.app/](https://tabby-bot.vercel.app/)

## Overview

Tabby has a single debt asset, a single liquidity pool, and reusable borrower vaults.

- Borrowers open vaults, deposit supported collateral, and borrow `USDT0`
- LPs deposit `USDT0` into `DebtPool` and receive pool shares that accrue value as borrower interest is paid
- Agents can borrow from agent-owned vaults or operate human-owned vaults after the owner binds them as an operator
- The offchain stack adds monitoring, quoting, activity indexing, and assistant workflows on top of the contracts

## Who Tabby Is For

### Human borrowers

Use the web app to:

- connect a wallet
- inspect vault and LP positions
- monitor live protocol activity
- chat with Tabby through OpenClaw
- execute supported borrower and LP workflows through the chat runtime
- manage vault risk over time

### Autonomous agents

Use the Tabby skills to:

- create or load a local agent wallet
- read live market parameters
- quote borrow capacity
- open and manage agent-owned vaults
- borrow, repay, and manage collateral and loan health
- bind to a human-owned vault and act as its operator

### Liquidity providers

Use the pool APIs or LP skill to:

- inspect pool state
- deposit `USDT0`
- monitor yield and utilization
- withdraw liquidity when desired

## How The System Works

### Onchain

- `DebtPool`
  - Single `USDT0` pool for LP liquidity and borrower debt
  - LP shares accrue value as borrowers pay interest
- `VaultManager`
  - Creates and manages reusable borrower vaults
  - Handles collateral deposits, borrowing, repayments, withdrawals, liquidations, and operator bindings
- `MarketConfig`
  - Stores collateral risk parameters, caps, pause flags, and rate model config
- `ChainlinkPriceOracle`
  - Resolves price feeds for supported assets
- Governance / treasury layer
  - Timelock, treasury, and privileged risk roles

### Offchain

- `server/`
  - Fastify API
  - protocol config and market reads
  - vault and LP monitoring
  - activity indexing into MongoDB
  - assistant endpoints for quote and operator-binding flows
- `client/`
  - React/Vite web app
  - human mode for dashboard + assistant UX
  - agent mode for borrower/operator skill handoff and operational instructions
- `skills/`
  - `tabby-borrower` for agent borrower and operator workflows
  - `tabby-lp` for liquidity workflows
  - local wallet persistence and recurring monitoring

## Main User Flows

### Human borrower flow

1. Create or connect a wallet
2. Choose collateral
3. Quote borrowing power
4. Open a vault
5. Deposit collateral
6. Borrow `USDT0`
7. Monitor health factor and repay or top up when needed

### Agent borrower / operator flow

1. Initialize a Tabby skill wallet
2. Read market config and quote capacity
3. Either open and fund an agent-owned vault or bind to a human-owned vault
4. Borrow, repay, manage collateral, and monitor loan health
5. For delegated vaults, act within the owner's permissions

### LP flow

1. Deposit `USDT0` into `DebtPool`
2. Receive pool shares
3. Earn yield as borrowers pay interest
4. Withdraw by redeeming shares, subject to pool liquidity

## Repository Map

| Path | Purpose |
| --- | --- |
| `contracts/` | Solidity contracts, tests, and deployment scripts |
| `server/` | Fastify API, websocket server, activity sync, assistant routes |
| `client/` | React frontend for human and agent entry points |
| `skills/` | CLI skills for agent borrowers, operators, and LPs |

## Supported Assets

- Debt / LP asset: `USDT0`
- Current collateral set: `WETH`, `XAUt0`, `wstETH`, `WXPL`

## API Surface

### Public routes

- `GET /health`
- `GET /public/config`
- `GET /public/monitoring/market`
- `GET /public/monitoring/vaults?owner=:address`
- `GET /public/monitoring/vaults/:vaultId`
- `GET /public/activity`
- `GET /liquidity/pool`
- `GET /liquidity/position?account=:address`
- `GET /liquidity/quote/deposit?assetsWei=:wei`
- `GET /liquidity/quote/withdraw?shares=:shares`

### Assistant routes

- `POST /assistant/sessions`
- `GET /assistant/sessions/:sessionId`
- `POST /assistant/sessions/:sessionId/messages`
- `POST /assistant/quotes/preflight`
- `POST /assistant/bindings/operator-wallet`
- `POST /assistant/bindings/prepare`
- `POST /assistant/bindings/confirm`

### Auth note

The public routes above can be called without auth.

For local development or protected environments, authenticated routes can be gated with a dev token. Send:

- `X-Dev-Auth: <your token>`

Authenticated routes include `/monitoring/*`, `/activity`, and `/auth/me`.

## Local Development

### Prerequisites

- Node.js 18+
- npm
- Foundry
- MongoDB
- Optional: a local OpenClaw gateway if you want the assistant UI to work end-to-end

### 1. Start the server

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Minimum things to verify in `server/.env`:

- `PORT`
- `MONGODB_URI`
- `MONGODB_DB`
- `RPC_URL`
- `CHAIN_ID`
- protocol contract addresses
- auth configuration: `DEV_AUTH_TOKEN` if you are protecting local routes

### 2. Start the client

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Client envs:

- `VITE_TABBY_API_BASE_URL=http://localhost:3000`
- `VITE_OPENCLAW_GATEWAY_URL`
- `VITE_OPENCLAW_TOKEN`

For the websocket URL you have two workable local patterns:

- direct gateway: `ws://localhost:18789`
- through the Tabby server proxy: `ws://localhost:3000/gateway`

If you do not have OpenClaw running locally, the dashboard can still load, but the assistant chat will stay offline.

### 3. Run the contracts tests

```bash
cd contracts
cp .env.example .env
forge test
```

### 4. Build and use the skills

```bash
cd skills
npm install
npm run build
```

Create `skills/.env` with at least:

```bash
TABBY_API_BASE_URL=http://localhost:3000
CHAIN_ID=9745
RPC_URL=https://rpc.plasma.to
VAULT_MANAGER_ADDRESS=0x...
DEBT_POOL_ADDRESS=0x...
MARKET_CONFIG_ADDRESS=0x...
DEBT_ASSET_ADDRESS=0x...
COLLATERAL_ASSETS=0x...,0x...,0x...,0x...
```

Borrower examples:

```bash
cd skills
node dist/tabby-borrower/bin/tabby-borrower.js init-wallet
node dist/tabby-borrower/bin/tabby-borrower.js market
node dist/tabby-borrower/bin/tabby-borrower.js quote-borrow --collateral WETH:1.25 --desired-borrow 500
node dist/tabby-borrower/bin/tabby-borrower.js open-vault
node dist/tabby-borrower/bin/tabby-borrower.js vault-status --vault-id 1
```

LP examples:

```bash
cd skills
node dist/tabby-lp/bin/tabby-lp.js init-wallet
node dist/tabby-lp/bin/tabby-lp.js pool-status
node dist/tabby-lp/bin/tabby-lp.js deposit-liquidity --amount 100
node dist/tabby-lp/bin/tabby-lp.js withdraw-liquidity --all
```

## WDK Usage

Tabby skills use WDK for local agent wallet management on Plasma.

- `@tetherto/wdk` is used for seed phrase generation and wallet bootstrapping
- `@tetherto/wdk-wallet-evm` provides the Plasma EVM wallet integration layer
- borrower and LP wallets are stored locally under `~/.config/tabby-borrower/` and `~/.config/tabby-lp/`
- the skills derive wallet clients from the stored seed phrase and use them for protocol actions

## First Smoke Test

Once the server and client are running:

1. Check server health:

```bash
curl http://localhost:3000/health
```

2. Check protocol config:

```bash
curl http://localhost:3000/public/config
```

3. Open the client and confirm:

- the landing screen appears
- human mode loads
- server status shows online
- wallet connection works
- positions load for a wallet with existing vault or LP activity

4. If OpenClaw is running, confirm the chat connects and can answer a simple protocol question.

## Live Plasma Deployment

Current network target:

- Chain: Plasma mainnet
- RPC: `https://rpc.plasma.to`

### Core contracts

| Component | Address |
| --- | --- |
| `TimelockController` | `0x648443185a261ff713d7347a8228e89da446a565` |
| `Treasury` | `0x6e3fae03b2150ab01f31cdf3f1fce7d7249faefb` |
| `ChainlinkPriceOracle` | `0x90604513f086c5e0d3175cb62ee37314dbc0f49b` |
| `MarketConfig` | `0xbad47d072b0632ac7883b0a03a655fecf941b412` |
| `DebtPool` | `0x7b57dda1e5ed2fcafb7b811cfa6bcf248f398d4f` |
| `VaultManager` | `0x25633ccac9a35302f6536547ae5a532c1744cbaa` |

### Assets

- `USDT0`: `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb`
- `WETH`: `0x9895D81bB462A195b4922ED7De0e3ACD007c32CB`
- `XAUt0`: `0x1B64B9025EEbb9A6239575dF9Ea4b9Ac46D4d193`
- `wstETH`: `0xe48D935e6C9e735463ccCf29a7F11e32bC09136E`
- `WXPL`: `0x6100E367285b01F48D07953803A2d8dCA5D19873`

### Oracle feeds

- `USDT0/USD`: `0x3205B49b3C8c5D593589e1e70567993f72C5F845`
- `ETH/USD`: `0x43A7dd2125266c5c4c26EB86cd61241132426Fe7`
- `XAUT/USD`: `0x354Df1ca4AE838A45405B3486ED0161AA7f01191`
- `wstETH` priced via ETH/USD (aliased to WETH for conservative pricing)
- `XPL/USD`: `0xF932477C37715aE6657Ab884414Bd9876FE3f750`

## Deploying Contracts

Deployment script:

- `contracts/script/DeployProtocol.s.sol`

Dry run:

```bash
cd contracts
forge script script/DeployProtocol.s.sol:DeployProtocol \
  --rpc-url https://rpc.plasma.to \
  --sig "run()" \
  -vvv
```

Broadcast:

```bash
cd contracts
forge script script/DeployProtocol.s.sol:DeployProtocol \
  --rpc-url https://rpc.plasma.to \
  --broadcast \
  --sig "run()"
```

Use `contracts/.env.example` as the deployment config reference.
