#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getEnv } from "../env.js";

type BorrowerState = {
  chainId?: number;
  rpcUrl?: string;
  vaultManager?: `0x${string}`;
  debtPool?: `0x${string}`;
  marketConfig?: `0x${string}`;
  debtAsset?: `0x${string}`;
  collateralAssets?: `0x${string}`[];
  trackedVaultIds?: number[];
  lastLowGasAt?: number;
  lastVaultAlerts?: Record<string, number>;
};

type ProtocolConfig = {
  chainId: number;
  rpcUrl: string;
  timeLock?: `0x${string}`;
  treasury?: `0x${string}`;
  priceOracle?: `0x${string}`;
  marketConfig: `0x${string}`;
  debtPool: `0x${string}`;
  vaultManager: `0x${string}`;
  debtAsset: `0x${string}`;
  collateralAssets: `0x${string}`[];
  walletRegistry?: `0x${string}` | null;
};

type AssetSnapshot = {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  priceUsd: string;
};

type MarketCollateralSnapshot = {
  asset: AssetSnapshot;
  config: {
    borrowLtvBps: number;
    liquidationThresholdBps: number;
    liquidationBonusBps: number;
    supplyCap: string;
    valueCapUsd: string;
    enabled: boolean;
  };
};

type PoolSnapshot = {
  asset: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  walletRegistry: `0x${string}` | null;
  treasuryFeeBps: number;
  treasuryFeeRecipient: `0x${string}` | null;
  totalAssetsWei: string;
  availableLiquidityWei: string;
  totalDebtAssetsWei: string;
  totalShares: string;
  utilizationBps: number;
  currentBorrowRateBps: number;
  liquidityIndexRay: string;
  borrowIndexRay: string;
  lastAccruedAt: number;
};

type MarketOverview = {
  debtAsset: AssetSnapshot;
  debtOracle?: {
    feed: `0x${string}` | null;
    maxAgeSeconds: number;
    enabled: boolean;
    aliasAsset: `0x${string}` | null;
  };
  debtPool: `0x${string}`;
  vaultManager: `0x${string}`;
  marketConfig: `0x${string}`;
  walletRegistry: `0x${string}` | null;
  closeFactorBps: number;
  minBorrowAmountWei: string;
  minDebtAmountWei: string;
  debtCapWei: string;
  pauseFlags: {
    lpDepositPaused: boolean;
    lpWithdrawPaused: boolean;
    collateralDepositPaused: boolean;
    collateralWithdrawPaused: boolean;
    borrowPaused: boolean;
    liquidationPaused: boolean;
  };
  rateModel: {
    baseRateBps: number;
    kinkUtilizationBps: number;
    slope1Bps: number;
    slope2Bps: number;
    minRateBps: number;
    maxRateBps: number;
  };
  collaterals: MarketCollateralSnapshot[];
  pool: PoolSnapshot;
};

type VaultCollateralSnapshot = {
  asset: AssetSnapshot;
  config: MarketCollateralSnapshot["config"];
  balanceWei: string;
  valueUsd: string;
};

type VaultSummary = {
  vaultId: number;
  owner: `0x${string}`;
  operators?: `0x${string}`[];
  normalizedDebt: string;
  debtWei: string;
  debtValueUsd: string;
  collateralValueUsd: string;
  borrowCapacityUsd: string;
  liquidationCapacityUsd: string;
  maxAdditionalBorrowUsd: string;
  maxAdditionalBorrowWei: string;
  currentBorrowRateBps: number;
  healthFactorE18: string;
  collaterals: VaultCollateralSnapshot[];
};

type AssistantCollateralIntent = {
  asset: `0x${string}`;
  amountWei: string;
};

type BorrowPreflightQuote = {
  owner?: `0x${string}`;
  vaultId?: number;
  debtAsset: AssetSnapshot;
  existingVault?: {
    owner: `0x${string}`;
    debtWei: string;
    debtValueUsd: string;
    collateralValueUsd: string;
    borrowCapacityUsd: string;
    liquidationCapacityUsd: string;
    healthFactorE18: string;
  };
  requestedCollaterals: {
    asset: `0x${string}`;
    symbol: string;
    decimals: number;
    requestedAmountWei: string;
    walletBalanceWei?: string;
    withinWalletBalance?: boolean;
    priceUsd: string;
    valueUsd: string;
    borrowCapacityUsd: string;
    liquidationCapacityUsd: string;
    borrowLtvBps: number;
    liquidationThresholdBps: number;
  }[];
  totals: {
    requestedCollateralValueUsd: string;
    totalCollateralValueUsd: string;
    totalBorrowCapacityUsd: string;
    totalLiquidationCapacityUsd: string;
    currentDebtValueUsd: string;
    maxAdditionalBorrowUsd: string;
    maxAdditionalBorrowWei: string;
    poolAvailableLiquidityWei: string;
    debtCapHeadroomWei: string;
  };
  suggestedRangeWei: {
    conservative: string;
    balanced: string;
    aggressive: string;
  };
  desiredBorrow?: {
    amountWei: string;
    feasible: boolean;
    projectedHealthFactorE18?: string;
    reasons: string[];
  };
};

const zeroAddress = "0x0000000000000000000000000000000000000000";
const maxUint256 = (1n << 256n) - 1n;
const defaultChainId = 9745;
const defaultGasFloorWei = 10_000_000_000_000_000n;
const warnHealthFactorDefault = 1_250_000_000_000_000_000n;
const criticalHealthFactorDefault = 1_100_000_000_000_000_000n;
const notificationCooldownSeconds = 60 * 60;
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const publicConfigSchema = z.object({
  chainId: z.number().int().positive().optional(),
  timeLock: addressSchema.optional(),
  treasury: addressSchema.optional(),
  priceOracle: addressSchema.optional(),
  marketConfig: addressSchema.optional(),
  debtPool: addressSchema.optional(),
  vaultManager: addressSchema.optional(),
  debtAsset: addressSchema.optional(),
  collateralAssets: z.array(addressSchema).optional(),
  walletRegistry: addressSchema.nullish(),
});

const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const priceOracleAbi = [
  {
    type: "function",
    name: "getPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const marketConfigAbi = [
  { type: "function", name: "debtAsset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "priceOracle", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "closeFactorBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "minBorrowAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minDebtAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "debtCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lpDepositPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "lpWithdrawPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "collateralDepositPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "collateralWithdrawPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "borrowPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "liquidationPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "rateModel",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "baseRateBps", type: "uint16" },
      { name: "kinkUtilizationBps", type: "uint16" },
      { name: "slope1Bps", type: "uint16" },
      { name: "slope2Bps", type: "uint16" },
      { name: "minRateBps", type: "uint16" },
      { name: "maxRateBps", type: "uint16" },
    ],
  },
  { type: "function", name: "getCollateralAssets", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  {
    type: "function",
    name: "getCollateralConfig",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "borrowLtvBps", type: "uint16" },
          { name: "liquidationThresholdBps", type: "uint16" },
          { name: "liquidationBonusBps", type: "uint16" },
          { name: "supplyCap", type: "uint256" },
          { name: "valueCapUsd", type: "uint256" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
  },
] as const;

const debtPoolAbi = [
  { type: "function", name: "ASSET", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "walletRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "treasuryFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "treasuryFeeRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "availableLiquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDebtAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "utilizationBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "currentBorrowRateBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "liquidityIndex", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "borrowIndex", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastAccruedAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
] as const;

const vaultManagerAbi = [
  { type: "function", name: "walletRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "openVault", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "setVaultOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "operator", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "depositCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [
      { name: "normalizedDebtAdded", type: "uint256" },
      { name: "borrowRateBps", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "maxAmount", type: "uint256" },
    ],
    outputs: [
      { name: "repaid", type: "uint256" },
      { name: "normalizedDebtRepaid", type: "uint256" },
      { name: "remainingDebt", type: "uint256" },
    ],
  },
  { type: "function", name: "vaults", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ name: "owner", type: "address" }, { name: "normalizedDebt", type: "uint256" }] },
  {
    type: "function",
    name: "vaultOperators",
    stateMutability: "view",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "getVaultCollateralAssets", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "address[]" }] },
  {
    type: "function",
    name: "collateralBalances",
    stateMutability: "view",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "asset", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "debtOf", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "debtValueUsd", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "collateralValueUsd", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "borrowCapacityUsd", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "liquidationCapacityUsd", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "healthFactor", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "currentBorrowRateBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "event",
    name: "VaultOpened",
    inputs: [
      { indexed: true, name: "vaultId", type: "uint256" },
      { indexed: true, name: "owner", type: "address" },
    ],
  },
] as const;

