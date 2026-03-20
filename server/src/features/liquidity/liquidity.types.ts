export type PoolSnapshot = {
  address: `0x${string}`;
  asset: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  marketConfig: `0x${string}`;
  walletRegistry: `0x${string}` | null;
  treasuryFeeBps: number;
  treasuryFeeRecipient: `0x${string}` | null;
  totalAssetsWei: string;
  availableLiquidityWei: string;
  totalDebtAssetsWei: string;
  totalShares: string;
  utilizationBps: number;
  currentBorrowRateBps: number;
  liquidityIndexRay: string;
  borrowIndexRay: string;
  lastAccruedAt: number;
};

export type PoolPosition = {
  account: `0x${string}`;
  asset: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  shares: string;
  totalShares: string;
  totalAssetsWei: string;
  estimatedAssetsWei: string;
};

export type DepositQuote = {
  assetsWei: string;
  shares: string;
};

export type WithdrawQuote = {
  shares: string;
  assetsWei: string;
};
