import React, { useMemo, useState } from "react";
import { Shield, Wallet, Check } from "lucide-react";
import { formatUnits, parseUnits, type Address } from "viem";

import type { VaultPosition } from "../../lib/api-client";
import { formatAmount, formatUsd, formatHealthFactor, formatBps } from "../../lib/api-client";
import { depositCollateralFromOwner, withdrawCollateralFromOwner } from "../../lib/borrow-flow";

type PositionCardProps = {
  vault: VaultPosition;
  walletAddress: `0x${string}` | null;
  connectWallet: () => Promise<`0x${string}` | null>;
  onActionComplete?: (payload: { type: "deposit" | "withdraw"; text: string; detail: string }) => void;
};

type Mode = "deposit" | "withdraw" | null;

export const PositionCard: React.FC<PositionCardProps> = ({
  vault,
  walletAddress,
  connectWallet,
  onActionComplete,
}) => {
  const hf = formatHealthFactor(vault.healthFactorE18);
  const [mode, setMode] = useState<Mode>(null);
  const [assetAddress, setAssetAddress] = useState(vault.collaterals[0]?.asset.address ?? "");
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawPct, setWithdrawPct] = useState<string | null>(null);
  const [withdrawCustom, setWithdrawCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const selectedCollateral = useMemo(
    () =>
      vault.collaterals.find(
        (item) => item.asset.address.toLowerCase() === assetAddress.toLowerCase(),
      ) ?? vault.collaterals[0],
    [assetAddress, vault.collaterals],
  );

  const selectedWithdrawAmountWei = useMemo(() => {
    if (!selectedCollateral || !withdrawPct) return 0n;
    const balanceWei = BigInt(selectedCollateral.balanceWei);
    if (withdrawPct === "custom") {
      if (!withdrawCustom) return 0n;
      return parseUnits(withdrawCustom, selectedCollateral.asset.decimals);
    }
    const bps = withdrawPct === "25" ? 2500n : withdrawPct === "50" ? 5000n : withdrawPct === "75" ? 7500n : 10000n;
    return (balanceWei * bps) / 10000n;
  }, [selectedCollateral, withdrawPct, withdrawCustom]);

  const resetState = () => {
    setError(null);
    setConfirmed(null);
    setDepositAmount("");
    setWithdrawPct(null);
    setWithdrawCustom("");
  };

  const selectMode = (nextMode: Mode) => {
    resetState();
    setMode((current) => (current === nextMode ? null : nextMode));
  };

  const ensureOwnerWallet = async () => {
    const ownerAddress = walletAddress ?? (await connectWallet());
    if (!ownerAddress) {
      throw new Error("Connect your wallet to continue.");
    }
    return ownerAddress;
  };

  const handleDeposit = async () => {
    if (!selectedCollateral) {
      throw new Error("No collateral asset available on this vault.");
    }

    const ownerAddress = await ensureOwnerWallet();
    const result = await depositCollateralFromOwner({
      ownerAddress,
      vault,
      assetAddress: selectedCollateral.asset.address as Address,
      amount: depositAmount,
    });
    onActionComplete?.({ type: "deposit", ...result });
    setConfirmed(result.text);
  };

  const handleWithdraw = async () => {
    if (!selectedCollateral) {
      throw new Error("No collateral asset available on this vault.");
    }

    const ownerAddress = await ensureOwnerWallet();
    const result = await withdrawCollateralFromOwner({
      ownerAddress,
      vault,
      assetAddress: selectedCollateral.asset.address as Address,
      amountWei: selectedWithdrawAmountWei,
    });
    onActionComplete?.({ type: "withdraw", ...result });
    setConfirmed(result.text);
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "deposit") {
        await handleDeposit();
      } else if (mode === "withdraw") {
        await handleWithdraw();
      }
    } catch (err: any) {
      setError(err?.message ?? "Vault action failed.");
    } finally {
      setSubmitting(false);
    }
  };

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
            <React.Fragment key={`${c.asset.address}-${i}`}>
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
            onClick={() => selectMode("deposit")}
            className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
              mode === "deposit"
                ? "border-tactical-accent bg-tactical-accent text-[#0a0a0a]"
                : "border-tactical-border hover:border-tactical-accent hover:text-tactical-accent"
            }`}
          >
            + Collateral
          </button>
          <button
            onClick={() => selectMode("withdraw")}
            className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
              mode === "withdraw"
                ? "border-tactical-accent bg-tactical-accent text-[#0a0a0a]"
                : "border-tactical-border hover:border-tactical-accent hover:text-tactical-accent"
            }`}
          >
            Withdraw
          </button>
        </div>

        {mode && selectedCollateral && (
          <div className="border-t border-tactical-border pt-3 mt-3">
            <div className="text-[9px] text-tactical-dim uppercase tracking-wider mb-2">
              {mode === "deposit" ? "Add Collateral" : "Withdraw Collateral"}
            </div>

            {vault.collaterals.length > 1 && (
              <select
                value={assetAddress}
                onChange={(e) => {
                  setAssetAddress(e.target.value);
                  setWithdrawPct(null);
                  setWithdrawCustom("");
                  setDepositAmount("");
                  setError(null);
                  setConfirmed(null);
                }}
                className="w-full bg-tactical-bg border border-tactical-border px-2 py-1.5 text-[11px] font-mono mb-2 focus:outline-none focus:border-tactical-accent"
              >
                {vault.collaterals.map((c) => (
                  <option key={c.asset.address} value={c.asset.address}>
                    {c.asset.symbol}
                  </option>
                ))}
              </select>
            )}

            {!confirmed && mode === "deposit" && (
              <>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder={`Amount in ${selectedCollateral.asset.symbol}`}
                  className="w-full bg-tactical-bg border border-tactical-border px-2 py-1.5 text-[11px] font-mono mb-2 focus:outline-none focus:border-tactical-accent"
                />

                {depositAmount && (
                  <div className="mb-2 px-1 text-[10px] text-tactical-dim">
                    Deposit: <span className="text-tactical-text font-bold">{depositAmount} {selectedCollateral.asset.symbol}</span>
                  </div>
                )}
              </>
            )}

            {!confirmed && mode === "withdraw" && (
              <>
                <div className="flex gap-1 mb-2">
                  {["25", "50", "75", "MAX"].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => setWithdrawPct(pct === "MAX" ? "100" : pct)}
                      className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                        withdrawPct === (pct === "MAX" ? "100" : pct)
                          ? "border-tactical-accent bg-tactical-accent text-[#0a0a0a]"
                          : "border-tactical-border hover:border-tactical-accent hover:text-tactical-accent"
                      }`}
                    >
                      {pct === "MAX" ? "MAX" : `${pct}%`}
                    </button>
                  ))}
                  <button
                    onClick={() => setWithdrawPct("custom")}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                      withdrawPct === "custom"
                        ? "border-tactical-accent bg-tactical-accent text-[#0a0a0a]"
                        : "border-tactical-border hover:border-tactical-accent hover:text-tactical-accent"
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {withdrawPct === "custom" && (
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={withdrawCustom}
                    onChange={(e) => setWithdrawCustom(e.target.value)}
                    placeholder={`Max: ${formatAmount(selectedCollateral.balanceWei, selectedCollateral.asset.decimals)}`}
                    className="w-full bg-tactical-bg border border-tactical-border px-2 py-1.5 text-[11px] font-mono mb-2 focus:outline-none focus:border-tactical-accent"
                  />
                )}

                {withdrawPct && selectedWithdrawAmountWei > 0n && (
                  <div className="mb-2 px-1 text-[10px] text-tactical-dim">
                    Withdraw: <span className="text-tactical-text font-bold">{formatUnits(selectedWithdrawAmountWei, selectedCollateral.asset.decimals)} {selectedCollateral.asset.symbol}</span>
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="mb-2 border border-tactical-error/40 bg-tactical-error/5 px-2 py-2 text-[10px] text-tactical-error">
                {error}
              </div>
            )}

            {confirmed ? (
              <div className="flex items-center gap-2 text-tactical-accent text-[11px] py-2">
                <Check size={14} />
                <span className="font-bold uppercase">{confirmed}</span>
              </div>
            ) : (
              <button
                onClick={() => void onSubmit()}
                disabled={
                  submitting ||
                  (mode === "deposit" ? !depositAmount || Number(depositAmount) <= 0 : !withdrawPct || selectedWithdrawAmountWei <= 0n)
                }
                className="w-full btn py-2 text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting
                  ? mode === "deposit"
                    ? "Depositing..."
                    : "Withdrawing..."
                  : mode === "deposit"
                    ? "Confirm Deposit"
                    : "Confirm Withdraw"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