function parseDotEnv(content: string) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function loadLocalEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "..", ".env"), path.join(here, "..", "..", ".env")];

  for (const envPath of candidates) {
    try {
      const raw = await fs.readFile(envPath, "utf8");
      parseDotEnv(raw);
      return;
    } catch {
      continue;
    }
  }
}

await loadLocalEnv();
const ENV = getEnv();

function usage() {
  console.log(
    [
      "tabby-borrower <command>",
      "",
      "Commands:",
      "  init-wallet [--force]",
      "  market [--json]",
      "  quote-borrow --collateral <asset:amount> [--collateral <asset:amount> ...] [--desired-borrow <n>|--desired-borrow-wei <wei>] [--owner <0x...>] [--vault-id <id>] [--json]",
      "  open-vault",
      "  approve-collateral --asset <0x...> (--amount <n>|--amount-wei <wei>|--max)",
      "  deposit-collateral --vault-id <id> [--asset <0x...>] (--amount <n>|--amount-wei <wei>)",
      "  borrow --vault-id <id> (--amount <n>|--amount-wei <wei>) [--receiver <0x...>]",
      "  repay --vault-id <id> [--amount <n>|--amount-wei <wei>] [--no-auto-approve]",
      "  withdraw-collateral --vault-id <id> [--asset <0x...>] (--amount <n>|--amount-wei <wei>) [--to <0x...>]",
      "  vault-status --vault-id <id> [--json]",
      "  monitor-vaults [--vault-id <id> ...] [--owner <0x...>] [--quiet-ok] [--json]",
      "  prepare-bind-operator --vault-id <id> [--operator <0x...>] [--session-id <uuid>] [--disallow]",
      "  confirm-bind-operator --vault-id <id> [--operator <0x...>] [--binding-id <uuid>]",
      "",
      "Env:",
      "  TABBY_API_BASE_URL               (default: https://api.tabby.cash)",
      "  CHAIN_ID / RPC_URL               (optional; defaults to Plasma mainnet)",
      "  VAULT_MANAGER_ADDRESS            (optional; overrides /public/config)",
      "  DEBT_POOL_ADDRESS                (optional; overrides /public/config)",
      "  MARKET_CONFIG_ADDRESS            (optional; overrides /public/config)",
      "  DEBT_ASSET_ADDRESS               (optional; overrides /public/config)",
      "  COLLATERAL_ASSETS                (optional comma-separated overrides)",
      "  COLLATERAL_ASSET                 (optional default collateral asset)",
      "  TABBY_MIN_GAS_WEI                (optional; low-XPL warning threshold)",
      "  TABBY_WARN_HEALTH_FACTOR_E18     (optional; default: 1.25e18)",
      "  TABBY_CRITICAL_HEALTH_FACTOR_E18 (optional; default: 1.10e18)",
      "  TABBY_NOTIFICATION_TARGET        (optional; OpenClaw notification target)",
    ].join("\n")
  );
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function getArg(name: string) {
  const index = process.argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (index === -1) return undefined;
  const arg = process.argv[index];
  if (arg.includes("=")) return arg.split("=").slice(1).join("=");
  return process.argv[index + 1];
}

function getArgs(name: string) {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === name) {
      const next = process.argv[i + 1];
      if (next !== undefined) values.push(next);
      continue;
    }
    if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
    }
  }
  return values;
}

