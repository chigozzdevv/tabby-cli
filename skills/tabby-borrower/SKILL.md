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

All commands must be run as: `/home/tabby/bin/tabby-borrower.sh <command>`

```bash
/home/tabby/bin/tabby-borrower.sh init-wallet
/home/tabby/bin/tabby-borrower.sh market
/home/tabby/bin/tabby-borrower.sh assistant-quote --collateral WETH:1.25 --desired-borrow 500
/home/tabby/bin/tabby-borrower.sh quote-borrow --collateral WETH:1.25 --desired-borrow 500
/home/tabby/bin/tabby-borrower.sh assistant-vault-status --vault-id 1
/home/tabby/bin/tabby-borrower.sh open-vault
/home/tabby/bin/tabby-borrower.sh approve-collateral --asset 0xASSET --amount 1.25
/home/tabby/bin/tabby-borrower.sh deposit-collateral --vault-id 1 --asset 0xASSET --amount 1.25
/home/tabby/bin/tabby-borrower.sh borrow --vault-id 1 --amount 500
/home/tabby/bin/tabby-borrower.sh repay --vault-id 1 --amount all
/home/tabby/bin/tabby-borrower.sh withdraw-collateral --vault-id 1 --asset 0xASSET --amount all
/home/tabby/bin/tabby-borrower.sh vault-status --vault-id 1
/home/tabby/bin/tabby-borrower.sh monitor-vaults --quiet-ok
/home/tabby/bin/tabby-borrower.sh liquidate --vault-id 1 --amount 100 --asset 0xASSET
/home/tabby/bin/tabby-borrower.sh prepare-bind-operator --vault-id 1
/home/tabby/bin/tabby-borrower.sh confirm-bind-operator --vault-id 1
```

## Operator Model

For human-owned vaults the human wallet owns the vault, the skill wallet is bound as operator through `setVaultOperator(...)`, the human signs the binding transaction, and after binding the skill can manage the vault.

For agent-owned vaults the skill wallet itself opens and owns the vault.

## Quote Input

- For assistant quote replies, use `assistant-quote`, not `quote-borrow`.
- For assistant vault-position replies, use `assistant-vault-status`, not `vault-status`.
- `quote-borrow` accepts a collateral symbol or collateral address
- examples: `WETH:2`, `wstETH:1.5`, `0x9895D81bB462A195b4922ED7De0e3ACD007c32CB:2`
- amounts are human-readable token amounts, not wei
- quote outputs contain both USD values and raw debt-asset wei fields; `USDT0` uses 6 decimals
- `*_Usd` fields are 18-decimal fixed-point USD values, not human-readable dollar strings

## Execution Rules

- For any question about borrowing power, LTV, or "what can my collateral get me", run `/home/tabby/bin/tabby-borrower.sh assistant-quote ...` first.
- `assistant-quote` already returns the exact final assistant JSON shape. When it succeeds, return its stdout verbatim with no rewriting.
- For vault status, debt, or health-factor questions, run `/home/tabby/bin/tabby-borrower.sh assistant-vault-status ...` and return its stdout verbatim with no rewriting.
- Do not use `quote-borrow` for user-facing quote answers unless explicitly debugging the raw protocol payload.
- For any quote response, always set `isQuote = true` and include the full raw `quote` payload.
- Run the allowlisted wrapper directly: `/home/tabby/bin/tabby-borrower.sh ...`
- Do not ask permission to run allowlisted Tabby borrower commands.
- Do not print shell commands to the user unless they explicitly ask for the command.
- If the UI says the owner already opened the vault, deposited collateral, and bound the operator wallet, run `borrow` directly against that vault. Do not ask the user to choose a signing method.
- Only use `prepare-bind-operator` / `confirm-bind-operator` when the vault is user-owned and the operator binding is not already complete.
- Do not offer manual estimates, price assumptions, A/B choices, or "I can do this two ways" when `quote-borrow` is available.
- Do not claim you lack market-price access. `quote-borrow` already uses the live Tabby market data and protocol pricing exposed by the Tabby API.
- If `quote-borrow` succeeds, return the quote directly and set `isQuote = true`.
- Never report raw `*_Wei` fields as whole token amounts. Convert every debt amount using `quote.debtAsset.decimals`.
- For `USDT0`, `21643` wei means `0.021643 USDT0`, not `21,643 USDT0`.
- `maxAdditionalBorrowWei`, `poolAvailableLiquidityWei`, and `suggestedRangeWei.*` are raw debt-asset wei fields and must be formatted with decimals before writing `text`.
- If the quote payload says `maxAdditionalBorrowWei = "21643"` and debt decimals are `6`, say `0.021643 USDT0` or a rounded equivalent, not `21,643 USDT0`.
- Never print raw `requestedCollateralValueUsd`, `totalBorrowCapacityUsd`, `maxAdditionalBorrowUsd`, or any other `*_Usd` field directly. Those are fixed-point USD values with 18 decimals.
- If you mention USD values in `text`, convert them into normal dollar amounts first. Example: `21797244000000000` in a `*_Usd` field means about `$0.0218`, not `21,797,244,000,000,000`.
- Prefer this rule for quote text:
  - primary borrow amount: format `quote.totals.maxAdditionalBorrowWei` with `quote.debtAsset.decimals`
  - liquidity amount: format `quote.totals.poolAvailableLiquidityWei` with `quote.debtAsset.decimals`
  - LTV: use `borrowLtvBps`
  - optional collateral USD: convert `requestedCollateralValueUsd` to normal dollars before displaying
- Do not say "raw", "wei", or "fixed-point" to the user unless they explicitly ask for machine values.
- If `quote-borrow` fails, return the actual command error briefly in `text`. Do not say "no usable output" unless the command truly returned no stdout and no stderr.
- Do not ask the user to choose between retrying and an estimate unless they explicitly ask for an estimate.

## Monitoring

Use OpenClaw cron for periodic monitoring:

```json5
{
  cron: {
    jobs: [
      {
        id: "tabby-vault-monitor",
        schedule: "*/5 * * * *",
        command: "/home/tabby/bin/tabby-borrower.sh monitor-vaults --quiet-ok",
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

**Quote failure example** — command failed, so explain the real error briefly and do not invent alternatives:

```json
{
  "text": "I couldn't produce the quote because `quote-borrow` failed with: unsupported collateral 'XYZ'.",
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
