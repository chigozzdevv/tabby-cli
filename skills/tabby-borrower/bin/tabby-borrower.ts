#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  http,
  formatUnits,
  parseUnits,
  decodeEventLog,
  maxUint256
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { generateSeedPhrase, walletStoreFromSeedPhrase, createViemWalletClient } from "../../lib/wdk-wallet.js";
import type { WDKWalletStore } from "../../lib/wdk-wallet.js";
import { getEnv } from "../../lib/env.js";
import { 
  vaultManagerAbi, 
  debtPoolAbi, 
  marketConfigAbi, 
  erc20Abi, 
  zeroAddress, 
  ProtocolConfig, 
  resolveProtocolConfig, 
  createClients 
} from "../../lib/protocol.js";

const ENV = getEnv();

type BorrowerState = {
  chainId?: number;
  rpcUrl?: string;
  vaultManager?: `0x${string}`;
  debtPool?: `0x${string}`;
  marketConfig?: `0x${string}`;
  debtAsset?: `0x${string}`;
  collateralAssets?: `0x${string}`[];
  trackedVaultIds?: number[];
  lastVaultAlerts?: Record<string, number>;
  lastLowGasAt?: number;
};

type AssetSnapshot = {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  priceUsd: string;
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
  collaterals: {
    asset: AssetSnapshot;
    config: {
      borrowLtvBps: number;
      liquidationThresholdBps: number;
      liquidationBonusBps: number;
      supplyCap: string;
      valueCapUsd: string;
      enabled: boolean;
    };
  }[];
  pool: PoolSnapshot;
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
  collaterals: {
    asset: AssetSnapshot;
    config: {
      borrowLtvBps: number;
      liquidationThresholdBps: number;
      liquidationBonusBps: number;
      supplyCap: string;
      valueCapUsd: string;
      enabled: boolean;
    };
    balanceWei: string;
    valueUsd: string;
  }[];
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

const priceOracleAbi = [
  { type: "function", name: "getPrice", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const defaultGasFloorWei = BigInt(ENV.TABBY_MIN_GAS_WEI ?? 10_000_000_000_000_000);
const warnHealthFactorDefault = BigInt(ENV.TABBY_WARN_HEALTH_FACTOR_E18 ?? 1_250_000_000_000_000_000);
const criticalHealthFactorDefault = BigInt(ENV.TABBY_CRITICAL_HEALTH_FACTOR_E18 ?? 1_100_000_000_000_000_000);
const notificationCooldownSeconds = 3600;

async function walletPath() {
  return path.join(os.homedir(), ".config", "tabby-borrower", "wallet.json");
}

async function statePath() {
  return path.join(os.homedir(), ".config", "tabby-borrower", "state.json");
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function loadWallet(): Promise<WDKWalletStore> {
  const p = await walletPath();
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw) as WDKWalletStore;
}

async function tryLoadWallet(): Promise<WDKWalletStore | undefined> {
  try {
    return await loadWallet();
  } catch {
    return undefined;
  }
}

async function saveWallet(seedPhrase: string) {
  const store = walletStoreFromSeedPhrase(seedPhrase);
  const p = await walletPath();
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(store, null, 2), { mode: 0o600 });
  return { address: store.address, path: p };
}

async function loadBorrowerAccount() {
  const wallet = await loadWallet();
  const account = mnemonicToAccount(wallet.seedPhrase);
  return { wallet, account };
}

async function loadState(): Promise<BorrowerState> {
  const p = await statePath();
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

async function tryLoadState(): Promise<BorrowerState | undefined> {
  try {
    return await loadState();
  } catch {
    return undefined;
  }
}

async function updateState(patch: Partial<BorrowerState>) {
  const p = await statePath();
  const current = await tryLoadState();
  const next = { ...current, ...patch };
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(next, null, 2));
}

async function addTrackedVaultId(vaultId: number) {
  const state = await tryLoadState();
  const current = state?.trackedVaultIds ?? [];
  if (current.includes(vaultId)) return;
  await updateState({ trackedVaultIds: [...current, vaultId] });
}

function baseUrl() {
  if (!ENV.TABBY_API_BASE_URL) {
    throw new Error("Missing TABBY_API_BASE_URL");
  }
  return ENV.TABBY_API_BASE_URL;
}

async function fetchOptionalJson<T>(url: string, init?: RequestInit): Promise<T | undefined> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return undefined;
    const payload = await res.json();
    return payload.ok ? (payload.data as T) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchMarketOverview(protocol: ProtocolConfig): Promise<MarketOverview> {
  const url = new URL("/public/monitoring/market", baseUrl()).toString();
  const fromServer = await fetchOptionalJson<MarketOverview>(url);
  if (fromServer) return fromServer;

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
    publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "getCollateralAssets" }).catch(() => protocol.collateralAssets),
    publicClient.readContract({ address: protocol.vaultManager, abi: vaultManagerAbi, functionName: "walletRegistry" }),
  ]);

  const readAssetSnap = async (asset: `0x${string}`) => {
    const [symbol, decimals, priceUsd] = await Promise.all([
      publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }).catch(() => "TOKEN"),
      publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
      publicClient.readContract({ address: priceOracle, abi: priceOracleAbi, functionName: "getPrice", args: [asset] }).catch(() => 0n),
    ]);
    return { address: asset, symbol: String(symbol), decimals: Number(decimals), priceUsd: priceUsd.toString() };
  };

  const debtAsset = await readAssetSnap(debtAssetAddress);
  const collaterals = await Promise.all(
    (collateralAssets as readonly `0x${string}`[]).map(async (asset) => {
      const [assetSnapshot, config] = await Promise.all([
        readAssetSnap(asset),
        publicClient.readContract({ address: protocol.marketConfig, abi: marketConfigAbi, functionName: "getCollateralConfig", args: [asset] }),
      ]);
      return {
        asset: assetSnapshot,
        config: {
          borrowLtvBps: Number(config.borrowLtvBps ?? config[0]),
          liquidationThresholdBps: Number(config.liquidationThresholdBps ?? config[1]),
          liquidationBonusBps: Number(config.liquidationBonusBps ?? config[2]),
          supplyCap: (config.supplyCap ?? config[3]).toString(),
          valueCapUsd: (config.valueCapUsd ?? config[4]).toString(),
          enabled: config.enabled ?? config[5],
        },
      };
    })
  );

  const [poolAsset, poolTotalAssets, poolAvailable, poolTotalDebt, poolTotalShares, poolUtil, poolRate, poolTreasuryFee, poolTreasuryRecip] = await Promise.all([
     publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "ASSET" }),
     publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalAssets" }),
     publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "availableLiquidity" }),
     publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalDebtAssets" }),
     publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalShares" }),
     publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "utilizationBps" }),
     publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "currentBorrowRateBps" }),
     publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "treasuryFeeBps" }),
     publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "treasuryFeeRecipient" }),
  ]);

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
    pauseFlags: { lpDepositPaused, lpWithdrawPaused, collateralDepositPaused, collateralWithdrawPaused, borrowPaused, liquidationPaused },
    rateModel: {
      baseRateBps: Number(rateModel[0]),
      kinkUtilizationBps: Number(rateModel[1]),
      slope1Bps: Number(rateModel[2]),
      slope2Bps: Number(rateModel[3]),
      minRateBps: Number(rateModel[4]),
      maxRateBps: Number(rateModel[5]),
    },
    collaterals,
    pool: {
      asset: poolAsset,
      assetSymbol: debtAsset.symbol,
      assetDecimals: debtAsset.decimals,
      walletRegistry: null,
      treasuryFeeBps: Number(poolTreasuryFee),
      treasuryFeeRecipient: poolTreasuryRecip === zeroAddress ? null : poolTreasuryRecip,
      totalAssetsWei: poolTotalAssets.toString(),
      availableLiquidityWei: poolAvailable.toString(),
      totalDebtAssetsWei: poolTotalDebt.toString(),
      totalShares: poolTotalShares.toString(),
      utilizationBps: Number(poolUtil),
      currentBorrowRateBps: Number(poolRate),
      liquidityIndexRay: "0",
      borrowIndexRay: "0",
      lastAccruedAt: 0,
    },
  };
}

