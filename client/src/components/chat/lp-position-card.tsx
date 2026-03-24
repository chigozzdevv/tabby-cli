import React, { useState } from "react";
import { Check, Wallet } from "lucide-react";
import { formatUnits } from "viem";

import type { LpPosition } from "../../lib/api-client";
import { formatAmount, formatUsd } from "../../lib/api-client";
import { withdrawLiquidityFromOwner } from "../../lib/lp-flow";

type LpPositionCardProps = {
  position: LpPosition;
  walletAddress: `0x${string}` | null;
  connectWallet: () => Promise<`0x${string}` | null>;
  onActionComplete?: (payload: { type: "withdraw"; text: string; detail: string }) => void;
};

export const LpPositionCard: React.FC<LpPositionCardProps> = ({
  position,
  walletAddress,
  connectWallet,
  onActionComplete,
}) => {
  const [selectedPct, setSelectedPct] = useState<string | null>(null);
  const [customValue, setCustomValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const estimatedAssetsWei = BigInt(position.estimatedAssetsWei);
  const decimals = position.assetDecimals;

  const getAmountWei = (pct: string): bigint => {
    if (pct === "custom") {
      return BigInt(Math.floor(parseFloat(customValue || "0") * 10 ** decimals));
    }
    const bps = pct === "25" ? 2500n : pct === "50" ? 5000n : pct === "75" ? 7500n : 10000n;
    return (estimatedAssetsWei * bps) / 10000n;
  };

  const selectedAmountWei = selectedPct ? getAmountWei(selectedPct) : 0n;

  const handleWithdraw = async () => {
    const ownerAddress = walletAddress ?? (await connectWallet());
    if (!ownerAddress) {
      throw new Error("Connect your wallet to continue.");
    }

    const isAll = selectedPct === "100";
    const result = await withdrawLiquidityFromOwner({
      ownerAddress,
      all: isAll,
      amount: isAll ? undefined : formatUnits(selectedAmountWei, decimals),
    });
    onActionComplete?.({ type: "withdraw", ...result });
    setConfirmed(result.text);
  };

  const onSubmit = async () => {
    if (!selectedPct || selectedAmountWei <= 0n) return;
    setSubmitting(true);
    setError(null);
    try {
      await handleWithdraw();
    } catch (err: any) {
      setError(err?.message ?? "LP withdrawal failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-tactical-border bg-tactical-surface mt-2">
      <div className="border-b border-tactical-border px-3 py-2 flex items-center gap-2 text-[10px] uppercase font-bold tracking-wider text-tactical-dim">
        <Wallet size={12} />
        LP Position
      </div>

      <div className="p-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] mb-3">
          <div className="text-[#888]">Asset</div>
          <div className="font-bold">{position.assetSymbol}</div>
          <div className="text-[#888]">Deposited</div>
          <div className="font-bold">{formatAmount(position.estimatedAssetsWei, position.assetDecimals)} {position.assetSymbol}</div>
          <div className="text-[#888]">Shares</div>
          <div className="font-bold">{formatAmount(position.shares, position.assetDecimals)}</div>
          <div className="text-[#888]">Est. Value</div>
          <div className="font-bold">{formatUsd(position.estimatedAssetsWei, position.assetDecimals)}</div>
        </div>

        <div className="border-t border-tactical-border pt-3">
          <div className="text-[9px] text-tactical-dim uppercase tracking-wider mb-2">
            Withdraw Liquidity
          </div>

          {!confirmed ? (
            <>
              <div className="flex gap-1 mb-2">
                {["25", "50", "75", "MAX"].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => setSelectedPct(pct === "MAX" ? "100" : pct)}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                      selectedPct === (pct === "MAX" ? "100" : pct)
                        ? "border-tactical-accent bg-tactical-accent text-[#0a0a0a]"
                        : "border-tactical-border hover:border-tactical-accent hover:text-tactical-accent"
                    }`}
                  >
                    {pct === "MAX" ? "MAX" : `${pct}%`}
                  </button>
                ))}
                <button
                  onClick={() => setSelectedPct("custom")}
                  className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                    selectedPct === "custom"
                      ? "border-tactical-accent bg-tactical-accent text-[#0a0a0a]"
                      : "border-tactical-border hover:border-tactical-accent hover:text-tactical-accent"
                  }`}
                >
                  Custom
                </button>
              </div>

              {selectedPct === "custom" && (
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  placeholder={`Max: ${formatAmount(position.estimatedAssetsWei, decimals)}`}
                  className="w-full bg-tactical-bg border border-tactical-border px-2 py-1.5 text-[11px] font-mono mb-2 focus:outline-none focus:border-tactical-accent"
                />
              )}

              {selectedPct && selectedAmountWei > 0n && (
                <div className="mb-2 px-1 text-[10px] text-tactical-dim">
                  Withdraw: <span className="text-tactical-text font-bold">{formatAmount(selectedAmountWei.toString(), decimals)} {position.assetSymbol}</span>
                </div>
              )}

              {error && (
                <div className="mb-2 border border-tactical-error/40 bg-tactical-error/5 px-2 py-2 text-[10px] text-tactical-error">
                  {error}
                </div>
              )}

              {selectedPct && (
                <button
                  onClick={() => void onSubmit()}
                  disabled={submitting || selectedAmountWei <= 0n}
                  className="w-full btn py-2 text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? "Withdrawing..." : "Confirm Withdraw"}
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-tactical-accent text-[11px] py-2">
              <Check size={14} />
              <span className="font-bold uppercase">{confirmed}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
