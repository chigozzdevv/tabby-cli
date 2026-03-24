#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  formatUnits,
  parseUnits,
} from "viem";
import { generateSeedPhrase, walletStoreFromSeedPhrase, createViemWalletClient } from "../../lib/wdk-wallet.js";
import type { WDKWalletStore } from "../../lib/wdk-wallet.js";
import { getEnv } from "../../lib/env.js";
import {
  debtPoolAbi,
  erc20Abi,
  createClients,
  resolveProtocolConfig,
  ProtocolConfig
} from "../../lib/protocol.js";

type PoolOverview = {
  asset: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  totalAssetsWei: string;
  availableLiquidityWei: string;
  totalDebtAssetsWei: string;
  totalShares: string;
  utilizationBps: number;
  currentBorrowRateBps: number;
  supplyApyBps: number;
};

type PoolPosition = {
  account: `0x${string}`;
  asset: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  shares: string;
  totalShares: string;
  totalAssetsWei: string;
  estimatedAssetsWei: string;
};

const maxUint256 = (1n << 256n) - 1n;
const defaultGasFloorWei = BigInt(getEnv().TABBY_MIN_GAS_WEI || "10000000000000000");

const walletPath = path.join(os.homedir(), ".config", "tabby-lp", "wallet.json");

async function loadWallet(): Promise<WDKWalletStore> {
  const raw = await fs.readFile(walletPath, "utf8");
  return JSON.parse(raw) as WDKWalletStore;
}

async function saveWallet(seedPhrase: string): Promise<{ address: string; path: string }> {
  const store = walletStoreFromSeedPhrase(seedPhrase);
  await fs.mkdir(path.dirname(walletPath), { recursive: true });
  await fs.writeFile(walletPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  return { address: store.address, path: walletPath };
}

async function sendNotification(message: string) {
  console.log(`NOTIFICATION: ${message}`);
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
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

function getArg(name: string) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function getPoolOverview(publicClient: any, protocol: ProtocolConfig): Promise<PoolOverview> {
  const [
    asset,
    totalAssets,
    availableLiquidity,
    totalDebtAssets,
    totalShares,
    utilizationBps,
    currentBorrowRateBps,
    treasuryFeeBps,
  ] = await Promise.all([
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "ASSET" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalAssets" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "availableLiquidity" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalDebtAssets" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalShares" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "utilizationBps" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "currentBorrowRateBps" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "treasuryFeeBps" }),
  ]);

  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
  ]);

  const borrowRate = Number(currentBorrowRateBps);
  const utilization = Number(utilizationBps);
  const fee = Number(treasuryFeeBps);
  const supplyApyBps = Math.floor((borrowRate * utilization * (10000 - fee)) / 100000000);

  return {
    asset,
    assetSymbol: symbol,
    assetDecimals: decimals,
    totalAssetsWei: totalAssets.toString(),
    availableLiquidityWei: availableLiquidity.toString(),
    totalDebtAssetsWei: totalDebtAssets.toString(),
    totalShares: totalShares.toString(),
    utilizationBps: utilization,
    currentBorrowRateBps: borrowRate,
    supplyApyBps,
  };
}

async function getPoolPosition(publicClient: any, protocol: ProtocolConfig, account: `0x${string}`): Promise<PoolPosition> {
  const [asset, shares, totalShares, totalAssets] = await Promise.all([
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "ASSET" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "balanceOf", args: [account] }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalShares" }),
    publicClient.readContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "totalAssets" }),
  ]);

  const [assetSymbol, assetDecimals] = await Promise.all([
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
  ]);

  const estimatedAssets = totalShares === 0n ? 0n : (shares * totalAssets) / totalShares;

  return {
    account,
    asset,
    assetSymbol,
    assetDecimals,
    shares: shares.toString(),
    totalShares: totalShares.toString(),
    totalAssetsWei: totalAssets.toString(),
    estimatedAssetsWei: estimatedAssets.toString(),
  };
}

