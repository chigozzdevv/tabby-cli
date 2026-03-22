---
name: tabby-lp
description: Tabby Liquidity Provider workflows on Plasma for LPs and autonomous agents.
metadata: {"openclaw":{"always":true}}
---

# Tabby Liquidity Provider

This skill is the LP runtime for Tabby's Plasma protocol. It allows agents and users to provide liquidity to the `DebtPool` and monitor their yields.

## Local wallet persistence

- `~/.config/tabby-lp/wallet.json`
- `~/.config/tabby-lp/state.json`

## Commands

```bash
npx tabby-lp init-wallet
npx tabby-lp pool-status
npx tabby-lp deposit-liquidity --amount 100
npx tabby-lp withdraw-liquidity --all
npx tabby-lp monitor-pool
```

## Agent LP Model

- **Yield Capture**: monitor `pool-status` and deposit when Supply APY exceeds a target
- **Risk Mitigation**: monitor `utilizationBps` and withdraw if utilization exceeds 95%

```json5
{
  cron: {
    jobs: [
      {
        id: "tabby-lp-monitor",
        schedule: "0 * * * *",
        command: "cd /app/skills && npx tabby-lp monitor-pool",
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
- `action` shape: `{ "type": "deposit" | "withdraw", "success": true, "detail": "..." }`

**When to set isPool = true** — user asks about pool APY, utilization, TVL, borrow rate, pool health:

```json
{
  "text": "The pool is at 67% utilization with a current supply APY of 4.2%.",
  "isQuote": false,
  "isPosition": false,
  "isPool": true,
  "isAction": false,
  "quote": null,
  "position": null,
  "pool": { ...raw JSON from pool-status command... },
  "action": null
}
```

**When to set isPosition = true** — user asks about their LP position, shares, estimated assets:

```json
{
  "text": "You have 1,200 shares worth approximately 1,248 USDT0.",
  "isQuote": false,
  "isPosition": true,
  "isPool": false,
  "isAction": false,
  "quote": null,
  "position": { ...raw JSON from LP position query... },
  "pool": null,
  "action": null
}
```

**When to set isAction = true** — you just executed a deposit or withdrawal:

```json
{
  "text": "Done. Deposited 500 USDT0. You now hold 489.3 pool shares.",
  "isQuote": false,
  "isPosition": false,
  "isPool": false,
  "isAction": true,
  "quote": null,
  "position": null,
  "pool": null,
  "action": { "type": "deposit", "success": true, "detail": "500 USDT0 deposited, 489.3 shares received" }
}
```

**When all flags are false** — general questions, protocol explanations, errors:

```json
{
  "text": "As an LP you deposit USDT0 into the DebtPool and earn yield from borrower interest.",
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