async function fetchVaultSummary(protocol: ProtocolConfig, vaultId: number): Promise<VaultSummary> {
  const url = new URL(`/public/monitoring/vaults/${vaultId}`, baseUrl()).toString();
  const fromServer = await fetchOptionalJson<VaultSummary>(url);
  if (fromServer) return fromServer;

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
      fetchMarketOverview(protocol),
    ]);

  const owner = vault[0];
  if (owner === zeroAddress) throw new Error(`Vault ${vaultId} not found`);

  const collaterals = await Promise.all(
    (collateralAssets as readonly `0x${string}`[]).map(async (asset) => {
      const balanceWei = await publicClient.readContract({
          address: protocol.vaultManager,
          abi: vaultManagerAbi,
          functionName: "collateralBalances",
          args: [BigInt(vaultId), asset],
      });
      const assetConfig = market.collaterals.find((item) => item.asset.address.toLowerCase() === asset.toLowerCase())!;
      const valueUsd = (balanceWei * BigInt(assetConfig.asset.priceUsd)) / (10n ** BigInt(assetConfig.asset.decimals));

      return {
        asset: assetConfig.asset,
        config: assetConfig.config,
        balanceWei: balanceWei.toString(),
        valueUsd: valueUsd.toString(),
      };
    })
  );

  return {
    vaultId,
    owner,
    normalizedDebt: vault[1].toString(),
    debtWei: debtWei.toString(),
    debtValueUsd: debtValueUsd.toString(),
    collateralValueUsd: collateralValueUsd.toString(),
    borrowCapacityUsd: borrowCapacityUsd.toString(),
    liquidationCapacityUsd: liquidationCapacityUsd.toString(),
    maxAdditionalBorrowUsd: (BigInt(borrowCapacityUsd) - BigInt(debtValueUsd) > 0n ? BigInt(borrowCapacityUsd) - BigInt(debtValueUsd) : 0n).toString(),
    maxAdditionalBorrowWei: "0",
    currentBorrowRateBps: Number(currentBorrowRateBps),
    healthFactorE18: healthFactorE18.toString(),
    collaterals: collaterals.filter((item) => item.balanceWei !== "0"),
  };
}