function usage() {
  console.log(`
tabby-lp <command>

Commands:
  init-wallet [--force]
  pool-status [--json]
  assistant-pool-status
  position [--json]
  assistant-position
  approve-asset --amount <n>
  deposit-liquidity --amount <n>
  assistant-deposit-liquidity --amount <n>
  withdraw-liquidity [--amount <n> | --shares <n> | --all]
  assistant-withdraw-liquidity [--amount <n> | --shares <n> | --all]
  monitor-pool
`);
}

function buildAssistantPoolResponse(overview: PoolOverview) {
  return {
    text: `The pool has ${formatDisplayAmount(overview.totalAssetsWei, overview.assetDecimals)} ${overview.assetSymbol} total assets, ${formatDisplayAmount(overview.availableLiquidityWei, overview.assetDecimals)} ${overview.assetSymbol} available, ${(overview.utilizationBps / 100).toFixed(2)}% utilization, and a ${(overview.supplyApyBps / 100).toFixed(2)}% estimated supply APY.`,
    isQuote: false,
    isPosition: false,
    isPool: true,
    isAction: false,
    quote: null,
    position: null,
    pool: overview,
    action: null,
  };
}

function buildAssistantPositionResponse(position: PoolPosition) {
  return {
    text: `You hold ${formatDisplayAmount(position.shares, position.assetDecimals)} pool shares worth about ${formatDisplayAmount(position.estimatedAssetsWei, position.assetDecimals)} ${position.assetSymbol}.`,
    isQuote: false,
    isPosition: true,
    isPool: false,
    isAction: false,
    quote: null,
    position,
    pool: null,
    action: null,
  };
}

