---
name: tabby-lp
description: Tabby Liquidity Provider workflows on Plasma for LPs and autonomous agents.
metadata: {"openclaw":{"always":true}}
---

# Tabby Liquidity Provider

This skill is the LP runtime for Tabby’s Plasma protocol. It allows agents and users to provide liquidity to the `DebtPool` and monitor their yields.

## Local wallet persistence

- `~/.config/tabby-lp/wallet.json`
- `~/.config/tabby-lp/state.json`

## Commands

```bash
cd {baseDir}
npm install
npm run build

# Create the skill wallet (if not already done)
node dist/bin/tabby-lp.js init-wallet

# Read pool metrics and yield
node dist/bin/tabby-lp.js pool-status

# Deposit liquidity
node dist/bin/tabby-lp.js deposit-liquidity --amount 100

# Withdraw liquidity
node dist/bin/tabby-lp.js withdraw-liquidity --shares 50

# Monitor pool yield and health
node dist/bin/tabby-lp.js monitor-pool
```

## Agent LP Model

Agents can serve as automated LPs:
- **Yield Capture**: The agent can monitor `pool-status` and deposit when the "Supply APY" exceeds a target (e.g., 5%).
- **Risk Mitigation**: The agent can monitor `utilizationBps`. If utilization is too high (e.g., > 95%), it signals high risk, and the agent can withdraw to stay safe.
- **Autonomous Monitoring**: Use cron to periodically check the pool.

```json5
{
  cron: {
    jobs: [
      {
        id: "tabby-lp-monitor",
        schedule: "0 * * * *", // Hourly
        command: "cd /app/skills/tabby-lp && node dist/bin/tabby-lp.js monitor-pool",
        enabled: true
      }
    ]
  }
}
```