async function fetchVaultsByOwner(protocol: ProtocolConfig, owner: `0x${string}`): Promise<VaultSummary[] | undefined> {
  const url = new URL("/public/monitoring/vaults", baseUrl());
  url.searchParams.set("owner", owner);
  url.searchParams.set("limit", "25");
  return await fetchOptionalJson<VaultSummary[]>(url.toString());
}

async function fetchBorrowPreflightQuote(protocol: ProtocolConfig, input: any): Promise<BorrowPreflightQuote> {
  const url = new URL("/assistant/quotes/preflight", baseUrl()).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`Failed to fetch borrow quote (${res.status})`);
  }

  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.message ?? payload?.error ?? `Failed to fetch borrow quote (${res.status})`);
  }

  return payload.data as BorrowPreflightQuote;
}

async function prepareOperatorBinding(protocol: ProtocolConfig, input: any) {
  const url = new URL("/assistant/bindings/prepare", baseUrl()).toString();
  return await fetchOptionalJson<any>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function confirmOperatorBinding(protocol: ProtocolConfig, input: any) {
  const url = new URL("/assistant/bindings/confirm", baseUrl()).toString();
  return await fetchOptionalJson<any>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
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
    return { approved: false, currentAllowance: currentAllowance.toString() };
  }

  const targetAllowance = options.exact ? options.requiredAmount : maxUint256;
  const hash = await options.walletClient.writeContract({
    address: options.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [options.spender, targetAllowance],
    account: options.owner,
  });
  await options.publicClient.waitForTransactionReceipt({ hash });

  return { approved: true, currentAllowance: currentAllowance.toString(), targetAllowance: targetAllowance.toString(), hash };
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function formatAmount(wei: bigint, decimals: number) {
    return formatUnits(wei, decimals);
}

function formatUsd(val: bigint) {
    return (Number(val) / 10**18).toFixed(2);
}

function formatHealthFactor(hf: bigint) {
    return (Number(hf) / 10**18).toFixed(2);
}

function formatDisplayAmount(value: bigint | string, decimals: number) {
  const normalized = Number(formatUnits(typeof value === "string" ? BigInt(value) : value, decimals));
  if (!Number.isFinite(normalized)) {
    return formatUnits(typeof value === "string" ? BigInt(value) : value, decimals);
  }
  if (normalized >= 1_000_000) return `${(normalized / 1_000_000).toFixed(2)}M`;
  if (normalized >= 1_000) return `${(normalized / 1_000).toFixed(1)}K`;
  return normalized.toFixed(normalized < 1 ? 4 : 2);
}

function collateralCapacityWei(quote: BorrowPreflightQuote) {
  const priceUsd = BigInt(quote.debtAsset.priceUsd);
  if (priceUsd === 0n) return 0n;
  return (BigInt(quote.totals.maxAdditionalBorrowUsd) * 10n ** BigInt(quote.debtAsset.decimals)) / priceUsd;
}

function quoteConstraintText(quote: BorrowPreflightQuote) {
  const borrowableNowWei = BigInt(quote.totals.maxAdditionalBorrowWei);
  const poolAvailableLiquidityWei = BigInt(quote.totals.poolAvailableLiquidityWei);
  const debtCapHeadroomWei = BigInt(quote.totals.debtCapHeadroomWei);

  if (borrowableNowWei > 0n) return null;
  if (poolAvailableLiquidityWei === 0n && debtCapHeadroomWei === 0n) {
    return "No USDT0 is borrowable right now because pool liquidity is empty and the market debt cap has no headroom.";
  }
  if (poolAvailableLiquidityWei === 0n) {
    return "No USDT0 is borrowable right now because the pool has no available liquidity.";
  }
  if (debtCapHeadroomWei === 0n) {
    return "No USDT0 is borrowable right now because the market debt cap is fully used.";
  }
  return "Current borrowable amount is constrained by pool liquidity or market limits.";
}

function buildQuoteSummaryText(quote: BorrowPreflightQuote) {
  const collateral = quote.requestedCollaterals[0];
  const ltv = collateral ? `${(collateral.borrowLtvBps / 100).toFixed(2)}%` : "0.00%";
  const amountLabel =
    quote.requestedCollaterals.length === 1 && collateral
      ? `${formatDisplayAmount(collateral.requestedAmountWei, collateral.decimals)} ${collateral.symbol}`
      : "the selected collateral";

  const borrowableNowWei = BigInt(quote.totals.maxAdditionalBorrowWei);
  const capacityWei = collateralCapacityWei(quote);
  const constraint = quoteConstraintText(quote);

  if (borrowableNowWei === 0n && capacityWei > 0n) {
    return `With ${amountLabel} you have ${formatDisplayAmount(capacityWei, quote.debtAsset.decimals)} ${quote.debtAsset.symbol} of collateral capacity at ${ltv}, but 0 ${quote.debtAsset.symbol} is borrowable right now. ${constraint}`;
  }

  return `With ${amountLabel} you can borrow up to ${formatDisplayAmount(borrowableNowWei, quote.debtAsset.decimals)} ${quote.debtAsset.symbol} at ${ltv}.`;
}

function buildAssistantQuoteResponse(quote: BorrowPreflightQuote) {
  return {
    text: buildQuoteSummaryText(quote),
    isQuote: true,
    isPosition: false,
    isPool: false,
    isAction: false,
    quote,
    position: null,
    pool: null,
    action: null,
  };
}

function buildAssistantVaultStatusText(vault: VaultSummary, debtAsset: AssetSnapshot) {
  const debtAmount = formatDisplayAmount(vault.debtWei, debtAsset.decimals);
  const collateralValueUsd = formatUsd(BigInt(vault.collateralValueUsd));
  const healthFactor = formatHealthFactor(BigInt(vault.healthFactorE18));
  return `Vault #${vault.vaultId} has ${debtAmount} ${debtAsset.symbol} debt, about $${collateralValueUsd} of collateral value, and a health factor of ${healthFactor}.`;
}

function buildAssistantVaultStatusResponse(vault: VaultSummary, debtAsset: AssetSnapshot) {
  return {
    text: buildAssistantVaultStatusText(vault, debtAsset),
    isQuote: false,
    isPosition: true,
    isPool: false,
    isAction: false,
    quote: null,
    position: vault,
    pool: null,
    action: null,
  };
}

function printMarketSummary(market: MarketOverview) {
  console.log(`Debt asset: ${market.debtAsset.symbol} (${market.debtAsset.address})`);
  console.log(`Pool: ${market.debtPool}`);
  console.log(`Utilization: ${(market.pool.utilizationBps / 100).toFixed(2)}%`);
  console.log(`Borrow APR: ${(market.pool.currentBorrowRateBps / 100).toFixed(2)}%`);
  console.log("Collaterals:");
  for (const collateral of market.collaterals) {
    console.log(`  ${collateral.asset.symbol} | LTV ${(collateral.config.borrowLtvBps / 100).toFixed(2)}% | liq ${(collateral.config.liquidationThresholdBps / 100).toFixed(2)}%`);
  }
}

function printQuoteSummary(quote: BorrowPreflightQuote) {
  console.log(`Debt asset: ${quote.debtAsset.symbol}`);
  console.log(`Max additional borrow: ${formatAmount(BigInt(quote.totals.maxAdditionalBorrowWei), quote.debtAsset.decimals)} ${quote.debtAsset.symbol}`);
}

function printVaultSummary(vault: VaultSummary, debtAsset: AssetSnapshot) {
  console.log(`Vault ${vault.vaultId} (Owner: ${vault.owner})`);
  console.log(`Debt: ${formatAmount(BigInt(vault.debtWei), debtAsset.decimals)} ${debtAsset.symbol} (~$${formatUsd(BigInt(vault.debtValueUsd))})`);
  console.log(`Collateral value: ~$${formatUsd(BigInt(vault.collateralValueUsd))}`);
  console.log(`Health factor: ${formatHealthFactor(BigInt(vault.healthFactorE18))}`);
}

function getArg(name: string) {
    const idx = process.argv.indexOf(name);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function getArgs(name: string) {
    const results: string[] = [];
    for (let i = 0; i < process.argv.length; i++) {
        if (process.argv[i] === name) results.push(process.argv[i+1]);
    }
    return results;
}

function requireArg(name: string) {
    const val = getArg(name);
    if (!val) throw new Error(`Missing ${name}`);
    return val;
}

function hasFlag(name: string) {
    return process.argv.includes(name);
}

function asAddress(val: string | undefined, label: string): `0x${string}` | undefined {
    if (!val) return undefined;
    if (!val.startsWith("0x")) throw new Error(`Invalid ${label} address`);
    return val as `0x${string}`;
}

function parseAmountToWei(opts: { amount?: string, amountWei?: string, decimals: number, label: string }) {
    if (opts.amountWei) return BigInt(opts.amountWei);
    if (opts.amount) return parseUnits(opts.amount, opts.decimals);
    throw new Error(`Missing amount for ${opts.label}`);
}

async function loadTokenDecimals(protocol: ProtocolConfig, asset: `0x${string}`) {
    const { publicClient } = createClients(protocol);
    return Number(await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }));
}

