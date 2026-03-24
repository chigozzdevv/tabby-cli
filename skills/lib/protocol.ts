import { 
  createPublicClient, 
  http, 
  erc20Abi,
  zeroAddress
} from "viem";
import { getEnv } from "./env.js";

export const vaultManagerAbi = [
  { type: "function", name: "vaults", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "address" }, { type: "uint256" }] },
  { type: "function", name: "debtOf", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "debtValueUsd", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "collateralValueUsd", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "borrowCapacityUsd", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "liquidationCapacityUsd", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "healthFactor", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getVaultCollateralAssets", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }], outputs: [{ type: "address[]" }] },
  { type: "function", name: "currentBorrowRateBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "collateralBalances", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }, { name: "asset", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "vaultOperators", stateMutability: "view", inputs: [{ name: "vaultId", type: "uint256" }, { name: "operator", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "setVaultOperator", stateMutability: "nonpayable", inputs: [{ name: "vaultId", type: "uint256" }, { name: "operator", type: "address" }, { name: "allowed", type: "bool" }], outputs: [] },
  { type: "function", name: "openVault", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "vaultId", type: "uint256" }] },
  { type: "function", name: "depositCollateral", stateMutability: "nonpayable", inputs: [{ name: "vaultId", type: "uint256" }, { name: "asset", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawCollateral", stateMutability: "nonpayable", inputs: [{ name: "vaultId", type: "uint256" }, { name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "to", type: "address" }], outputs: [] },
  { type: "function", name: "borrow", stateMutability: "nonpayable", inputs: [{ name: "vaultId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ name: "normalizedDebtAdded", type: "uint256" }, { name: "borrowRateBps", type: "uint256" }] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "vaultId", type: "uint256" }, { name: "maxAmount", type: "uint256" }], outputs: [{ name: "repaid", type: "uint256" }, { name: "normalizedDebtRepaid", type: "uint256" }, { name: "remainingDebt", type: "uint256" }] },
  { type: "function", name: "liquidate", stateMutability: "nonpayable", inputs: [{ name: "vaultId", type: "uint256" }, { name: "collateralAsset", type: "address" }, { name: "maxRepayAmount", type: "uint256" }], outputs: [{ name: "repaid", type: "uint256" }, { name: "normalizedDebtRepaid", type: "uint256" }, { name: "seized", type: "uint256" }] },
  { type: "function", name: "walletRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "event", name: "VaultOpened", inputs: [{ indexed: true, name: "vaultId", type: "uint256" }, { indexed: true, name: "owner", type: "address" }], anonymous: false },
] as const;

export const debtPoolAbi = [
  { type: "function", name: "ASSET", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "marketConfig", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "availableLiquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDebtAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "utilizationBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "currentBorrowRateBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "previewDeposit", stateMutability: "view", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "previewWithdraw", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "treasuryFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "treasuryFeeRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "walletRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const marketConfigAbi = [
  { type: "function", name: "debtAsset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "priceOracle", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "closeFactorBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minBorrowAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minDebtAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "debtCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lpDepositPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "lpWithdrawPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "collateralDepositPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "collateralWithdrawPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "borrowPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "liquidationPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "rateModel", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "getCollateralAssets", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "getCollateralConfig", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ name: "borrowLtvBps", type: "uint16" }, { name: "liquidationThresholdBps", type: "uint16" }, { name: "liquidationBonusBps", type: "uint16" }, { name: "supplyCap", type: "uint256" }, { name: "valueCapUsd", type: "uint256" }, { name: "enabled", type: "bool" }] },
] as const;

export type ProtocolConfig = {
  chainId: number;
  rpcUrl: string;
  vaultManager: `0x${string}`;
  debtPool: `0x${string}`;
  marketConfig: `0x${string}`;
  debtAsset: `0x${string}`;
  collateralAssets: `0x${string}`[];
  walletRegistry?: `0x${string}`;
};

function requireAddress(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Missing or invalid ${label}`);
  }
  return value as `0x${string}`;
}

export async function resolveProtocolConfig(): Promise<ProtocolConfig> {
  const ENV = getEnv();
  
  let publicConfig: any = undefined;
  try {
    const res = await fetch(new URL("/public/config", ENV.TABBY_API_BASE_URL).toString());
    if (res.ok) {
        const payload = await res.json();
        if (payload.ok) publicConfig = payload.data;
    }
  } catch {}

  const chainId = ENV.CHAIN_ID ?? publicConfig?.chainId ?? 9745;
  const rpcUrl = ENV.RPC_URL ?? (chainId === 9745 ? "https://rpc.plasma.to" : undefined);
  if (!rpcUrl) throw new Error("Missing RPC_URL");

  const collateralAssets = ((ENV.COLLATERAL_ASSETS?.split(",") as `0x${string}`[]) ?? publicConfig?.collateralAssets ?? [])
    .filter(Boolean);

  return {
    chainId,
    rpcUrl,
    vaultManager: requireAddress(ENV.VAULT_MANAGER_ADDRESS ?? publicConfig?.vaultManager, "VAULT_MANAGER_ADDRESS"),
    debtPool: requireAddress(ENV.DEBT_POOL_ADDRESS ?? publicConfig?.debtPool, "DEBT_POOL_ADDRESS"),
    marketConfig: requireAddress(ENV.MARKET_CONFIG_ADDRESS ?? publicConfig?.marketConfig, "MARKET_CONFIG_ADDRESS"),
    debtAsset: requireAddress(ENV.DEBT_ASSET_ADDRESS ?? publicConfig?.debtAsset, "DEBT_ASSET_ADDRESS"),
    collateralAssets,
    walletRegistry: publicConfig?.walletRegistry === zeroAddress ? undefined : publicConfig?.walletRegistry,
  };
}

export function createClients(protocol: ProtocolConfig) {
  const chain = {
    id: protocol.chainId,
    name: "Plasma",
    nativeCurrency: { name: "XPL", symbol: "XPL", decimals: 18 },
    rpcUrls: { default: { http: [protocol.rpcUrl] } },
  } as any;
  const publicClient = createPublicClient({ chain, transport: http(protocol.rpcUrl) }) as any;
  return { chain, publicClient };
}

export { erc20Abi, zeroAddress };
