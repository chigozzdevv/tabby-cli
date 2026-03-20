export type AssistantMode = "human" | "agent";
export type AssistantSessionStatus = "active" | "completed" | "cancelled";
export type AssistantMessageRole = "system" | "assistant" | "user";

export type AssistantCollateralIntent = {
  asset: `0x${string}`;
  amountWei: string;
};

export type AssistantMessage = {
  id: string;
  role: AssistantMessageRole;
  content: string;
  createdAt: string;
};

export type AssistantSession = {
  sessionId: string;
  mode: AssistantMode;
  status: AssistantSessionStatus;
  ownerAddress?: `0x${string}`;
  operatorAddress?: `0x${string}`;
  vaultId?: number;
  desiredBorrowWei?: string;
  selectedCollaterals: AssistantCollateralIntent[];
  messages: AssistantMessage[];
  createdAt: string;
  updatedAt: string;
};

export type PreflightCollateralQuote = {
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
};

export type BorrowPreflightQuote = {
  owner?: `0x${string}`;
  vaultId?: number;
  debtAsset: {
    address: `0x${string}`;
    symbol: string;
    decimals: number;
    priceUsd: string;
  };
  existingVault?: {
    owner: `0x${string}`;
    debtWei: string;
    debtValueUsd: string;
    collateralValueUsd: string;
    borrowCapacityUsd: string;
    liquidationCapacityUsd: string;
    healthFactorE18: string;
  };
  requestedCollaterals: PreflightCollateralQuote[];
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

export type AgentBinding = {
  bindingId: string;
  sessionId?: string;
  owner: `0x${string}`;
  operator: `0x${string}`;
  vaultId: number;
  status: "prepared" | "bound" | "revoked";
  createdAt: string;
  updatedAt: string;
};
