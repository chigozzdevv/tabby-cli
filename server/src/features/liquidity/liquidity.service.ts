import { env } from "@/config/env.js";
import { publicClient } from "@/shared/viem.js";
import { debtPoolAbi, erc20MetadataAbi } from "@/shared/protocol.js";
import type { DepositQuote, PoolPosition, PoolSnapshot, WithdrawQuote } from "@/features/liquidity/liquidity.types.js";

const debtPool = env.DEBT_POOL_ADDRESS as `0x${string}`;

export async function getPoolSnapshot(): Promise<PoolSnapshot> {
  const [asset, marketConfig, walletRegistry, treasuryFeeBps, treasuryFeeRecipient, totalAssets, availableLiquidity, totalDebtAssets, totalShares, utilizationBps, currentBorrowRateBps, liquidityIndexRay, borrowIndexRay, lastAccruedAt] =
    await Promise.all([
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "ASSET" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "marketConfig" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "walletRegistry" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "treasuryFeeBps" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "treasuryFeeRecipient" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "totalAssets" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "availableLiquidity" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "totalDebtAssets" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "totalShares" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "utilizationBps" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "currentBorrowRateBps" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "liquidityIndex" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "borrowIndex" }),
      publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "lastAccruedAt" }),
    ]);

  const [assetDecimals, assetSymbol] = await Promise.all([
    publicClient.readContract({ address: asset, abi: erc20MetadataAbi, functionName: "decimals" }).catch(() => 18),
    publicClient.readContract({ address: asset, abi: erc20MetadataAbi, functionName: "symbol" }).catch(() => "TOKEN"),
  ]);

  return {
    address: debtPool,
    asset,
    assetSymbol: String(assetSymbol),
    assetDecimals: Number(assetDecimals),
    marketConfig,
    walletRegistry: walletRegistry === "0x0000000000000000000000000000000000000000" ? null : walletRegistry,
    treasuryFeeBps: Number(treasuryFeeBps),
    treasuryFeeRecipient:
      treasuryFeeRecipient === "0x0000000000000000000000000000000000000000" ? null : treasuryFeeRecipient,
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

export async function getLpPosition(account: `0x${string}`): Promise<PoolPosition> {
  const [asset, shares, totalShares, totalAssets] = await Promise.all([
    publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "ASSET" }),
    publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "balanceOf", args: [account] }),
    publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "totalShares" }),
    publicClient.readContract({ address: debtPool, abi: debtPoolAbi, functionName: "totalAssets" }),
  ]);

  const [assetDecimals, assetSymbol] = await Promise.all([
    publicClient.readContract({ address: asset, abi: erc20MetadataAbi, functionName: "decimals" }).catch(() => 18),
    publicClient.readContract({ address: asset, abi: erc20MetadataAbi, functionName: "symbol" }).catch(() => "TOKEN"),
  ]);

  const estimatedAssets = totalShares === 0n ? 0n : (shares * totalAssets) / totalShares;

  return {
    account,
    asset,
    assetSymbol: String(assetSymbol),
    assetDecimals: Number(assetDecimals),
    shares: shares.toString(),
    totalShares: totalShares.toString(),
    totalAssetsWei: totalAssets.toString(),
    estimatedAssetsWei: estimatedAssets.toString(),
  };
}

export async function quoteDeposit(assets: bigint): Promise<DepositQuote> {
  const shares = await publicClient.readContract({
    address: debtPool,
    abi: debtPoolAbi,
    functionName: "previewDeposit",
    args: [assets],
  });

  return { assetsWei: assets.toString(), shares: shares.toString() };
}

export async function quoteWithdraw(shares: bigint): Promise<WithdrawQuote> {
  const assets = await publicClient.readContract({
    address: debtPool,
    abi: debtPoolAbi,
    functionName: "previewWithdraw",
    args: [shares],
  });

  return { shares: shares.toString(), assetsWei: assets.toString() };
}
