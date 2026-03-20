import { z } from "zod";
import { getDb } from "@/db/mongodb.js";
import { HttpError } from "@/shared/http-errors.js";
import { env } from "@/config/env.js";
import { publicClient } from "@/shared/viem.js";
import {
  debtPoolAbi,
  erc20MetadataAbi,
  marketConfigAbi,
  priceOracleAbi,
  vaultManagerAbi,
} from "@/shared/protocol.js";
import type {
  AssetSnapshot,
  CollateralConfigSnapshot,
  MarketCollateralSnapshot,
  MarketOverview,
  OracleFeedSnapshot,
  VaultCollateralSnapshot,
  VaultSummary,
} from "@/features/monitoring/monitoring.types.js";

const ownerListQuerySchema = z.object({
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

type ActivityEventLookupDoc = {
  type: string;
  owner?: string;
  account?: string;
  vaultId?: number;
  payload?: Record<string, unknown>;
  createdAt: Date;
};

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;

async function getAssetSnapshot(asset: `0x${string}`): Promise<AssetSnapshot> {
  const [symbol, decimals, priceUsd] = await Promise.all([
    publicClient.readContract({ address: asset, abi: erc20MetadataAbi, functionName: "symbol" }).catch(() => "TOKEN"),
    publicClient.readContract({ address: asset, abi: erc20MetadataAbi, functionName: "decimals" }).catch(() => 18),
    publicClient.readContract({
      address: env.PRICE_ORACLE_ADDRESS as `0x${string}`,
      abi: priceOracleAbi,
      functionName: "getPrice",
      args: [asset],
    }),
  ]);

  return {
    address: asset,
    symbol: String(symbol),
    decimals: Number(decimals),
    priceUsd: priceUsd.toString(),
  };
}

async function getOracleFeedSnapshot(asset: `0x${string}`): Promise<OracleFeedSnapshot> {
  const [feedConfig, aliasAsset] = await Promise.all([
    publicClient.readContract({
      address: env.PRICE_ORACLE_ADDRESS as `0x${string}`,
      abi: priceOracleAbi,
      functionName: "feeds",
      args: [asset],
    }),
    publicClient.readContract({
      address: env.PRICE_ORACLE_ADDRESS as `0x${string}`,
      abi: priceOracleAbi,
      functionName: "aliases",
      args: [asset],
    }),
  ]);

  return {
    feed: feedConfig[0] === zeroAddress ? null : feedConfig[0],
    maxAgeSeconds: Number(feedConfig[1]),
    enabled: Boolean(feedConfig[2]),
    aliasAsset: aliasAsset === zeroAddress ? null : aliasAsset,
  };
}

function toCollateralConfigSnapshot(config: {
  borrowLtvBps: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  supplyCap: bigint;
  valueCapUsd: bigint;
  enabled: boolean;
}): CollateralConfigSnapshot {
  return {
    borrowLtvBps: Number(config.borrowLtvBps),
    liquidationThresholdBps: Number(config.liquidationThresholdBps),
    liquidationBonusBps: Number(config.liquidationBonusBps),
    supplyCap: config.supplyCap.toString(),
    valueCapUsd: config.valueCapUsd.toString(),
    enabled: config.enabled,
  };
}

async function getMarketCollateralSnapshot(asset: `0x${string}`): Promise<MarketCollateralSnapshot> {
  const [assetSnapshot, oracle, config] = await Promise.all([
    getAssetSnapshot(asset),
    getOracleFeedSnapshot(asset),
    publicClient.readContract({
      address: env.MARKET_CONFIG_ADDRESS as `0x${string}`,
      abi: marketConfigAbi,
      functionName: "getCollateralConfig",
      args: [asset],
    }),
  ]);

  return {
    asset: assetSnapshot,
    oracle,
    config: toCollateralConfigSnapshot(config),
  };
}

async function getActiveVaultOperators(vaultId: number): Promise<`0x${string}`[]> {
  const db = getDb();
  const events = db.collection<ActivityEventLookupDoc>("activity-events");
  const docs = await events
    .find(
      { vaultId, type: "vault.operator-updated" },
      { projection: { account: 1, payload: 1, createdAt: 1 }, sort: { createdAt: 1 } }
    )
    .toArray();

  const allowed = new Set<string>();
  for (const doc of docs) {
    const account = doc.account?.toLowerCase();
    if (!account) continue;
    const isAllowed = Boolean(doc.payload?.allowed);
    if (isAllowed) allowed.add(account);
    else allowed.delete(account);
  }

  return Array.from(allowed) as `0x${string}`[];
}

async function getVaultCollateralSnapshot(vaultId: number, asset: `0x${string}`): Promise<VaultCollateralSnapshot> {
  const [assetSnapshot, oracle, config, balanceWei] = await Promise.all([
    getAssetSnapshot(asset),
    getOracleFeedSnapshot(asset),
    publicClient.readContract({
      address: env.MARKET_CONFIG_ADDRESS as `0x${string}`,
      abi: marketConfigAbi,
      functionName: "getCollateralConfig",
      args: [asset],
    }),
    publicClient.readContract({
      address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
      abi: vaultManagerAbi,
      functionName: "collateralBalances",
      args: [BigInt(vaultId), asset],
    }),
  ]);

  const valueUsd = balanceWei === 0n ? 0n : (balanceWei * BigInt(assetSnapshot.priceUsd)) / (10n ** BigInt(assetSnapshot.decimals));

  return {
    asset: assetSnapshot,
    oracle,
    config: toCollateralConfigSnapshot(config),
    balanceWei: balanceWei.toString(),
    valueUsd: valueUsd.toString(),
  };
}

export async function getMarketOverview(): Promise<MarketOverview> {
  const [
    debtAsset,
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
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "debtAsset" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "priceOracle" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "closeFactorBps" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "minBorrowAmount" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "minDebtAmount" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "debtCap" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "lpDepositPaused" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "lpWithdrawPaused" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "collateralDepositPaused" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "collateralWithdrawPaused" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "borrowPaused" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "liquidationPaused" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "rateModel" }),
    publicClient.readContract({ address: env.MARKET_CONFIG_ADDRESS as `0x${string}`, abi: marketConfigAbi, functionName: "getCollateralAssets" }),
    publicClient.readContract({ address: env.VAULT_MANAGER_ADDRESS as `0x${string}`, abi: vaultManagerAbi, functionName: "walletRegistry" }),
  ]);

  const [debtAssetSnapshot, debtOracle, collaterals] = await Promise.all([
    getAssetSnapshot(debtAsset),
    getOracleFeedSnapshot(debtAsset),
    Promise.all((collateralAssets as readonly `0x${string}`[]).map((asset) => getMarketCollateralSnapshot(asset))),
  ]);

  return {
    debtAsset: debtAssetSnapshot,
    debtOracle,
    debtPool: env.DEBT_POOL_ADDRESS as `0x${string}`,
    vaultManager: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
    marketConfig: env.MARKET_CONFIG_ADDRESS as `0x${string}`,
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
      baseRateBps: Number(rateModel[0]),
      kinkUtilizationBps: Number(rateModel[1]),
      slope1Bps: Number(rateModel[2]),
      slope2Bps: Number(rateModel[3]),
      minRateBps: Number(rateModel[4]),
      maxRateBps: Number(rateModel[5]),
    },
    collaterals,
  };
}

