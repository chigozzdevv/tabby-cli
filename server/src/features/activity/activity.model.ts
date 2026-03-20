export type ActivityEventType =
  | "lp.deposited"
  | "lp.withdrawn"
  | "vault.opened"
  | "vault.operator-updated"
  | "collateral.deposited"
  | "collateral.withdrawn"
  | "debt.borrowed"
  | "debt.repaid"
  | "vault.liquidated"
  | "vault.bad-debt-resolved";

export type ActivityEventDoc = {
  chainId: number;
  type: ActivityEventType;
  dedupeKey: string;
  owner?: string;
  account?: string;
  vaultId?: number;
  txHash?: string;
  blockNumber?: number;
  logIndex?: number;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type ActivityCursorDoc = {
  key: string;
  lastProcessedBlock: number;
  updatedAt: Date;
};
