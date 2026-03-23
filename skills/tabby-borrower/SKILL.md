---
name: tabby-borrower
description: Tabby vault workflows on Plasma for borrowers and operator agents.
metadata: {"openclaw":{"always":true}}
---

# Tabby Borrower

This skill is the borrower/operator runtime for Tabby's Plasma vault protocol.

- vaults live in `VaultManager`
- debt is borrowed from `DebtPool`
- debt asset is `USDT0`
- collateral assets: `WETH`, `XAUt0`, `wstETH`, `WXPL`
- an agent wallet can be bound as a vault operator for a human-owned vault

## Local wallet persistence

- `~/.config/tabby-borrower/wallet.json`
- `~/.config/tabby-borrower/state.json`

## Commands

All commands must be run as: `cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js <command>`

```bash
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js init-wallet
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js market
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js quote-borrow --collateral WETH:1.25 --desired-borrow 500
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js open-vault
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js approve-collateral --asset 0xASSET --amount 1.25
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js deposit-collateral --vault-id 1 --asset 0xASSET --amount 1.25
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js borrow --vault-id 1 --amount 500
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js repay --vault-id 1 --amount all
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js withdraw-collateral --vault-id 1 --asset 0xASSET --amount all
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js vault-status --vault-id 1
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js monitor-vaults --quiet-ok
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js liquidate --vault-id 1 --amount 100 --asset 0xASSET
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js prepare-bind-operator --vault-id 1
cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js confirm-bind-operator --vault-id 1
```

## Operator Model

For human-owned vaults the human wallet owns the vault, the skill wallet is bound as operator through `setVaultOperator(...)`, the human signs the binding transaction, and after binding the skill can manage the vault.

For agent-owned vaults the skill wallet itself opens and owns the vault.

## Quote Input

- `quote-borrow` accepts a collateral symbol or collateral address
- examples: `WETH:2`, `wstETH:1.5`, `0x9895D81bB462A195b4922ED7De0e3ACD007c32CB:2`
- amounts are human-readable token amounts, not wei

## Monitoring

Use OpenClaw cron for periodic monitoring:

```json5
{
  cron: {
    jobs: [
      {
        id: "tabby-vault-monitor",
        schedule: "*/5 * * * *",
        command: "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js monitor-vaults --quiet-ok",
        enabled: true
      }
    ]
  }
}
```

## Response Format

**Always respond in this exact JSON shape. No exceptions.**

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

Field rules:
- `text` — always present, your full conversational response
- At most one of `isQuote`, `isPosition`, `isPool`, `isAction` is `true` at a time
- When a flag is `true`, populate the matching field with the raw JSON output from the command; set all others to `null`
- `action` shape: `{ "type": "borrow" | "repay" | "deposit" | "withdraw" | "open-vault", "success": true, "detail": "..." }`

**When to set isQuote = true** — user asks about borrowing capacity, LTV, how much they can borrow, what a collateral amount gets them:

```json
{
  "text": "With 2 WETH as collateral you can borrow up to 4,521 USDT0 at 70% LTV.",
  "isQuote": true,
  "isPosition": false,
  "isPool": false,
  "isAction": false,
  "quote": { ...raw JSON from quote-borrow command... },
  "position": null,
  "pool": null,
  "action": null
}
```

**When to set isPosition = true** — user asks about their vault, health factor, debt, collateral balance, position status:

```json
{
  "text": "Your vault #3 is healthy with a health factor of 1.87.",
  "isQuote": false,
  "isPosition": true,
  "isPool": false,
  "isAction": false,
  "quote": null,
  "position": { ...raw JSON from vault-status command... },
  "pool": null,
  "action": null
}
```

**When to set isAction = true** — you just executed a borrow, repay, deposit, withdraw, or vault open:

```json
{
  "text": "Done. Borrowed 500 USDT0 into vault #3. Health factor is now 1.62.",
  "isQuote": false,
  "isPosition": false,
  "isPool": false,
  "isAction": true,
  "quote": null,
  "position": null,
  "pool": null,
  "action": { "type": "borrow", "success": true, "detail": "500 USDT0 borrowed, vault #3, HF 1.62" }
}
```

**When all flags are false** — general questions, explanations, errors, protocol info:

```json
{
  "text": "Tabby is an overcollateralized lending protocol on Plasma. You deposit collateral and borrow USDT0 against it.",
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