export async function getVaultSummary(vaultId: number): Promise<VaultSummary> {
  if (!Number.isInteger(vaultId) || vaultId <= 0) {
    throw new HttpError(400, "invalid-vault-id", "vaultId must be a positive integer");
  }

  const [vault, debtWei, debtValueUsd, collateralValueUsd, borrowCapacityUsd, liquidationCapacityUsd, healthFactorE18, collateralAssets, currentBorrowRateBps, debtAssetSnapshot, operators] =
    await Promise.all([
      publicClient.readContract({
        address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
        abi: vaultManagerAbi,
        functionName: "vaults",
        args: [BigInt(vaultId)],
      }),
      publicClient.readContract({
        address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
        abi: vaultManagerAbi,
        functionName: "debtOf",
        args: [BigInt(vaultId)],
      }),
      publicClient.readContract({
        address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
        abi: vaultManagerAbi,
        functionName: "debtValueUsd",
        args: [BigInt(vaultId)],
      }),
      publicClient.readContract({
        address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
        abi: vaultManagerAbi,
        functionName: "collateralValueUsd",
        args: [BigInt(vaultId)],
      }),
      publicClient.readContract({
        address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
        abi: vaultManagerAbi,
        functionName: "borrowCapacityUsd",
        args: [BigInt(vaultId)],
      }),
      publicClient.readContract({
        address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
        abi: vaultManagerAbi,
        functionName: "liquidationCapacityUsd",
        args: [BigInt(vaultId)],
      }),
      publicClient.readContract({
        address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
        abi: vaultManagerAbi,
        functionName: "healthFactor",
        args: [BigInt(vaultId)],
      }),
      publicClient.readContract({
        address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
        abi: vaultManagerAbi,
        functionName: "getVaultCollateralAssets",
        args: [BigInt(vaultId)],
      }),
      publicClient.readContract({
        address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
        abi: vaultManagerAbi,
        functionName: "currentBorrowRateBps",
      }),
      getAssetSnapshot(env.DEBT_ASSET_ADDRESS as `0x${string}`),
      getActiveVaultOperators(vaultId),
    ]);

  const owner = vault[0];
  if (owner === zeroAddress) {
    throw new HttpError(404, "vault-not-found", "vault not found");
  }

  const collateralSnapshots = await Promise.all(
    (collateralAssets as readonly `0x${string}`[]).map((asset) => getVaultCollateralSnapshot(vaultId, asset))
  );

  const maxAdditionalBorrowUsd = borrowCapacityUsd > debtValueUsd ? borrowCapacityUsd - debtValueUsd : 0n;
  const maxAdditionalBorrowWei =
    BigInt(debtAssetSnapshot.priceUsd) === 0n
      ? 0n
      : (maxAdditionalBorrowUsd * 10n ** BigInt(debtAssetSnapshot.decimals)) / BigInt(debtAssetSnapshot.priceUsd);

  return {
    vaultId,
    owner,
    operators,
    normalizedDebt: vault[1].toString(),
    debtWei: debtWei.toString(),
    debtValueUsd: debtValueUsd.toString(),
    collateralValueUsd: collateralValueUsd.toString(),
    borrowCapacityUsd: borrowCapacityUsd.toString(),
    liquidationCapacityUsd: liquidationCapacityUsd.toString(),
    maxAdditionalBorrowUsd: maxAdditionalBorrowUsd.toString(),
    maxAdditionalBorrowWei: maxAdditionalBorrowWei.toString(),
    currentBorrowRateBps: Number(currentBorrowRateBps),
    healthFactorE18: healthFactorE18.toString(),
    collaterals: collateralSnapshots.filter((item) => item.balanceWei !== "0"),
  };
}

export async function listVaultsByOwner(query: unknown): Promise<VaultSummary[]> {
  const { owner, limit } = ownerListQuerySchema.parse(query);

  const db = getDb();
  const events = db.collection<ActivityEventLookupDoc>("activity-events");
  const docs = await events
    .find(
      { type: "vault.opened", owner: owner.toLowerCase() },
      { projection: { vaultId: 1 }, sort: { createdAt: -1 } }
    )
    .limit(limit)
    .toArray();

  const vaultIds = Array.from(
    new Set(docs.map((doc) => doc.vaultId).filter((value): value is number => typeof value === "number" && value > 0))
  );

  return await Promise.all(vaultIds.map((vaultId) => getVaultSummary(vaultId)));
}
