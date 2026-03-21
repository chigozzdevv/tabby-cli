---
name: tabby-borrower
description: Tabby vault workflows on Plasma for borrowers and operator agents.
metadata: {"openclaw":{"always":true}}
---

# Tabby Borrower

This skill is the borrower/operator runtime for Tabby’s Plasma vault protocol.

Model:

- borrower or agent creates a local wallet
- vaults live in `VaultManager`
- debt is borrowed from `DebtPool`
- debt asset is `USDT0`
- collateral is configured by the live market
- an agent wallet can be bound as a vault operator for a human-owned vault

## Local wallet persistence

- `~/.config/tabby-borrower/wallet.json`
- `~/.config/tabby-borrower/state.json`

## Commands

```bash
cd {baseDir}
npm install
npm run build
cp .env.example .env

# Create the skill wallet
npx tabby-borrower init-wallet

# Read live market config
npx tabby-borrower market

# Quote borrowing power from intended collateral
npx tabby-borrower quote-borrow \
  --collateral 0xASSET:1.25 \
  --desired-borrow 500

# Open a vault owned by the skill wallet
npx tabby-borrower open-vault

# Approve and deposit collateral
npx tabby-borrower approve-collateral --asset 0xASSET --amount 1.25
npx tabby-borrower deposit-collateral --vault-id 1 --asset 0xASSET --amount 1.25

# Borrow / repay / withdraw
npx tabby-borrower borrow --vault-id 1 --amount 500
npx tabby-borrower repay --vault-id 1 --amount all
npx tabby-borrower withdraw-collateral --vault-id 1 --asset 0xASSET --amount all

# Inspect and monitor vaults
npx tabby-borrower vault-status --vault-id 1
npx tabby-borrower monitor-vaults --quiet-ok
npx tabby-borrower liquidate --vault-id 1 --amount 100 --asset 0xASSET

# Prepare operator binding for a human-owned vault
npx tabby-borrower prepare-bind-operator --vault-id 1
npx tabby-borrower confirm-bind-operator --vault-id 1
```

## Operator Model

For human-owned vaults:

- the human wallet owns the vault
- the skill wallet is bound as operator through `setVaultOperator(...)`
- the human signs the binding transaction
- after binding, the skill can manage the vault within contract limits

For agent-owned vaults:

- the skill wallet itself opens and owns the vault

## Monitoring

`monitor-vaults` checks tracked vaults and warns on:

- low health factor
- critical health factor
- low XPL gas balance

Use OpenClaw cron for periodic monitoring:

```json5
{
  cron: {
    jobs: [
      {
        id: "tabby-vault-monitor",
        schedule: "*/5 * * * *",
        command: "cd /app/skills && npx tabby-borrower monitor-vaults --quiet-ok",
        enabled: true
      }
    ]
  }
}
```

Set `TABBY_NOTIFICATION_TARGET` if you want OpenClaw message alerts.
