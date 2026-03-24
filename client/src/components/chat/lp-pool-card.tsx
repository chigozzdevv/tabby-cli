import React, { useState } from "react";
import { TrendingUp, Check } from "lucide-react";

import type { PoolData } from "../../lib/api-client";
import { formatBps, formatUsd } from "../../lib/api-client";
import { depositLiquidityFromOwner } from "../../lib/lp-flow";

type LpPoolCardProps = {
  pool: PoolData;
  walletAddress: `0x${string}` | null;
  connectWallet: () => Promise<`0x${string}` | null>;
  onActionComplete?: (payload: {
    type: "deposit";
    text: string;
    detail: string;
    txHash?: string;
    explorerUrl?: string;
  }) => void;
};

export const LpPoolCard: React.FC<LpPoolCardProps> = ({
  pool,
  walletAddress,
  connectWallet,
  onActionComplete,
}) => {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const handleDeposit = async () => {
    const ownerAddress = walletAddress ?? (await connectWallet());
    if (!ownerAddress) {
      throw new Error("Connect your wallet to continue.");
    }

    const result = await depositLiquidityFromOwner({
      ownerAddress,
      amount,
    });
    onActionComplete?.({ type: "deposit", ...result });
    setConfirmed(result.text);
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await handleDeposit();
    } catch (err: any) {
      setError(err?.message ?? "LP deposit failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-tactical-border bg-tactical-surface mt-2">
      <div className="border-b border-tactical-border px-3 py-2 flex items-center gap-2 text-[10px] text-tactical-accent uppercase font-bold tracking-wider">
        <TrendingUp size={12} />
        Pool Status
      </div>

      <div className="p-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] mb-3">
          <div className="text-[#888]">Asset</div>
          <div className="font-bold">{pool.assetSymbol}</div>
          <div className="text-[#888]">TVL</div>
          <div className="font-bold">{formatUsd(pool.totalAssetsWei, pool.assetDecimals)}</div>
          <div className="text-[#888]">Available</div>
          <div className="font-bold">{formatUsd(pool.availableLiquidityWei, pool.assetDecimals)}</div>
          <div className="text-[#888]">Utilization</div>
          <div className="font-bold">{formatBps(pool.utilizationBps)}</div>
          <div className="text-[#888]">Borrow Rate</div>
          <div className="font-bold">{formatBps(pool.currentBorrowRateBps)}</div>
        </div>

        <div className="border-t border-tactical-border pt-3">
          <div className="text-[9px] text-tactical-dim uppercase tracking-wider mb-2">
            Provide Liquidity
          </div>

          {!confirmed ? (
            <>
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`Amount in ${pool.assetSymbol}`}
                className="w-full bg-tactical-bg border border-tactical-border px-2 py-1.5 text-[11px] font-mono mb-2 focus:outline-none focus:border-tactical-accent"
              />

              {amount && (
                <div className="mb-2 px-1 text-[10px] text-tactical-dim">
                  Deposit: <span className="text-tactical-text font-bold">{amount} {pool.assetSymbol}</span>
                </div>
              )}

              {error && (
                <div className="mb-2 border border-tactical-error/40 bg-tactical-error/5 px-2 py-2 text-[10px] text-tactical-error">
                  {error}
                </div>
              )}

              <button
                onClick={() => void onSubmit()}
                disabled={submitting || !amount || Number(amount) <= 0}
                className="w-full btn py-2 text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Depositing..." : "Deposit Liquidity"}
              </button>
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
