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

All commands must be run as: `/home/tabby/bin/tabby-lp.sh <command>`

```bash
/home/tabby/bin/tabby-lp.sh init-wallet
/home/tabby/bin/tabby-lp.sh assistant-pool-status
/home/tabby/bin/tabby-lp.sh pool-status --json
/home/tabby/bin/tabby-lp.sh assistant-position
/home/tabby/bin/tabby-lp.sh position --json
/home/tabby/bin/tabby-lp.sh approve-asset --amount 100
/home/tabby/bin/tabby-lp.sh deposit-liquidity --amount 100
/home/tabby/bin/tabby-lp.sh withdraw-liquidity --all
/home/tabby/bin/tabby-lp.sh monitor-pool
```

## Execution Rules

- Run the allowlisted wrapper directly: `/home/tabby/bin/tabby-lp.sh ...`
- Do not ask permission to run allowlisted Tabby LP commands.
- Do not print shell commands to the user unless they explicitly ask for the command.
- For pool-read answers, use `/home/tabby/bin/tabby-lp.sh assistant-pool-status` and return its stdout verbatim.
- For LP position answers, use `/home/tabby/bin/tabby-lp.sh assistant-position` and return its stdout verbatim.
- Use `pool-status --json` and `position --json` when the UI needs structured payloads.
- If a command fails, return the actual command error briefly in `text`.

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
        command: "/home/tabby/bin/tabby-lp.sh monitor-pool",
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
- Use `pool-status --json` and `position --json` when you need raw structured payloads

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
