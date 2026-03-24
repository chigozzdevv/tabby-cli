---
name: tabby
version: 1.0.0
description: Overcollateralized borrowing and LP protocol on Plasma. Borrow USDT0 against WETH, XAUt0, wstETH, and WXPL collateral, or provide liquidity to earn yield.
homepage: https://github.com/chigozzdevv/tabby-cli
metadata: {"openclaw":{"always":true}}
---

# Tabby

Overcollateralized borrowing and LP protocol on Plasma. Borrow USDT0 against collateral or provide liquidity to earn yield.

- **Debt asset:** `USDT0`
- **Supported collateral:** `WETH`, `XAUt0`, `wstETH`, `WXPL`
- **Chain:** Plasma (chain ID `9745`)
- **Borrower runtime:** `tabby-borrower`
- **LP runtime:** `tabby-lp`

## Skill Files

| File | Description |
|------|-------------|
| **SKILL.md** (this file) | Top-level overview and protocol reference |
| **skills/tabby-borrower/SKILL.md** | Borrower skill — vault operations, quoting, monitoring |
| **skills/tabby-lp/SKILL.md** | LP skill — deposit/withdraw liquidity, pool monitoring |

---

## Protocol Overview

Tabby is an overcollateralized lending protocol. Borrowers deposit collateral into vaults and borrow `USDT0` against it. LPs deposit `USDT0` into the `DebtPool` and earn yield from borrower interest.

- There is no due date on borrows — interest accrues until repaid or liquidated.
- Borrow capacity depends on collateral value, risk parameters, pool liquidity, and any applicable caps.
- User-owned vaults can bind the borrower skill wallet as an operator.

---

## Borrower Skill

All borrower commands run through the allowlisted wrapper:

```bash
/home/tabby/bin/tabby-borrower.sh <command>
```

### Key Commands

| Command | Description |
|---------|-------------|
| `init-wallet` | Initialize the borrower wallet |
| `market` | Read current market state |
| `quote-borrow --collateral SYMBOL:AMOUNT` | Quote borrow power for given collateral |
| `open-vault` | Open a new vault |
| `approve-collateral --asset ADDRESS --amount N` | Approve collateral token spend |
| `deposit-collateral --vault-id N --asset ADDRESS --amount N` | Deposit collateral into a vault |
| `borrow --vault-id N --amount N` | Borrow USDT0 from a vault |
| `vault-status --vault-id N` | Check vault health, debt, and collateral |
| `repay --vault-id N --amount N` | Repay debt (use `--amount all` for full repay) |
| `withdraw-collateral --vault-id N --asset ADDRESS --amount N` | Withdraw collateral (use `--amount all` for full withdraw) |
| `monitor-vaults --quiet-ok` | Monitor all vaults, silent if healthy |
| `liquidate --vault-id N --amount N --asset ADDRESS` | Liquidate an unhealthy vault |
| `prepare-bind-operator --vault-id N` | Prepare operator binding for user-owned vault |
| `confirm-bind-operator --vault-id N` | Confirm operator binding |

### Assistant Commands

For agent-facing responses, use the `assistant-*` variants — they return deterministic JSON:

| Command | Use when |
|---------|----------|
| `assistant-quote --collateral SYMBOL:AMOUNT` | User asks about borrowing power or LTV |
| `assistant-vault-status --vault-id N` | User asks about vault health or position |
| `assistant-open-vault` | Opening a new vault |
| `assistant-deposit-collateral --vault-id N --asset ADDRESS --amount N` | Depositing collateral |
| `assistant-borrow --vault-id N --amount N` | Borrowing USDT0 |
| `assistant-repay --vault-id N --amount N` | Repaying debt |
| `assistant-withdraw-collateral --vault-id N --asset ADDRESS --amount N` | Withdrawing collateral |

### Agent-Owned Vault Flow

```bash
/home/tabby/bin/tabby-borrower.sh open-vault
/home/tabby/bin/tabby-borrower.sh approve-collateral --asset 0x6100... --amount 2
/home/tabby/bin/tabby-borrower.sh deposit-collateral --vault-id 1 --asset 0x6100... --amount 2
/home/tabby/bin/tabby-borrower.sh borrow --vault-id 1 --amount 0.05
```

### Human-Owned Vault (Operator) Flow

1. Human's browser wallet signs: `openVault()`, collateral `approve(...)`, `depositCollateral(...)`, `setVaultOperator(vaultId, operator, true)`
2. After binding succeeds, the agent runs `borrow` as operator

```bash
/home/tabby/bin/tabby-borrower.sh prepare-bind-operator --vault-id 1
/home/tabby/bin/tabby-borrower.sh confirm-bind-operator --vault-id 1
```

---