function requireArg(name: string) {
  const value = getArg(name);
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}`);
  return value;
}

function asAddress(value: string | undefined, label: string) {
  if (value === undefined) return undefined;
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value as `0x${string}`;
}

function parseAddressList(value: string | undefined): `0x${string}`[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => asAddress(item, "address list entry"))
    .filter((item): item is `0x${string}` => Boolean(item));
}

function baseUrl() {
  const url = new URL(ENV.TABBY_API_BASE_URL);
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocal && url.protocol !== "https:") {
    throw new Error("TABBY_API_BASE_URL must use https for non-local hosts");
  }
  return url.toString();
}

function defaultRpcUrl(chainId: number) {
  if (chainId === 9745) return "https://rpc.plasma.to";
  return undefined;
}

function formatAmount(valueWei: bigint, decimals: number, fractionDigits = 6) {
  const raw = formatUnits(valueWei, decimals);
  const [whole, frac = ""] = raw.split(".");
  if (!frac) return raw;
  const trimmed = frac.slice(0, fractionDigits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function formatUsd(valueUsd: bigint, fractionDigits = 2) {
  return formatAmount(valueUsd, 18, fractionDigits);
}

function formatHealthFactor(valueE18: bigint) {
  if (valueE18 === 0n) return "0";
  if (valueE18 > 10_000_000_000_000_000_000_000_000n) return "infinite";
  return formatAmount(valueE18, 18, 3);
}

function minBigInt(...values: bigint[]) {
  return values.reduce((current, value) => (value < current ? value : current));
}

function quoteBand(maxValue: bigint, bps: bigint) {
  return (maxValue * bps) / 10_000n;
}

function parseAmountToWei(options: { amount?: string; amountWei?: string; decimals: number; label: string }) {
  if (options.amountWei) {
    if (!/^\d+$/.test(options.amountWei)) throw new Error(`Invalid ${options.label} wei amount`);
    return BigInt(options.amountWei);
  }
  if (options.amount) {
    return parseUnits(options.amount, options.decimals);
  }
  throw new Error(`Missing ${options.label} amount`);
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function walletPath() {
  return path.join(os.homedir(), ".config", "tabby-borrower", "wallet.json");
}

async function statePath() {
  return path.join(os.homedir(), ".config", "tabby-borrower", "state.json");
}

async function loadWallet() {
  const p = await walletPath();
  const raw = await fs.readFile(p, "utf8");
  const parsed = z
    .object({
      address: addressSchema,
      privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    })
    .parse(JSON.parse(raw));
  return { ...parsed, path: p };
}

async function saveWallet(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  const p = await walletPath();
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify({ address: account.address, privateKey }, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(p, 0o600);
  return { address: account.address as `0x${string}`, path: p };
}

async function loadState(): Promise<BorrowerState & { path: string }> {
  const p = await statePath();
  const raw = await fs.readFile(p, "utf8");
  const parsed = z
    .object({
      chainId: z.number().int().positive().optional(),
      rpcUrl: z.string().url().optional(),
      vaultManager: addressSchema.optional(),
      debtPool: addressSchema.optional(),
      marketConfig: addressSchema.optional(),
      debtAsset: addressSchema.optional(),
      collateralAssets: z.array(addressSchema).optional(),
      trackedVaultIds: z.array(z.number().int().positive()).optional(),
      lastLowGasAt: z.number().int().nonnegative().optional(),
      lastVaultAlerts: z.record(z.string(), z.number().int().nonnegative()).optional(),
    })
    .passthrough()
    .parse(JSON.parse(raw)) as BorrowerState;

  return { ...parsed, path: p };
}

async function tryLoadState() {
  try {
    return await loadState();
  } catch {
    return undefined;
  }
}

async function updateState(patch: Partial<BorrowerState>) {
  const p = await statePath();
  await ensureDir(path.dirname(p));

  let existing: BorrowerState = {};
  try {
    existing = await loadState();
  } catch {
    existing = {};
  }

  const next: BorrowerState = {
    ...existing,
    ...patch,
    lastVaultAlerts: patch.lastVaultAlerts
      ? { ...(existing.lastVaultAlerts ?? {}), ...patch.lastVaultAlerts }
      : existing.lastVaultAlerts,
  };

  await fs.writeFile(p, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.chmod(p, 0o600);
  return { path: p };
}

async function addTrackedVaultId(vaultId: number) {
  const state: BorrowerState = (await tryLoadState()) ?? {};
  const tracked = new Set(state.trackedVaultIds ?? []);
  tracked.add(vaultId);
  await updateState({ trackedVaultIds: Array.from(tracked).sort((a, b) => a - b) });
}

async function loadBorrowerAccount() {
  const wallet = await loadWallet();
  const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
  return { wallet, account };
}

async function sendNotification(message: string) {
  const target = ENV.TABBY_NOTIFICATION_TARGET;
  if (!target) return;

  try {
    const { execSync } = await import("node:child_process");
    execSync(`openclaw message send --target "${target}" --message "${message.replace(/"/g, '\\"')}"`, {
      stdio: "ignore",
      timeout: 10_000,
    });
  } catch {
    // best effort
  }
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status})${text ? `: ${text}` : ""}`);
  }
  const payload = await res.json();
  if (!payload?.ok) {
    throw new Error(payload?.error?.message ?? "Invalid server response");
  }
  return payload.data as T;
}

async function fetchOptionalJson<T>(input: string, init?: RequestInit): Promise<T | undefined> {
  try {
    return await fetchJson<T>(input, init);
  } catch {
    return undefined;
  }
}

async function fetchPublicConfig(): Promise<Partial<ProtocolConfig> | undefined> {
  const data = await fetchOptionalJson<unknown>(new URL("/public/config", baseUrl()).toString());
  if (!data) return undefined;
  const parsed = publicConfigSchema.parse(data);
  return {
    chainId: parsed.chainId,
    timeLock: parsed.timeLock as `0x${string}` | undefined,
    treasury: parsed.treasury as `0x${string}` | undefined,
    priceOracle: parsed.priceOracle as `0x${string}` | undefined,
    marketConfig: parsed.marketConfig as `0x${string}` | undefined,
    debtPool: parsed.debtPool as `0x${string}` | undefined,
    vaultManager: parsed.vaultManager as `0x${string}` | undefined,
    debtAsset: parsed.debtAsset as `0x${string}` | undefined,
    collateralAssets: parsed.collateralAssets as `0x${string}`[] | undefined,
    walletRegistry: (parsed.walletRegistry as `0x${string}` | null | undefined) ?? undefined,
  };
}

async function resolveProtocolConfig(): Promise<ProtocolConfig> {
  const state: BorrowerState = (await tryLoadState()) ?? {};
  const publicConfig: Partial<ProtocolConfig> | undefined = await fetchPublicConfig();

  const chainId = ENV.CHAIN_ID ?? publicConfig?.chainId ?? state.chainId ?? defaultChainId;
  const rpcUrl = ENV.RPC_URL ?? state.rpcUrl ?? defaultRpcUrl(chainId);
  if (!rpcUrl) throw new Error("Missing RPC_URL");

  const envCollateralAssets = parseAddressList(ENV.COLLATERAL_ASSETS);
  const collateralAssets =
    envCollateralAssets.length > 0
      ? envCollateralAssets
      : publicConfig?.collateralAssets ?? state.collateralAssets ?? (ENV.COLLATERAL_ASSET ? [ENV.COLLATERAL_ASSET as `0x${string}`] : []);

  const protocol: ProtocolConfig = {
    chainId,
    rpcUrl,
    timeLock: publicConfig?.timeLock,
    treasury: publicConfig?.treasury,
    priceOracle: publicConfig?.priceOracle,
    marketConfig:
      (ENV.MARKET_CONFIG_ADDRESS as `0x${string}` | undefined) ??
      publicConfig?.marketConfig ??
      state.marketConfig ??
      (() => {
        throw new Error("Missing MARKET_CONFIG_ADDRESS");
      })(),
    debtPool:
      (ENV.DEBT_POOL_ADDRESS as `0x${string}` | undefined) ??
      publicConfig?.debtPool ??
      state.debtPool ??
      (() => {
        throw new Error("Missing DEBT_POOL_ADDRESS");
      })(),
    vaultManager:
      (ENV.VAULT_MANAGER_ADDRESS as `0x${string}` | undefined) ??
      publicConfig?.vaultManager ??
      state.vaultManager ??
      (() => {
        throw new Error("Missing VAULT_MANAGER_ADDRESS");
      })(),
    debtAsset:
      (ENV.DEBT_ASSET_ADDRESS as `0x${string}` | undefined) ??
      publicConfig?.debtAsset ??
      state.debtAsset ??
      (() => {
        throw new Error("Missing DEBT_ASSET_ADDRESS");
      })(),
    collateralAssets,
    walletRegistry:
      publicConfig?.walletRegistry === undefined ? undefined : (publicConfig.walletRegistry as `0x${string}` | null),
  };

  await updateState({
    chainId: protocol.chainId,
    rpcUrl: protocol.rpcUrl,
    vaultManager: protocol.vaultManager,
    debtPool: protocol.debtPool,
    marketConfig: protocol.marketConfig,
    debtAsset: protocol.debtAsset,
    collateralAssets: protocol.collateralAssets,
  });

  return protocol;
}

function createChain(protocol: ProtocolConfig) {
  return {
    id: protocol.chainId,
    name: protocol.chainId === 9745 ? "Plasma Mainnet" : `Chain ${protocol.chainId}`,
    nativeCurrency: { name: "XPL", symbol: "XPL", decimals: 18 },
    rpcUrls: { default: { http: [protocol.rpcUrl] } },
  };
}

function createClients(protocol: ProtocolConfig) {
  const chain = createChain(protocol);
  const publicClient = createPublicClient({ chain, transport: http(protocol.rpcUrl) }) as any;
  return { chain, publicClient };
}

async function readAssetSnapshot(publicClient: any, priceOracle: `0x${string}`, asset: `0x${string}`): Promise<AssetSnapshot> {
  const [symbol, decimals, priceUsd] = await Promise.all([
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }).catch(() => "TOKEN"),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
    publicClient.readContract({ address: priceOracle, abi: priceOracleAbi, functionName: "getPrice", args: [asset] }).catch(() => 0n),
  ]);

  return {
    address: asset,
    symbol: String(symbol),
    decimals: Number(decimals),
    priceUsd: priceUsd.toString(),
  };
}

async function readPoolSnapshotDirect(
  publicClient: any,
  protocol: ProtocolConfig
): Promise<PoolSnapshot> {
  const [
    asset,
    walletRegistry,
    treasuryFeeBps,
    treasuryFeeRecipient,
    totalAssets,
    availableLiquidity,
    totalDebtAssets,
    totalShares,
    utilizationBps,
    currentBorrowRateBps,
    liquidityIndexRay,
    borrowIndexRay,
    lastAccruedAt,
    assetSymbol,
    assetDecimals,
  ] = await Promise.all([
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "ASSET" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "walletRegistry" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "treasuryFeeBps" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "treasuryFeeRecipient" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalAssets" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "availableLiquidity" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalDebtAssets" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalShares" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "utilizationBps" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "currentBorrowRateBps" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "liquidityIndex" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "borrowIndex" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "lastAccruedAt" }),
    publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "symbol" }).catch(() => "TOKEN"),
    publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
  ]);

  return {
    asset,
    assetSymbol: String(assetSymbol),
    assetDecimals: Number(assetDecimals),
    walletRegistry: walletRegistry === zeroAddress ? null : walletRegistry,
    treasuryFeeBps: Number(treasuryFeeBps),
    treasuryFeeRecipient: treasuryFeeRecipient === zeroAddress ? null : treasuryFeeRecipient,
    totalAssetsWei: totalAssets.toString(),
    availableLiquidityWei: availableLiquidity.toString(),
    totalDebtAssetsWei: totalDebtAssets.toString(),
    totalShares: totalShares.toString(),
    utilizationBps: Number(utilizationBps),
    currentBorrowRateBps: Number(currentBorrowRateBps),
    liquidityIndexRay: liquidityIndexRay.toString(),
    borrowIndexRay: borrowIndexRay.toString(),
    lastAccruedAt: Number(lastAccruedAt),
  };
}

async function readMarketOverviewDirect(protocol: ProtocolConfig): Promise<MarketOverview> {
  const { publicClient } = createClients(protocol);
  const [
    debtAssetAddress,
    priceOracle,
    closeFactorBps,
    minBorrowAmountWei,
    minDebtAmountWei,
    debtCapWei,
    lpDepositPaused,
    lpWithdrawPaused,
    collateralDepositPaused,
    collateralWithdrawPaused,
    borrowPaused,
    liquidationPaused,
    rateModel,
    collateralAssets,
    walletRegistry,
  ] = await Promise.all([
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "debtAsset" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "priceOracle" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "closeFactorBps" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "minBorrowAmount" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "minDebtAmount" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "debtCap" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "lpDepositPaused" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "lpWithdrawPaused" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "collateralDepositPaused" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "collateralWithdrawPaused" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "borrowPaused" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "liquidationPaused" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "rateModel" }),
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "getCollateralAssets" }).catch(
      () => protocol.collateralAssets
    ),
    publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "walletRegistry" }),
  ]);

  const debtAsset = await readAssetSnapshot(publicClient, priceOracle, debtAssetAddress);
  const collaterals = await Promise.all(
    (collateralAssets as readonly `0x${string}`[]).map(async (asset) => {
      const [assetSnapshot, config] = await Promise.all([
        readAssetSnapshot(publicClient, priceOracle, asset),
        publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "getCollateralConfig", args: [asset] }),
      ]);

      return {
        asset: assetSnapshot,
        config: {
          borrowLtvBps: Number(config.borrowLtvBps),
          liquidationThresholdBps: Number(config.liquidationThresholdBps),
          liquidationBonusBps: Number(config.liquidationBonusBps),
          supplyCap: config.supplyCap.toString(),
          valueCapUsd: config.valueCapUsd.toString(),
          enabled: config.enabled,
        },
      };
    })
  );

  const pool = await readPoolSnapshotDirect(publicClient, protocol);

  return {
    debtAsset,
    debtPool: protocol.debtPool,
    vaultManager: protocol.vaultManager,
    marketConfig: protocol.marketConfig,
    walletRegistry: walletRegistry === zeroAddress ? null : walletRegistry,
    closeFactorBps: Number(closeFactorBps),
    minBorrowAmountWei: minBorrowAmountWei.toString(),
    minDebtAmountWei: minDebtAmountWei.toString(),
    debtCapWei: debtCapWei.toString(),
    pauseFlags: {
      lpDepositPaused,
      lpWithdrawPaused,
      collateralDepositPaused,
      collateralWithdrawPaused,
      borrowPaused,
      liquidationPaused,
    },
    rateModel: {
      baseRateBps: Number(rateModel.baseRateBps ?? rateModel[0]),
      kinkUtilizationBps: Number(rateModel.kinkUtilizationBps ?? rateModel[1]),
      slope1Bps: Number(rateModel.slope1Bps ?? rateModel[2]),
      slope2Bps: Number(rateModel.slope2Bps ?? rateModel[3]),
      minRateBps: Number(rateModel.minRateBps ?? rateModel[4]),
      maxRateBps: Number(rateModel.maxRateBps ?? rateModel[5]),
    },
    collaterals,
    pool,
  };
}

async function readVaultSummaryDirect(protocol: ProtocolConfig, vaultId: number): Promise<VaultSummary> {
  const { publicClient } = createClients(protocol);
  const [vault, debtWei, debtValueUsd, collateralValueUsd, borrowCapacityUsd, liquidationCapacityUsd, healthFactorE18, collateralAssets, currentBorrowRateBps, market] =
    await Promise.all([
      publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "vaults", args: [BigInt(vaultId)] }),
      publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "debtOf", args: [BigInt(vaultId)] }),
      publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "debtValueUsd", args: [BigInt(vaultId)] }),
      publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "collateralValueUsd", args: [BigInt(vaultId)] }),
      publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "borrowCapacityUsd", args: [BigInt(vaultId)] }),
      publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "liquidationCapacityUsd", args: [BigInt(vaultId)] }),
      publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "healthFactor", args: [BigInt(vaultId)] }),
      publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "getVaultCollateralAssets", args: [BigInt(vaultId)] }),
      publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "currentBorrowRateBps" }),
      readMarketOverviewDirect(protocol),
    ]);

  const owner = vault[0];
  if (owner === zeroAddress) throw new Error(`Vault ${vaultId} not found`);

  const collaterals = await Promise.all(
    (collateralAssets as readonly `0x${string}`[]).map(async (asset) => {
      const [balanceWei, assetConfig] = await Promise.all([
        publicClient.readContract({
          address: protocol.vaultManager,
          abi: vaultManagerAbi,
          functionName: "collateralBalances",
          args: [BigInt(vaultId), asset],
        }),
        Promise.resolve(market.collaterals.find((item) => item.asset.address.toLowerCase() === asset.toLowerCase())),
      ]);

      if (!assetConfig) throw new Error(`Missing collateral config for ${asset}`);
      const valueUsd =
        balanceWei === 0n
          ? 0n
          : (balanceWei * BigInt(assetConfig.asset.priceUsd)) / (10n ** BigInt(assetConfig.asset.decimals));

      return {
        asset: assetConfig.asset,
        config: assetConfig.config,
        balanceWei: balanceWei.toString(),
        valueUsd: valueUsd.toString(),
      };
    })
  );

  const debtValueUsdBigInt = BigInt(debtValueUsd.toString());
  const borrowCapacityUsdBigInt = BigInt(borrowCapacityUsd.toString());
  const maxAdditionalBorrowUsd = borrowCapacityUsdBigInt > debtValueUsdBigInt ? borrowCapacityUsdBigInt - debtValueUsdBigInt : 0n;
  const maxAdditionalBorrowWei =
    BigInt(market.debtAsset.priceUsd) === 0n
      ? 0n
      : (maxAdditionalBorrowUsd * 10n ** BigInt(market.debtAsset.decimals)) / BigInt(market.debtAsset.priceUsd);

  return {
    vaultId,
    owner,
    normalizedDebt: vault[1].toString(),
    debtWei: debtWei.toString(),
    debtValueUsd: debtValueUsdBigInt.toString(),
    collateralValueUsd: collateralValueUsd.toString(),
    borrowCapacityUsd: borrowCapacityUsdBigInt.toString(),
    liquidationCapacityUsd: liquidationCapacityUsd.toString(),
    maxAdditionalBorrowUsd: maxAdditionalBorrowUsd.toString(),
    maxAdditionalBorrowWei: maxAdditionalBorrowWei.toString(),
    currentBorrowRateBps: Number(currentBorrowRateBps),
    healthFactorE18: healthFactorE18.toString(),
    collaterals: collaterals.filter((item) => item.balanceWei !== "0"),
  };
}

async function fetchMarketOverview(protocol: ProtocolConfig): Promise<MarketOverview> {
  const url = new URL("/public/monitoring/market", baseUrl()).toString();
  const fromServer = await fetchOptionalJson<MarketOverview>(url);
  return fromServer ?? (await readMarketOverviewDirect(protocol));
}

async function fetchVaultSummary(protocol: ProtocolConfig, vaultId: number): Promise<VaultSummary> {
  const url = new URL(`/public/monitoring/vaults/${vaultId}`, baseUrl()).toString();
  const fromServer = await fetchOptionalJson<VaultSummary>(url);
  return fromServer ?? (await readVaultSummaryDirect(protocol, vaultId));
}

async function fetchVaultsByOwner(protocol: ProtocolConfig, owner: `0x${string}`): Promise<VaultSummary[] | undefined> {
  const url = new URL("/public/monitoring/vaults", baseUrl());
  url.searchParams.set("owner", owner);
  url.searchParams.set("limit", "25");
  return await fetchOptionalJson<VaultSummary[]>(url.toString());
}

async function fetchBorrowPreflightQuote(
  protocol: ProtocolConfig,
  input: {
    owner?: `0x${string}`;
    vaultId?: number;
    collaterals: AssistantCollateralIntent[];
    desiredBorrowWei?: string;
  }
): Promise<BorrowPreflightQuote> {
  const url = new URL("/assistant/quotes/preflight", baseUrl()).toString();
  const fromServer = await fetchOptionalJson<BorrowPreflightQuote>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (fromServer) return fromServer;

  const { publicClient } = createClients(protocol);
  const market = await fetchMarketOverview(protocol);
  const existingVault = input.vaultId ? await fetchVaultSummary(protocol, input.vaultId) : undefined;
  if (existingVault && input.owner && existingVault.owner.toLowerCase() !== input.owner.toLowerCase()) {
    throw new Error("Vault owner does not match requested owner");
  }

  const collateralMap = new Map(market.collaterals.map((item) => [item.asset.address.toLowerCase(), item]));
  const requestedCollaterals = await Promise.all(
    input.collaterals.map(async (intent) => {
      const asset = collateralMap.get(intent.asset.toLowerCase());
      if (!asset) throw new Error(`Unsupported collateral: ${intent.asset}`);
      if (!asset.config.enabled) throw new Error(`Collateral disabled: ${intent.asset}`);

      const requestedAmount = BigInt(intent.amountWei);
      const priceUsd = BigInt(asset.asset.priceUsd);
      const valueUsd = requestedAmount === 0n ? 0n : (requestedAmount * priceUsd) / (10n ** BigInt(asset.asset.decimals));
      const borrowCapacityUsd = (valueUsd * BigInt(asset.config.borrowLtvBps)) / 10_000n;
      const liquidationCapacityUsd = (valueUsd * BigInt(asset.config.liquidationThresholdBps)) / 10_000n;

      let walletBalanceWei: string | undefined;
      let withinWalletBalance: boolean | undefined;
      if (input.owner) {
        const balance = await publicClient.readContract({
          address: asset.asset.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [input.owner],
        });
        walletBalanceWei = balance.toString();
        withinWalletBalance = requestedAmount <= balance;
      }

      return {
        asset: asset.asset.address,
        symbol: asset.asset.symbol,
        decimals: asset.asset.decimals,
        requestedAmountWei: intent.amountWei,
        walletBalanceWei,
        withinWalletBalance,
        priceUsd: asset.asset.priceUsd,
        valueUsd: valueUsd.toString(),
        borrowCapacityUsd: borrowCapacityUsd.toString(),
        liquidationCapacityUsd: liquidationCapacityUsd.toString(),
        borrowLtvBps: asset.config.borrowLtvBps,
        liquidationThresholdBps: asset.config.liquidationThresholdBps,
      };
    })
  );

  const requestedCollateralValueUsd = requestedCollaterals.reduce((sum, item) => sum + BigInt(item.valueUsd), 0n);
  const requestedBorrowCapacityUsd = requestedCollaterals.reduce((sum, item) => sum + BigInt(item.borrowCapacityUsd), 0n);
  const requestedLiquidationCapacityUsd = requestedCollaterals.reduce((sum, item) => sum + BigInt(item.liquidationCapacityUsd), 0n);
  const existingDebtValueUsd = existingVault ? BigInt(existingVault.debtValueUsd) : 0n;
  const totalCollateralValueUsd = requestedCollateralValueUsd + BigInt(existingVault?.collateralValueUsd ?? "0");
  const totalBorrowCapacityUsd = requestedBorrowCapacityUsd + BigInt(existingVault?.borrowCapacityUsd ?? "0");
  const totalLiquidationCapacityUsd = requestedLiquidationCapacityUsd + BigInt(existingVault?.liquidationCapacityUsd ?? "0");
  const maxAdditionalBorrowUsd = totalBorrowCapacityUsd > existingDebtValueUsd ? totalBorrowCapacityUsd - existingDebtValueUsd : 0n;
  const debtAssetPriceUsd = BigInt(market.debtAsset.priceUsd);
  const maxAdditionalBorrowWeiByCollateral =
    debtAssetPriceUsd === 0n ? 0n : (maxAdditionalBorrowUsd * 10n ** BigInt(market.debtAsset.decimals)) / debtAssetPriceUsd;
  const poolAvailableLiquidityWei = BigInt(market.pool.availableLiquidityWei);
  const debtCapHeadroomWei =
    market.debtCapWei === "0"
      ? maxAdditionalBorrowWeiByCollateral
      : (() => {
          const cap = BigInt(market.debtCapWei);
          const totalDebt = BigInt(market.pool.totalDebtAssetsWei);
          return cap > totalDebt ? cap - totalDebt : 0n;
        })();
  const maxAdditionalBorrowWei = minBigInt(maxAdditionalBorrowWeiByCollateral, poolAvailableLiquidityWei, debtCapHeadroomWei);

  const desiredBorrow = input.desiredBorrowWei
    ? (() => {
        const amountWei = BigInt(input.desiredBorrowWei!);
        const reasons: string[] = [];
        if (amountWei > maxAdditionalBorrowWei) reasons.push("requested borrow exceeds available quoted range");
        if (!existingVault && amountWei !== 0n && amountWei < BigInt(market.minBorrowAmountWei)) {
          reasons.push("requested borrow is below market minimum for a new debt position");
        }

        const resultingDebtWei = BigInt(existingVault?.debtWei ?? "0") + amountWei;
        if (resultingDebtWei !== 0n && resultingDebtWei < BigInt(market.minDebtAmountWei)) {
          reasons.push("resulting debt would be below the minimum debt amount");
        }

        const desiredDebtValueUsd =
          debtAssetPriceUsd === 0n ? 0n : (amountWei * debtAssetPriceUsd) / (10n ** BigInt(market.debtAsset.decimals));
        const projectedDebtValueUsd = existingDebtValueUsd + desiredDebtValueUsd;
        const projectedHealthFactorE18 =
          projectedDebtValueUsd === 0n
            ? undefined
            : ((totalLiquidationCapacityUsd * 10n ** 18n) / projectedDebtValueUsd).toString();

        return {
          amountWei: input.desiredBorrowWei!,
          feasible: reasons.length === 0,
          projectedHealthFactorE18,
          reasons,
        };
      })()
    : undefined;

  return {
    owner: input.owner,
    vaultId: input.vaultId,
    debtAsset: market.debtAsset,
    existingVault: existingVault
      ? {
          owner: existingVault.owner,
          debtWei: existingVault.debtWei,
          debtValueUsd: existingVault.debtValueUsd,
          collateralValueUsd: existingVault.collateralValueUsd,
          borrowCapacityUsd: existingVault.borrowCapacityUsd,
          liquidationCapacityUsd: existingVault.liquidationCapacityUsd,
          healthFactorE18: existingVault.healthFactorE18,
        }
      : undefined,
    requestedCollaterals,
    totals: {
      requestedCollateralValueUsd: requestedCollateralValueUsd.toString(),
      totalCollateralValueUsd: totalCollateralValueUsd.toString(),
      totalBorrowCapacityUsd: totalBorrowCapacityUsd.toString(),
      totalLiquidationCapacityUsd: totalLiquidationCapacityUsd.toString(),
      currentDebtValueUsd: existingDebtValueUsd.toString(),
      maxAdditionalBorrowUsd: maxAdditionalBorrowUsd.toString(),
      maxAdditionalBorrowWei: maxAdditionalBorrowWei.toString(),
      poolAvailableLiquidityWei: poolAvailableLiquidityWei.toString(),
      debtCapHeadroomWei: debtCapHeadroomWei.toString(),
    },
    suggestedRangeWei: {
      conservative: quoteBand(maxAdditionalBorrowWei, 5_000n).toString(),
      balanced: quoteBand(maxAdditionalBorrowWei, 7_000n).toString(),
      aggressive: quoteBand(maxAdditionalBorrowWei, 8_500n).toString(),
    },
    desiredBorrow,
  };
}

async function prepareOperatorBinding(
  protocol: ProtocolConfig,
  input: { sessionId?: string; vaultId: number; operator: `0x${string}`; allowed: boolean }
) {
  const serverUrl = new URL("/assistant/bindings/prepare", baseUrl()).toString();
  const fromServer = await fetchOptionalJson<{
    binding: { bindingId: string; status: string; vaultId: number; owner: `0x${string}`; operator: `0x${string}` };
    currentlyBound: boolean;
    transaction: { to: `0x${string}`; valueWei: string; data: `0x${string}` };
  }>(serverUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: input.sessionId,
      vaultId: input.vaultId,
      operator: input.operator,
      allowed: input.allowed,
    }),
  });

  if (fromServer) return fromServer;

  const { publicClient } = createClients(protocol);
  const vault = await publicClient.readContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "vaults",
    args: [BigInt(input.vaultId)],
  });
  if (vault[0] === zeroAddress) throw new Error("Vault not found");

  const currentlyBound = await publicClient.readContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "vaultOperators",
    args: [BigInt(input.vaultId), input.operator],
  });

  return {
    binding: {
      bindingId: randomUUID(),
      status: currentlyBound && input.allowed ? "bound" : "prepared",
      vaultId: input.vaultId,
      owner: vault[0] as `0x${string}`,
      operator: input.operator,
    },
    currentlyBound,
    transaction: {
      to: protocol.vaultManager,
      valueWei: "0",
      data: encodeFunctionData({
        abi: vaultManagerAbi,
        functionName: "setVaultOperator",
        args: [BigInt(input.vaultId), input.operator, input.allowed],
      }),
    },
  };
}

async function confirmOperatorBinding(
  protocol: ProtocolConfig,
  input: { bindingId?: string; vaultId: number; operator: `0x${string}` }
) {
  const serverUrl = new URL("/assistant/bindings/confirm", baseUrl()).toString();
  const fromServer = await fetchOptionalJson<{
    binding: { bindingId: string; status: string; vaultId: number; owner: `0x${string}`; operator: `0x${string}` };
    bound: boolean;
  }>(serverUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (fromServer) return fromServer;

  const { publicClient } = createClients(protocol);
  const vault = await publicClient.readContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "vaults",
    args: [BigInt(input.vaultId)],
  });
  if (vault[0] === zeroAddress) throw new Error("Vault not found");

  const bound = await publicClient.readContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "vaultOperators",
    args: [BigInt(input.vaultId), input.operator],
  });

  return {
    binding: {
      bindingId: input.bindingId ?? randomUUID(),
      status: bound ? "bound" : "prepared",
      vaultId: input.vaultId,
      owner: vault[0] as `0x${string}`,
      operator: input.operator,
    },
    bound,
  };
}

async function ensureAllowance(options: {
  publicClient: any;
  walletClient: any;
  token: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
  requiredAmount: bigint;
  exact?: boolean;
}) {
  const currentAllowance = await options.publicClient.readContract({
    address: options.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [options.owner, options.spender],
  });

  if (currentAllowance >= options.requiredAmount) {
    return { approved: false, currentAllowance };
  }

  const targetAllowance = options.exact ? options.requiredAmount : maxUint256;
  const hashes: `0x${string}`[] = [];

  if (currentAllowance !== 0n) {
    const resetHash = await options.walletClient.writeContract({
      address: options.token,
      abi: erc20Abi,
      functionName: "approve",
      args: [options.spender, 0n],
      account: options.owner,
      chain: options.walletClient.chain,
    });
    hashes.push(resetHash);
    await options.publicClient.waitForTransactionReceipt({ hash: resetHash });
  }

  const approveHash = await options.walletClient.writeContract({
    address: options.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [options.spender, targetAllowance],
    account: options.owner,
    chain: options.walletClient.chain,
  });
  hashes.push(approveHash);
  await options.publicClient.waitForTransactionReceipt({ hash: approveHash });

  return { approved: true, currentAllowance, targetAllowance, hashes };
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function printMarketSummary(market: MarketOverview) {
  console.log(`Debt asset: ${market.debtAsset.symbol} (${market.debtAsset.address})`);
  console.log(`Pool: ${market.debtPool}`);
  console.log(`Vault manager: ${market.vaultManager}`);
  console.log(
    `Liquidity: ${formatAmount(BigInt(market.pool.availableLiquidityWei), market.pool.assetDecimals)} ${market.pool.assetSymbol}`
  );
  console.log(`Borrow APR: ${(market.pool.currentBorrowRateBps / 100).toFixed(2)}%`);
  console.log(`Protocol fee: ${(market.pool.treasuryFeeBps / 100).toFixed(2)}%`);
  console.log(`Wallet registry: ${market.walletRegistry ?? "permissionless"}`);
  console.log("Collaterals:");
  for (const collateral of market.collaterals) {
    console.log(
      `  ${collateral.asset.symbol} ${collateral.asset.address} | LTV ${(collateral.config.borrowLtvBps / 100).toFixed(2)}% | liq ${(collateral.config.liquidationThresholdBps / 100).toFixed(2)}% | bonus ${(collateral.config.liquidationBonusBps / 100).toFixed(2)}% | ${collateral.config.enabled ? "enabled" : "disabled"}`
    );
  }
}

function printQuoteSummary(quote: BorrowPreflightQuote) {
  console.log(`Debt asset: ${quote.debtAsset.symbol}`);
  if (quote.vaultId) console.log(`Vault: ${quote.vaultId}`);
  if (quote.owner) console.log(`Owner: ${quote.owner}`);
  console.log("Collateral inputs:");
  for (const collateral of quote.requestedCollaterals) {
    console.log(
      `  ${collateral.symbol}: ${formatAmount(BigInt(collateral.requestedAmountWei), collateral.decimals)} worth ~$${formatUsd(BigInt(collateral.valueUsd))}`
    );
  }
  console.log(`Max additional borrow: ${formatAmount(BigInt(quote.totals.maxAdditionalBorrowWei), quote.debtAsset.decimals)} ${quote.debtAsset.symbol}`);
  console.log(
    `Suggested range: conservative ${formatAmount(BigInt(quote.suggestedRangeWei.conservative), quote.debtAsset.decimals)} | balanced ${formatAmount(BigInt(quote.suggestedRangeWei.balanced), quote.debtAsset.decimals)} | aggressive ${formatAmount(BigInt(quote.suggestedRangeWei.aggressive), quote.debtAsset.decimals)}`
  );
  if (quote.desiredBorrow) {
    const feasible = quote.desiredBorrow.feasible ? "feasible" : "not feasible";
    console.log(
      `Desired borrow: ${formatAmount(BigInt(quote.desiredBorrow.amountWei), quote.debtAsset.decimals)} ${quote.debtAsset.symbol} (${feasible})`
    );
    if (quote.desiredBorrow.projectedHealthFactorE18) {
      console.log(`Projected health factor: ${formatHealthFactor(BigInt(quote.desiredBorrow.projectedHealthFactorE18))}`);
    }
    if (quote.desiredBorrow.reasons.length > 0) {
      console.log(`Reasons: ${quote.desiredBorrow.reasons.join("; ")}`);
    }
  }
}

function printVaultSummary(vault: VaultSummary, debtAsset: AssetSnapshot) {
  console.log(`Vault ${vault.vaultId}`);
  console.log(`Owner: ${vault.owner}`);
  if (vault.operators && vault.operators.length > 0) {
    console.log(`Operators: ${vault.operators.join(", ")}`);
  }
  console.log(`Debt: ${formatAmount(BigInt(vault.debtWei), debtAsset.decimals)} ${debtAsset.symbol}`);
  console.log(`Debt value: ~$${formatUsd(BigInt(vault.debtValueUsd))}`);
  console.log(`Collateral value: ~$${formatUsd(BigInt(vault.collateralValueUsd))}`);
  console.log(`Borrow capacity: ~$${formatUsd(BigInt(vault.borrowCapacityUsd))}`);
  console.log(`Liquidation capacity: ~$${formatUsd(BigInt(vault.liquidationCapacityUsd))}`);
  console.log(`Health factor: ${formatHealthFactor(BigInt(vault.healthFactorE18))}`);
  console.log(`Borrow rate: ${(vault.currentBorrowRateBps / 100).toFixed(2)}%`);
  if (vault.collaterals.length > 0) {
    console.log("Collaterals:");
    for (const collateral of vault.collaterals) {
      console.log(
        `  ${collateral.asset.symbol}: ${formatAmount(BigInt(collateral.balanceWei), collateral.asset.decimals)} worth ~$${formatUsd(BigInt(collateral.valueUsd))}`
      );
    }
  }
}

function getGasFloorWei() {
  return ENV.TABBY_MIN_GAS_WEI ? BigInt(ENV.TABBY_MIN_GAS_WEI) : defaultGasFloorWei;
}

function getWarnHealthFactor() {
  return ENV.TABBY_WARN_HEALTH_FACTOR_E18 ? BigInt(ENV.TABBY_WARN_HEALTH_FACTOR_E18) : warnHealthFactorDefault;
}

function getCriticalHealthFactor() {
  return ENV.TABBY_CRITICAL_HEALTH_FACTOR_E18 ? BigInt(ENV.TABBY_CRITICAL_HEALTH_FACTOR_E18) : criticalHealthFactorDefault;
}

async function resolveDefaultCollateralAsset(protocol: ProtocolConfig, market?: MarketOverview) {
  const fromEnv = asAddress(ENV.COLLATERAL_ASSET, "COLLATERAL_ASSET");
  if (fromEnv) return fromEnv;
  const assets = market?.collaterals.map((item) => item.asset.address) ?? protocol.collateralAssets;
  if (assets.length === 1) return assets[0];
  throw new Error("Multiple collateral assets are enabled; pass --asset explicitly");
}

async function loadTokenDecimals(protocol: ProtocolConfig, asset: `0x${string}`) {
  const { publicClient } = createClients(protocol);
  const decimals = await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }).catch(() => 18);
  return Number(decimals);
}

function parseCollateralFlags(
  values: string[],
  market: MarketOverview
): AssistantCollateralIntent[] {
  if (values.length === 0) throw new Error("Missing --collateral");
  const byAddress = new Map(market.collaterals.map((item) => [item.asset.address.toLowerCase(), item]));

  return values.map((entry) => {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new Error(`Invalid collateral entry: ${entry}`);
    const asset = asAddress(entry.slice(0, separator), "collateral asset");
    const amount = entry.slice(separator + 1);
    if (!asset || !amount) throw new Error(`Invalid collateral entry: ${entry}`);
    const collateral = byAddress.get(asset.toLowerCase());
    if (!collateral) throw new Error(`Unsupported collateral: ${asset}`);

    return {
      asset,
      amountWei: parseUnits(amount, collateral.asset.decimals).toString(),
    };
  });
}

async function commandInitWallet() {
  const existing = await (async () => {
    try {
      return await loadWallet();
    } catch {
      return undefined;
    }
  })();

  if (existing && !hasFlag("--force")) {
    printJson({ address: existing.address, walletPath: existing.path, existing: true });
    return;
  }

  const privateKey = generatePrivateKey();
  const { address, path: p } = await saveWallet(privateKey);
  printJson({ address, walletPath: p, existing: false });
}

async function commandMarket() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  if (hasFlag("--json")) {
    printJson(market);
    return;
  }
  printMarketSummary(market);
}

async function commandQuoteBorrow() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const wallet = await (async () => {
    try {
      return await loadWallet();
    } catch {
      return undefined;
    }
  })();

  const owner = asAddress(getArg("--owner"), "owner") ?? (wallet?.address as `0x${string}` | undefined);
  const vaultIdArg = getArg("--vault-id");
  const vaultId = vaultIdArg ? Number(vaultIdArg) : undefined;
  if (vaultIdArg && (!Number.isInteger(vaultId) || vaultId <= 0)) throw new Error("Invalid --vault-id");

  const desiredBorrowWei = getArg("--desired-borrow-wei")
    ? parseAmountToWei({
        amountWei: getArg("--desired-borrow-wei"),
        decimals: market.debtAsset.decimals,
        label: "desired borrow",
      }).toString()
    : getArg("--desired-borrow")
      ? parseAmountToWei({
          amount: getArg("--desired-borrow"),
          decimals: market.debtAsset.decimals,
          label: "desired borrow",
        }).toString()
      : undefined;

  const collaterals = parseCollateralFlags(getArgs("--collateral"), market);
  const quote = await fetchBorrowPreflightQuote(protocol, {
    owner,
    vaultId,
    collaterals,
    desiredBorrowWei,
  });

  if (hasFlag("--json")) {
    printJson(quote);
    return;
  }
  printQuoteSummary(quote);
}

async function commandOpenVault() {
  const protocol = await resolveProtocolConfig();
  const { wallet, account } = await loadBorrowerAccount();
  const { chain, publicClient } = createClients(protocol);
  const walletClient = createWalletClient({ account, chain, transport: http(protocol.rpcUrl) }) as any;

  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "openVault",
    args: [],
    account,
    chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  let openedVaultId: number | undefined;

  for (const log of receipt.logs as any[]) {
    if (log.address.toLowerCase() !== protocol.vaultManager.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: vaultManagerAbi,
        data: log.data,
        topics: log.topics,
      }) as any;
      if (decoded.eventName === "VaultOpened") {
        openedVaultId = Number(decoded.args.vaultId);
        break;
      }
    } catch {
      continue;
    }
  }

  if (!openedVaultId) throw new Error("Vault opened but could not decode vault id");
  await addTrackedVaultId(openedVaultId);

  printJson({
    wallet: wallet.address,
    vaultId: openedVaultId,
    txHash: hash,
  });
}

async function commandApproveCollateral() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const asset = asAddress(getArg("--asset"), "asset") ?? (await resolveDefaultCollateralAsset(protocol, market));
  const { wallet, account } = await loadBorrowerAccount();
  const { chain, publicClient } = createClients(protocol);
  const walletClient = createWalletClient({ account, chain, transport: http(protocol.rpcUrl) }) as any;

  const decimals = await loadTokenDecimals(protocol, asset);
  const amount =
    hasFlag("--max")
      ? maxUint256
      : parseAmountToWei({
          amount: getArg("--amount"),
          amountWei: getArg("--amount-wei"),
          decimals,
          label: "collateral",
        });

  const result = await ensureAllowance({
    publicClient,
    walletClient,
    token: asset,
    owner: wallet.address as `0x${string}`,
    spender: protocol.vaultManager,
    requiredAmount: amount,
    exact: !hasFlag("--max"),
  });

  printJson({
    owner: wallet.address,
    asset,
    spender: protocol.vaultManager,
    amountWei: hasFlag("--max") ? maxUint256.toString() : amount.toString(),
    ...result,
  });
}

async function commandDepositCollateral() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const asset = asAddress(getArg("--asset"), "asset") ?? (await resolveDefaultCollateralAsset(protocol, market));
  const vaultId = Number(requireArg("--vault-id"));
  if (!Number.isInteger(vaultId) || vaultId <= 0) throw new Error("Invalid --vault-id");

  const { wallet, account } = await loadBorrowerAccount();
  const vault = await fetchVaultSummary(protocol, vaultId);
  const decimals = await loadTokenDecimals(protocol, asset);
  const amount = parseAmountToWei({
    amount: getArg("--amount"),
    amountWei: getArg("--amount-wei"),
    decimals,
    label: "collateral",
  });

  const { chain, publicClient } = createClients(protocol);
  const walletClient = createWalletClient({ account, chain, transport: http(protocol.rpcUrl) }) as any;
  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "depositCollateral",
    args: [BigInt(vaultId), asset, amount],
    account,
    chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await addTrackedVaultId(vaultId);

  printJson({
    txHash: hash,
    vaultId,
    asset,
    amountWei: amount.toString(),
    wallet: wallet.address,
    owner: vault.owner,
    note:
      wallet.address.toLowerCase() === vault.owner.toLowerCase()
        ? undefined
        : "depositCollateral pulls tokens from the operator wallet, not the owner wallet",
  });
}

async function commandBorrow() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const vaultId = Number(requireArg("--vault-id"));
  if (!Number.isInteger(vaultId) || vaultId <= 0) throw new Error("Invalid --vault-id");

  const { account } = await loadBorrowerAccount();
  const vault = await fetchVaultSummary(protocol, vaultId);
  const amount = parseAmountToWei({
    amount: getArg("--amount"),
    amountWei: getArg("--amount-wei"),
    decimals: market.debtAsset.decimals,
    label: "borrow",
  });
  const receiver = asAddress(getArg("--receiver"), "receiver") ?? vault.owner;

  const { chain, publicClient } = createClients(protocol);
  const walletClient = createWalletClient({ account, chain, transport: http(protocol.rpcUrl) }) as any;
  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "borrow",
    args: [BigInt(vaultId), amount, receiver],
    account,
    chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await addTrackedVaultId(vaultId);

  printJson({
    txHash: hash,
    vaultId,
    amountWei: amount.toString(),
    receiver,
    owner: vault.owner,
  });
}

async function commandRepay() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const vaultId = Number(requireArg("--vault-id"));
  if (!Number.isInteger(vaultId) || vaultId <= 0) throw new Error("Invalid --vault-id");

  const { wallet, account } = await loadBorrowerAccount();
  const vault = await fetchVaultSummary(protocol, vaultId);
  const baseAmount =
    getArg("--amount") || getArg("--amount-wei")
      ? parseAmountToWei({
          amount: getArg("--amount"),
          amountWei: getArg("--amount-wei"),
          decimals: market.debtAsset.decimals,
          label: "repay",
        })
      : BigInt(vault.debtWei) + BigInt(vault.debtWei) / 10_000n + 1n;

  const { chain, publicClient } = createClients(protocol);
  const walletClient = createWalletClient({ account, chain, transport: http(protocol.rpcUrl) }) as any;

  let allowanceResult: unknown;
  if (!hasFlag("--no-auto-approve")) {
    allowanceResult = await ensureAllowance({
      publicClient,
      walletClient,
      token: protocol.debtAsset,
      owner: wallet.address as `0x${string}`,
      spender: protocol.vaultManager,
      requiredAmount: baseAmount,
      exact: true,
    });
  }

  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "repay",
    args: [BigInt(vaultId), baseAmount],
    account,
    chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await addTrackedVaultId(vaultId);

  printJson({
    txHash: hash,
    vaultId,
    maxAmountWei: baseAmount.toString(),
    allowance: allowanceResult,
  });
}

async function commandWithdrawCollateral() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const asset = asAddress(getArg("--asset"), "asset") ?? (await resolveDefaultCollateralAsset(protocol, market));
  const vaultId = Number(requireArg("--vault-id"));
  if (!Number.isInteger(vaultId) || vaultId <= 0) throw new Error("Invalid --vault-id");

  const { account } = await loadBorrowerAccount();
  const vault = await fetchVaultSummary(protocol, vaultId);
  const decimals = await loadTokenDecimals(protocol, asset);
  const amount = parseAmountToWei({
    amount: getArg("--amount"),
    amountWei: getArg("--amount-wei"),
    decimals,
    label: "withdraw",
  });
  const receiver = asAddress(getArg("--to"), "receiver") ?? vault.owner;

  const { chain, publicClient } = createClients(protocol);
  const walletClient = createWalletClient({ account, chain, transport: http(protocol.rpcUrl) }) as any;
  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "withdrawCollateral",
    args: [BigInt(vaultId), asset, amount, receiver],
    account,
    chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  printJson({
    txHash: hash,
    vaultId,
    asset,
    amountWei: amount.toString(),
    to: receiver,
    owner: vault.owner,
  });
}

async function commandVaultStatus() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const vaultId = Number(requireArg("--vault-id"));
  if (!Number.isInteger(vaultId) || vaultId <= 0) throw new Error("Invalid --vault-id");

  const vault = await fetchVaultSummary(protocol, vaultId);
  if (hasFlag("--json")) {
    printJson(vault);
    return;
  }
  printVaultSummary(vault, market.debtAsset);
}

async function commandMonitorVaults() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const quietOk = hasFlag("--quiet-ok");
  const jsonOut = hasFlag("--json");
  const explicitVaultIds = getArgs("--vault-id").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
  const ownerArg = asAddress(getArg("--owner"), "owner");

  const state: BorrowerState = (await tryLoadState()) ?? {};
  const wallet = await (async () => {
    try {
      return await loadWallet();
    } catch {
      return undefined;
    }
  })();

  let vaultIds = explicitVaultIds;
  if (vaultIds.length === 0 && state.trackedVaultIds && state.trackedVaultIds.length > 0) {
    vaultIds = state.trackedVaultIds;
  }
  if (vaultIds.length === 0 && (ownerArg ?? wallet?.address)) {
    const owner = (ownerArg ?? wallet?.address) as `0x${string}`;
    const listed = await fetchVaultsByOwner(protocol, owner);
    if (listed && listed.length > 0) {
      vaultIds = listed.map((item) => item.vaultId);
    }
  }

  if (vaultIds.length === 0) {
    if (jsonOut) {
      printJson({ vaults: [], alerts: [], gas: null });
    } else if (!quietOk) {
      console.log("Tabby: no tracked vaults.");
    }
    return;
  }

  const warnThreshold = getWarnHealthFactor();
  const criticalThreshold = getCriticalHealthFactor();
  const gasFloor = getGasFloorWei();
  const { publicClient } = createClients(protocol);

  const vaults = await Promise.all(vaultIds.map((vaultId) => fetchVaultSummary(protocol, vaultId)));
  const alerts: { vaultId?: number; level: "warn" | "critical" | "low-gas"; message: string }[] = [];
  const nextAlertState: Record<string, number> = {};
  const now = Math.floor(Date.now() / 1000);
  const previousAlertState = state.lastVaultAlerts ?? {};

  for (const vault of vaults) {
    const healthFactor = BigInt(vault.healthFactorE18);
    if (BigInt(vault.debtWei) === 0n) continue;

    if (healthFactor <= criticalThreshold) {
      const message = `Tabby: vault ${vault.vaultId} CRITICAL (HF ${formatHealthFactor(healthFactor)}).`;
      alerts.push({ vaultId: vault.vaultId, level: "critical", message });
      const key = `critical:${vault.vaultId}`;
      if ((previousAlertState[key] ?? 0) + notificationCooldownSeconds <= now) {
        await sendNotification(message);
        nextAlertState[key] = now;
      }
      continue;
    }

    if (healthFactor <= warnThreshold) {
      const message = `Tabby: vault ${vault.vaultId} warning (HF ${formatHealthFactor(healthFactor)}).`;
      alerts.push({ vaultId: vault.vaultId, level: "warn", message });
      const key = `warn:${vault.vaultId}`;
      if ((previousAlertState[key] ?? 0) + notificationCooldownSeconds <= now) {
        await sendNotification(message);
        nextAlertState[key] = now;
      }
    }
  }

  let gas: { address?: `0x${string}`; balanceWei: string; minGasWei: string; belowThreshold: boolean } | null = null;
  if (wallet) {
    const balance = await publicClient.getBalance({ address: wallet.address as `0x${string}` });
    gas = {
      address: wallet.address as `0x${string}`,
      balanceWei: balance.toString(),
      minGasWei: gasFloor.toString(),
      belowThreshold: balance < gasFloor,
    };

    if (balance < gasFloor) {
      const message = `Tabby: low XPL on operator wallet (${formatAmount(balance, 18)} XPL).`;
      alerts.push({ level: "low-gas", message });
      if ((state.lastLowGasAt ?? 0) + notificationCooldownSeconds <= now) {
        await sendNotification(message);
        await updateState({ lastLowGasAt: now });
      }
    }
  }

  await updateState({ lastVaultAlerts: nextAlertState });

  if (jsonOut) {
    printJson({ vaults, alerts, gas });
    return;
  }

  if (alerts.length === 0) {
    if (!quietOk) {
      console.log(`Tabby: ${vaults.length} vault(s) tracked, all healthy.`);
      if (gas) {
        console.log(`Operator gas: ${formatAmount(BigInt(gas.balanceWei), 18)} XPL`);
      }
    }
    return;
  }

  for (const alert of alerts) {
    console.log(alert.message);
  }
}

async function commandPrepareBindOperator() {
  const protocol = await resolveProtocolConfig();
  const vaultId = Number(requireArg("--vault-id"));
  if (!Number.isInteger(vaultId) || vaultId <= 0) throw new Error("Invalid --vault-id");

  const { wallet } = await loadBorrowerAccount();
  const operator = asAddress(getArg("--operator"), "operator") ?? (wallet.address as `0x${string}`);
  const sessionId = getArg("--session-id");
  const allowed = !hasFlag("--disallow");
  const payload = await prepareOperatorBinding(protocol, { sessionId, vaultId, operator, allowed });
  await addTrackedVaultId(vaultId);
  printJson(payload);
}

async function commandConfirmBindOperator() {
  const protocol = await resolveProtocolConfig();
  const vaultId = Number(requireArg("--vault-id"));
  if (!Number.isInteger(vaultId) || vaultId <= 0) throw new Error("Invalid --vault-id");

  const { wallet } = await loadBorrowerAccount();
  const operator = asAddress(getArg("--operator"), "operator") ?? (wallet.address as `0x${string}`);
  const bindingId = getArg("--binding-id");
  const payload = await confirmOperatorBinding(protocol, { bindingId, vaultId, operator });
  await addTrackedVaultId(vaultId);
  printJson(payload);
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    usage();
    return;
  }

  switch (command) {
    case "init-wallet":
      await commandInitWallet();
      return;
    case "market":
      await commandMarket();
      return;
    case "quote-borrow":
      await commandQuoteBorrow();
      return;
    case "open-vault":
      await commandOpenVault();
      return;
    case "approve-collateral":
      await commandApproveCollateral();
      return;
    case "deposit-collateral":
      await commandDepositCollateral();
      return;
    case "borrow":
      await commandBorrow();
      return;
    case "repay":
      await commandRepay();
      return;
    case "withdraw-collateral":
      await commandWithdrawCollateral();
      return;
    case "vault-status":
      await commandVaultStatus();
      return;
    case "monitor-vaults":
      await commandMonitorVaults();
      return;
    case "prepare-bind-operator":
      await commandPrepareBindOperator();
      return;
    case "confirm-bind-operator":
      await commandConfirmBindOperator();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
