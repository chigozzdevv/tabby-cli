#!/usr/bin/env node
import process from "node:process";
import { 
  formatUnits, 
  parseUnits, 
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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

  // Supply APY = Borrow Rate * Utilization * (1 - Reserve Fee)
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
  withdraw-liquidity --shares <n> | --amount <n>
  monitor-pool
`);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) return usage();

  try {
    // Helper to find wallet and state paths relative to homedir
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const walletPath = path.join(os.homedir(), ".config", "tabby-lp", "wallet.json");

    async function loadWallet() {
      const raw = await fs.readFile(walletPath, "utf8");
      return JSON.parse(raw) as { address: `0x${string}`; privateKey: `0x${string}` };
    }

    async function saveWallet(privateKey: `0x${string}`) {
      const { privateKeyToAccount } = await import("viem/accounts");
      const account = privateKeyToAccount(privateKey);
      await fs.mkdir(path.dirname(walletPath), { recursive: true });
      await fs.writeFile(walletPath, JSON.stringify({ address: account.address, privateKey }, null, 2), { mode: 0o600 });
      return { address: account.address as `0x${string}`, path: walletPath };
    }

    if (cmd === "init-wallet") {
      const { generatePrivateKey } = await import("viem/accounts");
      const { address, path } = await saveWallet(generatePrivateKey());
      console.log(JSON.stringify({ address, path, ok: true }));
      return;
    }

    const protocol = await resolveProtocolConfig();
    const { publicClient } = createClients(protocol);

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
      const amountStr = process.argv.find((a, i) => process.argv[i-1] === "--amount");
      if (!amountStr) throw new Error("Missing --amount");
      const wallet = await loadWallet();
      const account = privateKeyToAccount(wallet.privateKey);
      const walletClient = createWalletClient({ account, chain: publicClient.chain, transport: http(protocol.rpcUrl) }) as any;
      
      const decimals = await publicClient.readContract({ address: protocol.debtAsset, abi: erc20Abi, functionName: "decimals" });
      const amount = parseUnits(amountStr, Number(decimals));
      
      // Approve
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
      console.log("Withdrawal command initiated (Logic to be finalized)");
    } else if (cmd === "monitor-pool") {
        const overview = await getPoolOverview(publicClient, protocol);
        console.log(`Yield is currently ${(overview.supplyApyBps / 100).toFixed(2)}%. Pool utilization: ${(overview.utilizationBps / 100).toFixed(2)}%`);
    } else {
      usage();
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