async function resolveDefaultCollateralAsset(protocol: ProtocolConfig, market?: MarketOverview) {
    return asAddress(ENV.COLLATERAL_ASSET, "COLLATERAL_ASSET") ?? protocol.collateralAssets[0];
}

async function sendNotification(message: string) {
    console.log(`NOTIFICATION: ${message}`);
}

async function commandInitWallet() {
  const seedPhrase = generateSeedPhrase();
  const { address, path } = await saveWallet(seedPhrase);
  printJson({ address, path, ok: true });
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
  const collateralArgs = getArgs("--collateral");

  if (collateralArgs.length === 0) {
    throw new Error("Missing --collateral <asset:amount>");
  }

  const collaterals: AssistantCollateralIntent[] = collateralArgs.map((raw) => {
    const [assetRef, amount] = raw.split(":");
    if (!assetRef || !amount) {
      throw new Error(`Invalid collateral input '${raw}'. Use <symbol-or-address>:<amount>.`);
    }

    const collateral = market.collaterals.find(
      (item) =>
        item.asset.address.toLowerCase() === assetRef.toLowerCase() ||
        item.asset.symbol.toLowerCase() === assetRef.toLowerCase()
    );

    if (!collateral) {
      throw new Error(`Unsupported collateral '${assetRef}'. Run market to list supported assets.`);
    }

    return {
      asset: collateral.asset.address,
      amountWei: parseUnits(amount, collateral.asset.decimals).toString(),
    };
  });

  const desiredBorrow = getArg("--desired-borrow");
  const desiredBorrowWei = getArg("--desired-borrow-wei")
    ?? (desiredBorrow ? parseUnits(desiredBorrow, market.debtAsset.decimals).toString() : undefined);

  const quote = await fetchBorrowPreflightQuote(protocol, {
    collaterals,
    desiredBorrowWei,
  });

  printJson(quote);
}

