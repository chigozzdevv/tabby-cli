import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Shield, Check } from "lucide-react";
import type { QuoteData } from "../../lib/api-client";
import { buildQuoteSummaryText, collateralCapacityWei, formatAmount, formatUsd, formatBps, formatHealthFactor, quoteConstraintText } from "../../lib/api-client";

type QuoteCardProps = {
  quote: QuoteData;
  onAccept?: (payload: { amountWei: string; quote: QuoteData }) => Promise<void> | void;
};

export const QuoteCard: React.FC<QuoteCardProps> = ({ quote, onAccept }) => {
  const [selectedPct, setSelectedPct] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxBorrowWei = BigInt(quote.totals.maxAdditionalBorrowWei);
  const capacityWei = collateralCapacityWei(quote);
  const decimals = quote.debtAsset.decimals;
  const constraintText = quoteConstraintText(quote);
  const hasBorrowableAmount = maxBorrowWei > 0n;

  const getAmount = (pct: string): bigint => {
    if (pct === "custom") return BigInt(Math.floor(parseFloat(customValue || "0") * 10 ** decimals));
    const bps = pct === "25" ? 2500n : pct === "50" ? 5000n : pct === "75" ? 7500n : 10000n;
    return (maxBorrowWei * bps) / 10000n;
  };

  const selectedAmount = selectedPct ? getAmount(selectedPct) : 0n;
  const projectedHf = selectedAmount > 0n
    ? formatHealthFactor(((BigInt(quote.totals.totalBorrowCapacityUsd) * 10n ** 18n) / (BigInt(quote.totals.currentDebtValueUsd) + (selectedAmount * BigInt(quote.debtAsset.priceUsd)) / (10n ** BigInt(decimals)))).toString())
    : null;

  const handleConfirm = async () => {
    if (!hasBorrowableAmount || selectedAmount <= 0n) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAccept?.({ amountWei: selectedAmount.toString(), quote });
      setConfirmed(true);
    } catch (err: any) {
      setError(err?.message ?? "Borrow setup failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-tactical-border bg-tactical-surface mt-2">
      <div className="border-b border-tactical-border px-3 py-2 flex items-center gap-2 text-[10px] text-tactical-accent uppercase font-bold tracking-wider">
        <TrendingUp size={12} />
        Borrow Quote
      </div>

      <div className="p-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] mb-3">
          {quote.requestedCollaterals.map((c, i) => (
            <React.Fragment key={i}>
              <div className="text-[#888]">Collateral</div>
              <div className="font-bold">{formatAmount(c.requestedAmountWei, c.decimals)} {c.symbol}</div>
            </React.Fragment>
          ))}
          <div className="text-[#888]">Collateral Value</div>
          <div className="font-bold">{formatUsd(quote.totals.totalCollateralValueUsd)}</div>
          <div className="text-[#888]">Capacity</div>
          <div className="font-bold">{formatAmount(capacityWei.toString(), decimals)} {quote.debtAsset.symbol}</div>
          <div className="text-[#888]">Borrowable Now</div>
          <div className="font-bold">{formatAmount(quote.totals.maxAdditionalBorrowWei, decimals)} {quote.debtAsset.symbol}</div>
          <div className="text-[#888]">LTV</div>
          <div className="font-bold">{formatBps(quote.requestedCollaterals[0]?.borrowLtvBps ?? 0)}</div>
        </div>

        {constraintText && (
          <div className="mb-3 border border-[#665c28] bg-[#201d10] px-3 py-2 text-[10px] text-[#f5dd74]">
            {constraintText}
          </div>
        )}

        <div className="border-t border-tactical-border pt-3">
          <div className="text-[9px] text-tactical-dim uppercase tracking-wider mb-2">
            {hasBorrowableAmount ? "Select Amount" : "Borrow Unavailable"}
          </div>

          {!confirmed ? (
            <>
              {hasBorrowableAmount ? (
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
              ) : (
                <div className="text-[10px] text-tactical-dim">
                  {buildQuoteSummaryText(quote)}
                </div>
              )}

              <AnimatePresence>
                {hasBorrowableAmount && selectedPct === "custom" && (
                  <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                    <input
                      type="number"
                      value={customValue}
                      onChange={(e) => setCustomValue(e.target.value)}
                      placeholder={`Max: ${formatAmount(quote.totals.maxAdditionalBorrowWei, decimals)}`}
                      className="w-full bg-tactical-bg border border-tactical-border px-2 py-1.5 text-[11px] font-mono mb-2 focus:outline-none focus:border-tactical-accent"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {selectedPct && selectedAmount > 0n && (
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="text-[10px] text-tactical-dim">
                    Borrow: <span className="text-tactical-text font-bold">{formatAmount(selectedAmount.toString(), decimals)} {quote.debtAsset.symbol}</span>
                  </div>
                  {projectedHf && (
                    <div className="flex items-center gap-1 text-[10px]">
                      <Shield size={10} style={{ color: projectedHf.color }} />
                      <span style={{ color: projectedHf.color }}>HF {projectedHf.value}</span>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="mb-2 border border-tactical-error/40 bg-tactical-error/5 px-2 py-2 text-[10px] text-tactical-error">
                  {error}
                </div>
              )}

              {selectedPct && hasBorrowableAmount && (
                <button
                  onClick={() => void handleConfirm()}
                  disabled={submitting}
                  className="w-full btn py-2 text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? "Preparing Vault..." : "Confirm Borrow"}
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-tactical-accent text-[11px] py-2">
              <Check size={14} />
              <span className="font-bold uppercase">Vault prepared. Borrow request sent for {formatAmount(selectedAmount.toString(), decimals)} {quote.debtAsset.symbol}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
