export type AssetSnapshot = {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  priceUsd: string;
};

export type OracleFeedSnapshot = {
  feed: `0x${string}` | null;
  maxAgeSeconds: number;
  enabled: boolean;
  aliasAsset: `0x${string}` | null;
};

export type CollateralConfigSnapshot = {
  borrowLtvBps: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  supplyCap: string;
  valueCapUsd: string;
  enabled: boolean;
};

export type MarketCollateralSnapshot = {
  asset: AssetSnapshot;
  oracle: OracleFeedSnapshot;
  config: CollateralConfigSnapshot;
};

export type MarketOverview = {
  debtAsset: AssetSnapshot;
  debtOracle: OracleFeedSnapshot;
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
  collaterals: MarketCollateralSnapshot[];
};

export type VaultCollateralSnapshot = {
  asset: AssetSnapshot;
  oracle: OracleFeedSnapshot;
  config: CollateralConfigSnapshot;
  balanceWei: string;
  valueUsd: string;
};

export type VaultSummary = {
  vaultId: number;
  owner: `0x${string}`;
  operators: `0x${string}`[];
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
  collaterals: VaultCollateralSnapshot[];
};