async function commandAssistantQuote() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const collateralArgs = getArgs("--collateral");

  if (collateralArgs.length === 0) {
    throw new Error("Missing --collateral <asset:amount>");
  }

  const collaterals: AssistantCollateralIntent[] = collateralArgs.map((raw) => {
    const [assetRef, amount] = raw.split(":");
    if (!assetRef || !amount) {
      throw new Error(`Invalid collateral input '${raw}'. Use <symbol-or-address>:<amount>.`);
    }

    const collateral = market.collaterals.find(
      (item) =>
        item.asset.address.toLowerCase() === assetRef.toLowerCase() ||
        item.asset.symbol.toLowerCase() === assetRef.toLowerCase()
    );

    if (!collateral) {
      throw new Error(`Unsupported collateral '${assetRef}'. Run market to list supported assets.`);
    }

    return {
      asset: collateral.asset.address,
      amountWei: parseUnits(amount, collateral.asset.decimals).toString(),
    };
  });

  const desiredBorrow = getArg("--desired-borrow");
  const desiredBorrowWei = getArg("--desired-borrow-wei")
    ?? (desiredBorrow ? parseUnits(desiredBorrow, market.debtAsset.decimals).toString() : undefined);

  const quote = await fetchBorrowPreflightQuote(protocol, {
    collaterals,
    desiredBorrowWei,
  });

  printJson(buildAssistantQuoteResponse(quote));
}

