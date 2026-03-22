const API_BASE = import.meta.env.VITE_TABBY_API_BASE_URL || "http://localhost:3000";

export type QuoteData = {
  debtAsset: { symbol: string; decimals: number; priceUsd: string };
  requestedCollaterals: {
    asset: string;
    symbol: string;
    decimals: number;
    requestedAmountWei: string;
    valueUsd: string;
    borrowLtvBps: number;
    liquidationThresholdBps: number;
  }[];
  totals: {
    totalCollateralValueUsd: string;
    totalBorrowCapacityUsd: string;
    maxAdditionalBorrowUsd: string;
    maxAdditionalBorrowWei: string;
    currentDebtValueUsd: string;
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

export type VaultPosition = {
  vaultId: number;
  owner: string;
  debtWei: string;
  debtValueUsd: string;
  collateralValueUsd: string;
  borrowCapacityUsd: string;
  healthFactorE18: string;
  currentBorrowRateBps: number;
  collaterals: {
    asset: { symbol: string; decimals: number; priceUsd: string };
    balanceWei: string;
    valueUsd: string;
  }[];
};

export type PoolData = {
  assetSymbol: string;
  assetDecimals: number;
  totalAssetsWei: string;
  availableLiquidityWei: string;
  utilizationBps: number;
  currentBorrowRateBps: number;
};

export type MarketData = {
  debtAsset: { symbol: string; decimals: number; priceUsd: string };
  collaterals: {
    asset: { symbol: string; decimals: number; priceUsd: string };
    config: { borrowLtvBps: number; liquidationThresholdBps: number };
  }[];
};

export type LpPosition = {
  account: string;
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
  shares: string;
  totalShares: string;
  totalAssetsWei: string;
  estimatedAssetsWei: string;
};

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

export async function getVault(vaultId: number): Promise<VaultPosition | null> {
  return apiFetch<VaultPosition>(`/public/monitoring/vaults/${vaultId}`);
}

export async function listPositions(owner: string): Promise<VaultPosition[]> {
  const data = await apiFetch<VaultPosition[]>(`/public/monitoring/vaults?owner=${owner}`);
  return data ?? [];
}

export async function getPoolSnapshot(): Promise<PoolData | null> {
  return apiFetch<PoolData>("/liquidity/pool");
}

export async function getLpPosition(account: string): Promise<LpPosition | null> {
  return apiFetch<LpPosition>(`/liquidity/position?account=${account}`);
}

export async function getMarketOverview(): Promise<MarketData | null> {
  return apiFetch<MarketData>("/public/monitoring/market");
}

export async function getConfig(): Promise<Record<string, string> | null> {
  return apiFetch<Record<string, string>>("/public/config");
}

export function formatUsd(weiStr: string, decimals = 18): string {
  const val = Number(BigInt(weiStr)) / 10 ** decimals;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(2)}`;
}

export function formatAmount(weiStr: string, decimals: number): string {
  const val = Number(BigInt(weiStr)) / 10 ** decimals;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toFixed(val < 1 ? 4 : 2);
}

export function formatHealthFactor(hfE18: string): { value: string; color: string } {
  const hf = Number(BigInt(hfE18)) / 1e18;
  const value = hf > 100 ? "∞" : hf.toFixed(2);
  const color = hf >= 2 ? "#28c840" : hf >= 1.2 ? "#febc2e" : "#ff4444";
  return { value, color };
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