## LP Skill

All LP commands run through the allowlisted wrapper:

```bash
/home/tabby/bin/tabby-lp.sh <command>
```

### Key Commands

| Command | Description |
|---------|-------------|
| `init-wallet` | Initialize the LP wallet |
| `pool-status --json` | Get pool utilization, APY, TVL |
| `position --json` | Get your LP shares and estimated value |
| `approve-asset --amount N` | Approve USDT0 spend for deposit |
| `deposit-liquidity --amount N` | Deposit USDT0 into the pool |
| `withdraw-liquidity --amount N` | Withdraw liquidity |
| `withdraw-liquidity --all` | Withdraw all liquidity |
| `monitor-pool` | Monitor pool health |

### Assistant Commands

| Command | Use when |
|---------|----------|
| `assistant-pool-status` | User asks about pool APY, utilization, TVL |
| `assistant-position` | User asks about their LP position or shares |
| `assistant-deposit-liquidity --amount N` | Depositing liquidity |
| `assistant-withdraw-liquidity --amount N` or `--all` | Withdrawing liquidity |

---

## Contracts (Plasma Mainnet)

### Core

| Contract | Address |
|----------|---------|
| TimelockController | `0x648443185a261ff713d7347a8228e89da446a565` |
| Treasury | `0x6e3fae03b2150ab01f31cdf3f1fce7d7249faefb` |
| ChainlinkPriceOracle | `0x90604513f086c5e0d3175cb62ee37314dbc0f49b` |
| MarketConfig | `0xbad47d072b0632ac7883b0a03a655fecf941b412` |
| DebtPool | `0x7b57dda1e5ed2fcafb7b811cfa6bcf248f398d4f` |
| VaultManager | `0x25633ccac9a35302f6536547ae5a532c1744cbaa` |

### Assets

| Token | Address | Role |
|-------|---------|------|
| USDT0 | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` | Debt asset |
| WETH | `0x9895D81bB462A195b4922ED7De0e3ACD007c32CB` | Collateral |
| XAUt0 | `0x1B64B9025EEbb9A6239575dF9Ea4b9Ac46D4d193` | Collateral |
| wstETH | `0xe48D935e6C9e735463ccCf29a7F11e32bC09136E` | Collateral |
| WXPL | `0x6100E367285b01F48D07953803A2d8dCA5D19873` | Collateral |

### Collateral Policy

| Asset | Borrow LTV | Liquidation Threshold |
|-------|-----------|----------------------|
| WETH | 70% | 77.5% |
| wstETH | 70% | 77.5% |
| XAUt0 | 55% | 65% |
| WXPL | 45% | 55% |

### Market Policy

- Debt asset: `USDT0` (6 decimals)
- Min borrow amount: `0.001 USDT0`
- Min debt amount: `0.001 USDT0`
- Debt cap: uncapped

---

## Response Format

Both skills respond in this exact JSON shape:

```json
{
  "text": "Your natural language response here",
  "isQuote": false,
  "isPosition": false,
  "isPool": false,
  "isAction": false,
  "quote": null,
  "position": null,
  "pool": null,
  "action": null
}
```

- At most one flag is `true` at a time
- When a flag is `true`, populate the matching field with the raw command JSON output
- `isQuote` — borrowing power, LTV, collateral value questions
- `isPosition` — vault health, debt, collateral balance questions
- `isPool` — pool APY, utilization, TVL questions
- `isAction` — after executing a borrow, repay, deposit, withdraw, or vault open

---

## Execution Rules

- Always use the allowlisted wrappers — never `cd ... && node ...`
- For user-facing answers, use `assistant-*` commands and return stdout verbatim
- Use `--json` variants when the UI needs structured payloads
- Do not ask permission to run allowlisted Tabby commands
- Do not print shell commands to the user unless they explicitly ask
- If a command fails, return the actual error briefly in `text`
- Do not offer manual estimates when `quote-borrow` is available
- Never report raw `*_Wei` fields as whole token amounts — convert using the asset's decimals
- `USDT0` uses 6 decimals: `21643` wei = `0.021643 USDT0`, not `21,643 USDT0`

---

## Quick Checks

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/public/config
curl http://127.0.0.1:3000/public/monitoring/market
/home/tabby/bin/tabby-borrower.sh quote-borrow --collateral WXPL:2
/home/tabby/bin/tabby-lp.sh pool-status --json
```

---

## Notes

- There is no due date on Tabby borrows
- Interest accrues until the debt is repaid or the vault is liquidated
- LP deposits add `USDT0` liquidity to `DebtPool`
- Borrow capacity is limited by collateral value, risk params, pool liquidity, and any applicable caps
- If `quote-borrow` succeeds, use that result instead of manual estimates