async function commandOpenVault() {
  const protocol = await resolveProtocolConfig();
  const { wallet, account } = await loadBorrowerAccount();
  const { chain, publicClient } = createClients(protocol);
  const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;

  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "openVault",
    args: [],
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
    } catch { continue; }
  }

  if (!openedVaultId) throw new Error("Vault opened but could not decode vault id");
  await addTrackedVaultId(openedVaultId);
  printJson({ vaultId: openedVaultId, txHash: hash });
}

async function commandApproveCollateral() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const asset = asAddress(getArg("--asset"), "asset") ?? (await resolveDefaultCollateralAsset(protocol, market));
  const { wallet, account } = await loadBorrowerAccount();
  const decimals = await loadTokenDecimals(protocol, asset);
  const amount = parseAmountToWei({ amount: getArg("--amount"), amountWei: getArg("--amount-wei"), decimals, label: "approval" });

  const { chain, publicClient } = createClients(protocol);
  const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;

  const result = await ensureAllowance({ publicClient, walletClient, token: asset, owner: wallet.address as `0x${string}`, spender: protocol.vaultManager, requiredAmount: amount });
  printJson({ ok: true, txHash: result.hash, asset, spender: protocol.vaultManager });
}

async function commandDepositCollateral() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const asset = asAddress(getArg("--asset"), "asset") ?? (await resolveDefaultCollateralAsset(protocol, market));
  const vaultId = Number(requireArg("--vault-id"));
  const { wallet, account } = await loadBorrowerAccount();
  const decimals = await loadTokenDecimals(protocol, asset);
  const amount = parseAmountToWei({ amount: getArg("--amount"), amountWei: getArg("--amount-wei"), decimals, label: "collateral" });

  const { chain, publicClient } = createClients(protocol);
  const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;
  
  await ensureAllowance({ publicClient, walletClient, token: asset, owner: account.address, spender: protocol.vaultManager, requiredAmount: amount });

  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "depositCollateral",
    args: [BigInt(vaultId), asset, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await addTrackedVaultId(vaultId);
  printJson({ txHash: hash, vaultId, asset, amountWei: amount.toString() });
}

async function commandBorrow() {
  const protocol = await resolveProtocolConfig();
  const vaultId = Number(requireArg("--vault-id"));
  const { wallet, account } = await loadBorrowerAccount();
  const market = await fetchMarketOverview(protocol);
  const amount = parseAmountToWei({ amount: getArg("--amount"), amountWei: getArg("--amount-wei"), decimals: market.debtAsset.decimals, label: "borrow" });
  const receiver = asAddress(getArg("--receiver"), "receiver") ?? wallet.address;

  const { chain, publicClient } = createClients(protocol);
  const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;
  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "borrow",
    args: [BigInt(vaultId), amount, receiver],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  printJson({ txHash: hash, vaultId, amountWei: amount.toString(), receiver });
}

async function commandRepay() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const vaultId = Number(requireArg("--vault-id"));
  const { wallet, account } = await loadBorrowerAccount();
  const vault = await fetchVaultSummary(protocol, vaultId);
  const amountArg = getArg("--amount");
  const amount = (amountArg === "all") 
    ? BigInt(vault.debtWei)
    : parseAmountToWei({ amount: amountArg, amountWei: getArg("--amount-wei"), decimals: market.debtAsset.decimals, label: "repay" });

  const { chain, publicClient } = createClients(protocol);
  const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;

  await ensureAllowance({ publicClient, walletClient, token: protocol.debtAsset, owner: wallet.address as `0x${string}`, spender: protocol.vaultManager, requiredAmount: amount });

  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "repay",
    args: [BigInt(vaultId), amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  printJson({ txHash: hash, vaultId, amountWei: amount.toString() });
}

