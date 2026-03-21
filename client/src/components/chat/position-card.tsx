import React from "react";
import { Shield, Wallet } from "lucide-react";
import type { VaultPosition } from "../../lib/api-client";
import { formatAmount, formatUsd, formatHealthFactor, formatBps } from "../../lib/api-client";

type PositionCardProps = {
  vault: VaultPosition;
  onAction?: (action: "add-collateral" | "withdraw", vaultId: number) => void;
};

export const PositionCard: React.FC<PositionCardProps> = ({ vault, onAction }) => {
  const hf = formatHealthFactor(vault.healthFactorE18);

  return (
    <div className="border border-tactical-border bg-tactical-surface mt-2">
      <div className="border-b border-tactical-border px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-wider text-tactical-dim">
          <Wallet size={12} />
          Vault #{vault.vaultId}
        </div>
        <div className="flex items-center gap-1 text-[10px] font-bold" style={{ color: hf.color }}>
          <Shield size={10} />
          HF {hf.value}
        </div>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] mb-3">
          {vault.collaterals.map((c, i) => (
            <React.Fragment key={i}>
              <div className="text-[#888]">Collateral</div>
              <div className="font-bold">{formatAmount(c.balanceWei, c.asset.decimals)} {c.asset.symbol}</div>
            </React.Fragment>
          ))}
          <div className="text-[#888]">Collateral Value</div>
          <div className="font-bold">{formatUsd(vault.collateralValueUsd)}</div>
          <div className="text-[#888]">Debt</div>
          <div className="font-bold">{formatUsd(vault.debtValueUsd)}</div>
          <div className="text-[#888]">Borrow Rate</div>
          <div className="font-bold">{formatBps(vault.currentBorrowRateBps)}</div>
        </div>

        <div className="flex gap-1 pt-2 border-t border-tactical-border">
          <button
            onClick={() => onAction?.("add-collateral", vault.vaultId)}
            className="flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider border border-tactical-border hover:border-tactical-accent hover:text-tactical-accent transition-all cursor-pointer"
          >
            + Collateral
          </button>
          <button
            onClick={() => onAction?.("withdraw", vault.vaultId)}
            className="flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider border border-tactical-border hover:border-tactical-accent hover:text-tactical-accent transition-all cursor-pointer"
          >
            Withdraw
          </button>
        </div>
      </div>
    </div>
  );
};