function buildAssistantActionResponse(type: "deposit" | "withdraw", detail: string, text = detail) {
  return {
    text,
    isQuote: false,
    isPosition: false,
    isPool: false,
    isAction: true,
    quote: null,
    position: null,
    pool: null,
    action: {
      type,
      success: true,
      detail,
    },
  };
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) return usage();

  try {
    if (cmd === "init-wallet") {
      const force = process.argv.includes("--force");
      try {
        await fs.access(walletPath);
        if (!force) {
          console.log(JSON.stringify({ error: "Wallet already exists. Use --force to overwrite.", path: walletPath }));
          return;
        }
      } catch {}
      const seedPhrase = generateSeedPhrase();
      const { address, path: p } = await saveWallet(seedPhrase);
      printJson({ address, path: p, ok: true });
      return;
    }

    const protocol = await resolveProtocolConfig();
    const { publicClient } = createClients(protocol);
    const chain = publicClient.chain!;

    if (cmd === "pool-status") {
      const overview = await getPoolOverview(publicClient, protocol);
      if (hasFlag("--json")) {
        printJson(overview);
      } else {
        console.log(`
Pool Status (${overview.assetSymbol}):
  Total Assets: ${formatUnits(BigInt(overview.totalAssetsWei), overview.assetDecimals)} ${overview.assetSymbol}
  Available Liquidity: ${formatUnits(BigInt(overview.availableLiquidityWei), overview.assetDecimals)} ${overview.assetSymbol}
  Total Debt: ${formatUnits(BigInt(overview.totalDebtAssetsWei), overview.assetDecimals)} ${overview.assetSymbol}
  Utilization: ${(overview.utilizationBps / 100).toFixed(2)}%
  Borrow APR: ${(overview.currentBorrowRateBps / 100).toFixed(2)}%
  Supply APY: ${(overview.supplyApyBps / 100).toFixed(2)}% (est.)
`);
      }
    } else if (cmd === "assistant-pool-status") {
      const overview = await getPoolOverview(publicClient, protocol);
      printJson(buildAssistantPoolResponse(overview));
    } else if (cmd === "position") {
      const wallet = await loadWallet();
      const position = await getPoolPosition(publicClient, protocol, wallet.address);
      if (hasFlag("--json")) {
        printJson(position);
      } else {
        console.log(`
LP Position (${position.assetSymbol}):
  Shares: ${formatUnits(BigInt(position.shares), position.assetDecimals)}
  Estimated Assets: ${formatUnits(BigInt(position.estimatedAssetsWei), position.assetDecimals)} ${position.assetSymbol}
`);
      }
    } else if (cmd === "assistant-position") {
      const wallet = await loadWallet();
      const position = await getPoolPosition(publicClient, protocol, wallet.address);
      printJson(buildAssistantPositionResponse(position));
    } else if (cmd === "approve-asset") {
      const amountStr = getArg("--amount");
      if (!amountStr) throw new Error("Missing --amount");

      const wallet = await loadWallet();
      const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;
      const decimals = await publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "decimals" });
      const amount = parseUnits(amountStr, Number(decimals));
      const allowance = await publicClient.readContract({
        address: protocol.debtAsset,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet.address, protocol.debtPool],
      });

      if (allowance >= amount) {
        printJson({
          ok: true,
          approved: false,
          asset: protocol.debtAsset,
          spender: protocol.debtPool,
          amountWei: amount.toString(),
          currentAllowanceWei: allowance.toString(),
        });
        return;
      }

      const hash = await walletClient.writeContract({
        address: protocol.debtAsset,
        abi: erc20Abi,
        functionName: "approve",
        args: [protocol.debtPool, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      printJson({
        ok: true,
        approved: true,
        asset: protocol.debtAsset,
        spender: protocol.debtPool,
        amountWei: amount.toString(),
        txHash: hash,
      });
    } else if (cmd === "deposit-liquidity") {
      const amountStr = getArg("--amount");
      if (!amountStr) throw new Error("Missing --amount");
      const wallet = await loadWallet();
      const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;

      const decimals = await publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "decimals" });
      const amount = parseUnits(amountStr, Number(decimals));
      const previewShares = await publicClient.readContract({
        address: protocol.debtPool,
        abi: debtPoolAbi,
        functionName: "previewDeposit",
        args: [amount],
      });

      const allowance = await publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "allowance", args: [wallet.address, protocol.debtPool] });
      let approvalTxHash: `0x${string}` | undefined;
      if (allowance < amount) {
        approvalTxHash = await walletClient.writeContract({
          address: protocol.debtAsset,
          abi: erc20Abi,
          functionName: "approve",
          args: [protocol.debtPool, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
      }

      const hash = await walletClient.writeContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "deposit", args: [amount] });
      await publicClient.waitForTransactionReceipt({ hash });
      printJson({
        ok: true,
        txHash: hash,
        asset: protocol.debtAsset,
        amountWei: amount.toString(),
        previewShares: previewShares.toString(),
        approvalTxHash,
      });
    } else if (cmd === "assistant-deposit-liquidity") {
      const amountStr = getArg("--amount");
      if (!amountStr) throw new Error("Missing --amount");
      const wallet = await loadWallet();
      const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;

      const decimals = await publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "decimals" });
      const amount = parseUnits(amountStr, Number(decimals));

      const allowance = await publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "allowance", args: [wallet.address, protocol.debtPool] });
      if (allowance < amount) {
        const approvalTxHash = await walletClient.writeContract({
          address: protocol.debtAsset,
          abi: erc20Abi,
          functionName: "approve",
          args: [protocol.debtPool, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
      }

      const hash = await walletClient.writeContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "deposit", args: [amount] });
      await publicClient.waitForTransactionReceipt({ hash });
      const position = await getPoolPosition(publicClient, protocol, wallet.address);
      const amountText = formatDisplayAmount(amount, Number(decimals));
      const shareText = formatDisplayAmount(position.shares, position.assetDecimals);

      printJson(
        buildAssistantActionResponse(
          "deposit",
          `${amountText} ${position.assetSymbol} deposited. Current shares: ${shareText}.`,
          `Deposited ${amountText} ${position.assetSymbol}. You now hold ${shareText} pool shares.`,
        ),
      );
    } else if (cmd === "withdraw-liquidity") {
      const sharesStr = getArg("--shares");
      const amountStr = getArg("--amount");
      const isAll = hasFlag("--all");
      if (!sharesStr && !amountStr && !isAll) throw new Error("Missing --shares, --amount, or --all");

      const wallet = await loadWallet();
      const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;
      const decimals = await publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "decimals" });

      let sharesToWithdraw: bigint;
      if (isAll) {
        sharesToWithdraw = await publicClient.readContract({
          address: protocol.debtPool,
          abi: debtPoolAbi,
          functionName: "balanceOf",
          args: [wallet.address]
        }) as any;
      } else if (sharesStr) {
        sharesToWithdraw = parseUnits(sharesStr, Number(decimals));
      } else {
        const amount = parseUnits(amountStr!, Number(decimals));
        sharesToWithdraw = await publicClient.readContract({
          address: protocol.debtPool,
          abi: debtPoolAbi,
          functionName: "previewDeposit",
          args: [amount]
        }) as any;
      }

      const expectedAssetsWei = await publicClient.readContract({
        address: protocol.debtPool,
        abi: debtPoolAbi,
        functionName: "previewWithdraw",
        args: [sharesToWithdraw],
      });
      const hash = await walletClient.writeContract({
        address: protocol.debtPool,
        abi: debtPoolAbi,
        functionName: "withdraw",
        args: [sharesToWithdraw]
      });
      await publicClient.waitForTransactionReceipt({ hash });
      printJson({
        ok: true,
        txHash: hash,
        shares: sharesToWithdraw.toString(),
        expectedAssetsWei: expectedAssetsWei.toString(),
        requestedAmountWei: amountStr ? parseUnits(amountStr, Number(decimals)).toString() : undefined,
        all: isAll,
      });
    } else if (cmd === "assistant-withdraw-liquidity") {
      const sharesStr = getArg("--shares");
      const amountStr = getArg("--amount");
      const isAll = hasFlag("--all");
      if (!sharesStr && !amountStr && !isAll) throw new Error("Missing --shares, --amount, or --all");

      const wallet = await loadWallet();
      const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;
      const decimals = await publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "decimals" });

      let sharesToWithdraw: bigint;
      if (isAll) {
        sharesToWithdraw = await publicClient.readContract({
          address: protocol.debtPool,
          abi: debtPoolAbi,
          functionName: "balanceOf",
          args: [wallet.address]
        }) as any;
      } else if (sharesStr) {
        sharesToWithdraw = parseUnits(sharesStr, Number(decimals));
      } else {
        const amount = parseUnits(amountStr!, Number(decimals));
        sharesToWithdraw = await publicClient.readContract({
          address: protocol.debtPool,
          abi: debtPoolAbi,
          functionName: "previewDeposit",
          args: [amount]
        }) as any;
      }

      const expectedAssetsWei = await publicClient.readContract({
        address: protocol.debtPool,
        abi: debtPoolAbi,
        functionName: "previewWithdraw",
        args: [sharesToWithdraw],
      });
      const hash = await walletClient.writeContract({
        address: protocol.debtPool,
        abi: debtPoolAbi,
        functionName: "withdraw",
        args: [sharesToWithdraw]
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const position = await getPoolPosition(publicClient, protocol, wallet.address);
      const assetsText = formatDisplayAmount(expectedAssetsWei, position.assetDecimals);
      const shareText = formatDisplayAmount(position.shares, position.assetDecimals);

      printJson(
        buildAssistantActionResponse(
          "withdraw",
          `About ${assetsText} ${position.assetSymbol} withdrawn. Remaining shares: ${shareText}.`,
          `Withdrew about ${assetsText} ${position.assetSymbol}. Remaining shares: ${shareText}.`,
        ),
      );
    } else if (cmd === "monitor-pool") {
      const overview = await getPoolOverview(publicClient, protocol);
      console.log(`Yield is currently ${(overview.supplyApyBps / 100).toFixed(2)}%. Pool utilization: ${(overview.utilizationBps / 100).toFixed(2)}%`);

      if (overview.utilizationBps > 9000) {
        const msg = "WARNING: Pool utilization is very high (>90%). Withdrawal liquidity may be limited.";
        console.warn(msg);
        await sendNotification(msg);
      }
      if (overview.supplyApyBps < 100) {
        const msg = "ADVISORY: Pool yield is low (<1%). Consider re-evaluating your position.";
        console.warn(msg);
        await sendNotification(msg);
      }

      const walletRes = await loadWallet().catch(() => undefined);
      if (walletRes) {
        const balance = await publicClient.getBalance({ address: walletRes.address });
        if (balance < defaultGasFloorWei) {
          await sendNotification(`Low gas balance on LP wallet ${walletRes.address}: ${formatUnits(balance, 18)} XPL`);
        }
      }
    } else {
      usage();
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