async function commandWithdrawCollateral() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const asset = asAddress(getArg("--asset"), "asset") ?? (await resolveDefaultCollateralAsset(protocol, market));
  const vaultId = Number(requireArg("--vault-id"));
  const { wallet, account } = await loadBorrowerAccount();
  const decimals = await loadTokenDecimals(protocol, asset);
  const amountArg = getArg("--amount");
  let amount: bigint;
  if (amountArg === "all") {
    const vault = await fetchVaultSummary(protocol, vaultId);
    const collat = vault.collaterals.find(c => c.asset.address.toLowerCase() === asset.toLowerCase());
    if (!collat) throw new Error("No collateral balance for this asset in vault");
    amount = BigInt(collat.balanceWei);
  } else {
    amount = parseAmountToWei({ amount: amountArg, amountWei: getArg("--amount-wei"), decimals, label: "withdraw" });
  }
  const receiver = asAddress(getArg("--to"), "receiver") ?? wallet.address;

  const { chain, publicClient } = createClients(protocol);
  const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;
  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "withdrawCollateral",
    args: [BigInt(vaultId), asset, amount, receiver],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  printJson({ txHash: hash, vaultId, asset, amountWei: amount.toString(), to: receiver });
}

async function commandLiquidate() {
  const protocol = await resolveProtocolConfig();
  const vaultId = Number(requireArg("--vault-id"));
  const market = await fetchMarketOverview(protocol);
  const asset = asAddress(getArg("--asset"), "asset") ?? (await resolveDefaultCollateralAsset(protocol, market));
  const { wallet, account } = await loadBorrowerAccount();
  const decimals = market.debtAsset.decimals;
  const amount = parseAmountToWei({ amount: getArg("--amount"), amountWei: getArg("--amount-wei"), decimals, label: "liquidation repay" });

  const { chain, publicClient } = createClients(protocol);
  const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;

  await ensureAllowance({ publicClient, walletClient, token: protocol.debtAsset, owner: account.address as `0x${string}`, spender: protocol.vaultManager, requiredAmount: amount });

  const hash = await walletClient.writeContract({
    address: protocol.vaultManager,
    abi: vaultManagerAbi,
    functionName: "liquidate",
    args: [BigInt(vaultId), asset, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  printJson({ txHash: hash, vaultId, collateralAsset: asset, repaidAmountWei: amount.toString() });
}

async function commandVaultStatus() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const vaultId = Number(requireArg("--vault-id"));
  const vault = await fetchVaultSummary(protocol, vaultId);
  if (hasFlag("--json")) {
    printJson(vault);
    return;
  }
  printVaultSummary(vault, market.debtAsset);
}

async function commandAssistantVaultStatus() {
  const protocol = await resolveProtocolConfig();
  const market = await fetchMarketOverview(protocol);
  const vaultId = Number(requireArg("--vault-id"));
  const vault = await fetchVaultSummary(protocol, vaultId);
  printJson(buildAssistantVaultStatusResponse(vault, market.debtAsset));
}

async function commandMonitorVaults() {
  const protocol = await resolveProtocolConfig();
  const state = await tryLoadState();
  const trackedIds = state?.trackedVaultIds ?? [];
  
  if (trackedIds.length === 0) {
    if (!hasFlag("--quiet-ok")) {
      console.log("No vaults tracked for monitoring.");
    }
    return;
  }

  const market = await fetchMarketOverview(protocol);
  const results = [];

  for (const vaultId of trackedIds) {
    try {
      const vault = await fetchVaultSummary(protocol, vaultId);
      const hf = BigInt(vault.healthFactorE18);
      
      let status = "HEALTHY";
      if (hf < criticalHealthFactorDefault) status = "CRITICAL";
      else if (hf < warnHealthFactorDefault) status = "WARNING";

      results.push({
        vaultId,
        healthFactor: formatHealthFactor(hf),
        status,
        debtUsd: formatUsd(BigInt(vault.debtValueUsd)),
      });

      if (status !== "HEALTHY") {
        await sendNotification(`Vault ${vaultId} status: ${status} (HF: ${formatHealthFactor(hf)})`);
      }
    } catch (err: any) {
      console.error(`Failed to monitor vault ${vaultId}: ${err.message}`);
    }
  }

  const walletRes = await tryLoadWallet();
  if (walletRes) {
    const { publicClient } = createClients(protocol);
    const balance = await publicClient.getBalance({ address: walletRes.address });
    if (balance < defaultGasFloorWei) {
      await sendNotification(`Low gas balance on ${walletRes.address}: ${formatUnits(balance, 18)} XPL`);
    }
  }

  if (hasFlag("--json")) {
    printJson({ vaults: results });
  } else {
    if (results.length > 0) {
      console.table(results);
    }
  }
}

async function commandPrepareBindOperator() {
  const protocol = await resolveProtocolConfig();
  const vaultId = Number(requireArg("--vault-id"));
  const { wallet } = await loadBorrowerAccount();
  
  const url = new URL("/assistant/bindings/prepare", baseUrl()).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vaultId,
      operator: wallet.address,
      allowed: true
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Failed to prepare binding: ${err.message || res.statusText}`);
  }

  const payload = await res.json();
  if (!payload.ok) throw new Error(payload.message || "Failed to prepare binding");

  const data = payload.data;
  console.log(`Binding prepared for Vault ${vaultId}.`);
  console.log(`Please sign the following transaction with the Vault Owner wallet:`);
  console.log(JSON.stringify(data.transaction, null, 2));
  if (data.binding.bindingId) {
    console.log(`Binding ID: ${data.binding.bindingId}`);
  }
}

async function commandConfirmBindOperator() {
  const protocol = await resolveProtocolConfig();
  const vaultId = Number(requireArg("--vault-id"));
  const { wallet } = await loadBorrowerAccount();
  const bindingId = getArg("--binding-id");

  const url = new URL("/assistant/bindings/confirm", baseUrl()).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vaultId,
      operator: wallet.address,
      bindingId
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Failed to confirm binding: ${err.message || res.statusText}`);
  }

  const payload = await res.json();
  if (!payload.ok) throw new Error(payload.message || "Failed to confirm binding");

  console.log(`Binding confirmed! Asset is now authorized as operator for Vault ${vaultId}. Status: ${payload.data.status}`);
}

