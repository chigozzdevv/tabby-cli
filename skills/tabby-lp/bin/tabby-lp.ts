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

function usage() {
  console.log(`
tabby-lp <command>

Commands:
  init-wallet [--force]
  pool-status [--json]
  deposit-liquidity --amount <n>
  withdraw-liquidity <--amount <n> | --shares <n> | --all>
  monitor-pool
`);
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
      console.log(JSON.stringify({ address, path: p, seedPhrase, ok: true }));
      return;
    }

    const protocol = await resolveProtocolConfig();
    const { publicClient } = createClients(protocol);
    const chain = publicClient.chain!;

    if (cmd === "pool-status") {
      const overview = await getPoolOverview(publicClient, protocol);
      if (process.argv.includes("--json")) {
        console.log(JSON.stringify(overview, null, 2));
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
    } else if (cmd === "deposit-liquidity") {
      const amountStr = process.argv.find((a, i) => process.argv[i - 1] === "--amount");
      if (!amountStr) throw new Error("Missing --amount");
      const wallet = await loadWallet();
      const walletClient = createViemWalletClient(wallet.seedPhrase, chain, protocol.rpcUrl) as any;

      const decimals = await publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "decimals" });
      const amount = parseUnits(amountStr, Number(decimals));

      const allowance = await publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "allowance", args: [wallet.address, protocol.debtPool] });
      if (allowance < amount) {
        process.stdout.write("Approving...");
        const hash = await walletClient.writeContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "approve", args: [protocol.debtPool, maxUint256] });
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(" Done.");
      }

      process.stdout.write("Depositing...");
      const hash = await walletClient.writeContract({ address: protocol.debtPool, abi: debtPoolAbi, functionName: "deposit", args: [amount] });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(" Successfully deposited.");
    } else if (cmd === "withdraw-liquidity") {
      const sharesStr = process.argv.find((a, i) => process.argv[i - 1] === "--shares");
      const amountStr = process.argv.find((a, i) => process.argv[i - 1] === "--amount");
      const isAll = process.argv.includes("--all");
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
        sharesToWithdraw = parseUnits(sharesStr, 18);
      } else {
        const amount = parseUnits(amountStr!, Number(decimals));
        sharesToWithdraw = await publicClient.readContract({
          address: protocol.debtPool,
          abi: debtPoolAbi,
          functionName: "previewDeposit",
          args: [amount]
        }) as any;
      }

      process.stdout.write(`Withdrawing ${sharesToWithdraw.toString()} shares...`);
      const hash = await walletClient.writeContract({
        address: protocol.debtPool,
        abi: debtPoolAbi,
        functionName: "withdraw",
        args: [sharesToWithdraw]
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(" Successfully withdrawn.");
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
