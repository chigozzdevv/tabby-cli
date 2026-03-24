const API_BASE = import.meta.env.VITE_TABBY_API_BASE_URL || "http://localhost:3000";

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  message?: string;
};

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
    requestedCollateralValueUsd: string;
    totalCollateralValueUsd: string;
    totalBorrowCapacityUsd: string;
    maxAdditionalBorrowUsd: string;
    maxAdditionalBorrowWei: string;
    currentDebtValueUsd: string;
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
    asset: { address: string; symbol: string; decimals: number; priceUsd: string };
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

export type PublicConfig = {
  chainId: number;
  timeLock: string;
  treasury: string;
  priceOracle: string;
  marketConfig: AddressLike;
  debtPool: AddressLike;
  vaultManager: AddressLike;
  debtAsset: AddressLike;
  collateralAssets: AddressLike[];
  walletRegistry: AddressLike | null;
};

export type AddressLike = `0x${string}`;

export type OperatorWalletData = {
  address: AddressLike;
  created: boolean;
};

export type AgentBinding = {
  bindingId: string;
  sessionId?: string;
  owner: AddressLike;
  operator: AddressLike;
  vaultId: number;
  status: "prepared" | "bound" | "revoked";
  createdAt: string;
  updatedAt: string;
};

export type PrepareBindingData = {
  binding: AgentBinding;
  currentlyBound: boolean;
  transaction: {
    to: AddressLike;
    valueWei: string;
    data: `0x${string}`;
  };
};

export type ConfirmBindingData = {
  binding: AgentBinding;
  bound: boolean;
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

async function apiFetchOrThrow<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json?.ok || json.data === undefined) {
    throw new Error(json?.message || `Request failed: ${path}`);
  }
  return json.data;
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

export async function getConfig(): Promise<PublicConfig | null> {
  return apiFetch<PublicConfig>("/public/config");
}

export async function createOperatorWallet(): Promise<OperatorWalletData> {
  return apiFetchOrThrow<OperatorWalletData>("/assistant/bindings/operator-wallet", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function prepareOperatorBinding(input: {
  vaultId: number;
  operator: AddressLike;
}): Promise<PrepareBindingData> {
  return apiFetchOrThrow<PrepareBindingData>("/assistant/bindings/prepare", {
    method: "POST",
    body: JSON.stringify({ vaultId: input.vaultId, operator: input.operator, allowed: true }),
  });
}

export async function confirmOperatorBinding(input: {
  bindingId?: string;
  vaultId: number;
  operator: AddressLike;
}): Promise<ConfirmBindingData> {
  return apiFetchOrThrow<ConfirmBindingData>("/assistant/bindings/confirm", {
    method: "POST",
    body: JSON.stringify(input),
  });
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

export function formatHealthFactor(
  hfE18: string,
  options?: { debtWei?: string },
): { value: string; color: string } {
  if (options?.debtWei !== undefined && BigInt(options.debtWei) === 0n) {
    return { value: "No debt", color: "#28c840" };
  }
  const hf = Number(BigInt(hfE18)) / 1e18;
  const value = hf > 100 ? "∞" : hf.toFixed(2);
  const color = hf >= 2 ? "#28c840" : hf >= 1.2 ? "#febc2e" : "#ff4444";
  return { value, color };
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function collateralCapacityWei(quote: QuoteData): bigint {
  const priceUsd = BigInt(quote.debtAsset.priceUsd);
  if (priceUsd === 0n) return 0n;
  return (BigInt(quote.totals.maxAdditionalBorrowUsd) * 10n ** BigInt(quote.debtAsset.decimals)) / priceUsd;
}

export function quoteConstraintText(quote: QuoteData): string | null {
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

export function buildQuoteSummaryText(quote: QuoteData): string {
  const collateral = quote.requestedCollaterals[0];
  const ltv = collateral ? formatBps(collateral.borrowLtvBps) : "0.00%";
  const amountLabel =
    quote.requestedCollaterals.length === 1 && collateral
      ? `${formatAmount(collateral.requestedAmountWei, collateral.decimals)} ${collateral.symbol}`
      : "the selected collateral";

  const borrowableNowWei = BigInt(quote.totals.maxAdditionalBorrowWei);
  const capacityWei = collateralCapacityWei(quote);
  const constraint = quoteConstraintText(quote);

  if (borrowableNowWei === 0n && capacityWei > 0n) {
    return `With ${amountLabel} you have ${formatAmount(capacityWei.toString(), quote.debtAsset.decimals)} ${quote.debtAsset.symbol} of collateral capacity at ${ltv}, but 0 ${quote.debtAsset.symbol} is borrowable right now. ${constraint}`;
  }

  return `With ${amountLabel} you can borrow up to ${formatAmount(quote.totals.maxAdditionalBorrowWei, quote.debtAsset.decimals)} ${quote.debtAsset.symbol} at ${ltv}.`;
}