function usage() {
  console.log(`
tabby-borrower <command>

Commands:
  init-wallet
  market [--json]
  quote-borrow --collateral <asset:amount> [--collateral <asset:amount> ...] [--desired-borrow <n>] [--desired-borrow-wei <wei>]
  assistant-quote --collateral <asset:amount> [--collateral <asset:amount> ...] [--desired-borrow <n>] [--desired-borrow-wei <wei>]
  open-vault
  approve-collateral --amount <n> [--asset <addr>]
  deposit-collateral --vault-id <id> --amount <n> [--asset <addr>]
  borrow --vault-id <id> --amount <n> [--receiver <addr>]
  repay --vault-id <id> --amount <n|all>
  withdraw-collateral --vault-id <id> --amount <n|all> [--asset <addr>] [--to <addr>]
  vault-status --vault-id <id> [--json]
  assistant-vault-status --vault-id <id>
  monitor-vaults [--json]
  liquidate --vault-id <id> --amount <n> [--asset <addr>]
  prepare-bind-operator --vault-id <id>
  confirm-bind-operator --vault-id <id> [--binding-id <id>]
`);
}

async function main() {
  const command = process.argv[2];
  if (!command) { usage(); return; }

  switch (command) {
    case "init-wallet": await commandInitWallet(); break;
    case "market": await commandMarket(); break;
    case "quote-borrow": await commandQuoteBorrow(); break;
    case "assistant-quote": await commandAssistantQuote(); break;
    case "open-vault": await commandOpenVault(); break;
    case "approve-collateral": await commandApproveCollateral(); break;
    case "deposit-collateral": await commandDepositCollateral(); break;
    case "borrow": await commandBorrow(); break;
    case "repay": await commandRepay(); break;
    case "withdraw-collateral": await commandWithdrawCollateral(); break;
    case "vault-status": await commandVaultStatus(); break;
    case "assistant-vault-status": await commandAssistantVaultStatus(); break;
    case "monitor-vaults": await commandMonitorVaults(); break;
    case "liquidate": await commandLiquidate(); break;
    case "prepare-bind-operator": await commandPrepareBindOperator(); break;
    case "confirm-bind-operator": await commandConfirmBindOperator(); break;
    default: usage();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
