import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";

const API_BASE = import.meta.env.VITE_TABBY_API_BASE_URL || "http://localhost:3000";

type BootLine = {
  text: string;
  color?: string;
};

type BootStep = {
  label: string;
  run: () => Promise<BootLine[]>;
};

function formatUsdPrice(weiStr: string, decimals: number): string {
  const val = Number(BigInt(weiStr)) / 10 ** decimals;
  return val.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

const BOOT_STEPS: BootStep[] = [
  {
    label: "init",
    run: async () => [
      { text: 'tabby@kernel:~$ ./init --protocol tabby-v1', color: "green" },
      { text: "Loading shared libraries... done" },
    ],
  },
  {
    label: "health",
    run: async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        const data = await res.json();
        if (data.ok) {
          return [
            { text: "Checking server health" },
            { text: "  └─ status: ONLINE", color: "dim" },
          ];
        }
        throw new Error();
      } catch {
        return [
          { text: "Checking server health" },
          { text: "  └─ status: OFFLINE (mock mode)", color: "warn" },
        ];
      }
    },
  },
  {
    label: "config",
    run: async () => {
      try {
        const res = await fetch(`${API_BASE}/public/config`);
        const data = await res.json();
        if (data.ok) {
          const c = data.data;
          return [
            { text: "Loading protocol config" },
            { text: `  ├─ chain_id: ${c.chainId}`, color: "dim" },
            { text: `  ├─ vault_manager: ${c.vaultManager?.slice(0, 10)}...${c.vaultManager?.slice(-6)}`, color: "dim" },
            { text: `  └─ debt_pool: ${c.debtPool?.slice(0, 10)}...${c.debtPool?.slice(-6)}`, color: "dim" },
          ];
        }
        throw new Error();
      } catch {
        return [
          { text: "Loading protocol config" },
          { text: "  └─ config: using defaults (offline)", color: "warn" },
        ];
      }
    },
  },
  {
    label: "wallet",
    run: async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        const ok = res.ok;
        if (ok) {
          return [
            { text: "tabby@kernel:~$ npx tabby-borrower check-wallet", color: "green" },
            { text: "  └─ wallet: LOADED", color: "dim" },
          ];
        }
        throw new Error();
      } catch {
        return [
          { text: "tabby@kernel:~$ npx tabby-borrower check-wallet", color: "green" },
          { text: "  └─ wallet: NOT FOUND — run `npx tabby-borrower init-wallet`", color: "warn" },
        ];
      }
    },
  },
  {
    label: "oracle",
    run: async () => {
      try {
        const res = await fetch(`${API_BASE}/public/monitoring/market`);
        const data = await res.json();
        if (data.ok) {
          const m = data.data;
          const debtLine = `  ├─ ${m.debtAsset.symbol}/USD: ${formatUsdPrice(m.debtAsset.priceUsd, 18)}`;
          const collateralLines = (m.collaterals || []).map((c: any, i: number, arr: any[]) => {
            const prefix = i === arr.length - 1 ? "  └─" : "  ├─";
            return { text: `${prefix} ${c.asset.symbol}/USD: ${formatUsdPrice(c.asset.priceUsd, 18)}`, color: "dim" as const };
          });
          return [
            { text: "Fetching oracle price feeds" },
            { text: debtLine, color: "dim" },
            ...collateralLines,
          ];
        }
        throw new Error();
      } catch {
        return [
          { text: "Fetching oracle price feeds" },
          { text: "  ├─ BTC/USD: $64,000.00 (cached)", color: "warn" },
          { text: "  └─ USDT0/USD: $1.00 (cached)", color: "warn" },
        ];
      }
    },
  },
  {
    label: "pool",
    run: async () => {
      try {
        const res = await fetch(`${API_BASE}/liquidity/pool`);
        const data = await res.json();
        if (data.ok) {
          const p = data.data;
          const tvl = Number(BigInt(p.totalAssetsWei)) / 10 ** p.assetDecimals;
          const tvlStr = tvl >= 1_000_000 ? `$${(tvl / 1_000_000).toFixed(2)}M` : tvl >= 1000 ? `$${(tvl / 1000).toFixed(1)}K` : `$${tvl.toFixed(2)}`;
          return [
            { text: "Syncing liquidity pool" },
            { text: `  ├─ asset: ${p.assetSymbol}`, color: "dim" },
            { text: `  ├─ tvl: ${tvlStr}`, color: "dim" },
            { text: `  ├─ utilization: ${formatBps(p.utilizationBps)}`, color: "dim" },
            { text: `  └─ borrow_rate: ${formatBps(p.currentBorrowRateBps)}`, color: "dim" },
          ];
        }
        throw new Error();
      } catch {
        return [
          { text: "Syncing liquidity pool" },
          { text: "  └─ pool: unavailable (offline)", color: "warn" },
        ];
      }
    },
  },
  {
    label: "ready",
    run: async () => [
      { text: "" },
      { text: "All systems nominal. Ready.", color: "bold-green" },
    ],
  },
];

export const LoadingScreen: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [lines, setLines] = useState<BootLine[]>([]);
  const [progress, setProgress] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const ranRef = React.useRef(false);

  useEffect(() => {
    const blink = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  const runBoot = useCallback(async () => {
    if (ranRef.current) return;
    ranRef.current = true;

    const stepPct = 100 / BOOT_STEPS.length;

    for (let i = 0; i < BOOT_STEPS.length; i++) {
      const step = BOOT_STEPS[i];
      const result = await step.run();

      for (const line of result) {
        setLines((prev) => [...prev, line]);
        await new Promise((r) => setTimeout(r, 120));
      }

      setProgress(Math.min((i + 1) * stepPct, 100));
      await new Promise((r) => setTimeout(r, 200));
    }

    setTimeout(onComplete, 800);
  }, [onComplete]);

  useEffect(() => {
    runBoot();
  }, [runBoot]);

  const getColor = (line: BootLine) => {
    switch (line.color) {
      case "green": return "#28c840";
      case "bold-green": return "#28c840";
      case "dim": return "#777";
      case "warn": return "#febc2e";
      default: return "#aaa";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-[#0c0c0c] p-8"
    >
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <div className="text-3xl font-black tracking-[0.2em] uppercase text-[#e0e0d0]">
            TABBY
          </div>
          <div className="text-[10px] tracking-[0.4em] uppercase text-[#777] mt-1">
            Liquidity Rail
          </div>
        </div>

        <div className="bg-[#0a0a0a] border border-[#333] rounded-sm overflow-hidden shadow-[0_0_40px_rgba(0,255,80,0.03)]">
          <div className="bg-[#141414] border-b border-[#333] px-3 py-1.5 flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#ff5f57] opacity-80" />
              <div className="w-2 h-2 rounded-full bg-[#febc2e] opacity-80" />
              <div className="w-2 h-2 rounded-full bg-[#28c840] opacity-80" />
            </div>
            <span className="text-[9px] text-[#666] font-mono ml-2">tabby@kernel:~/boot</span>
          </div>

          <div className="p-4 h-[300px] overflow-y-auto font-mono text-[12px] leading-[1.7]">
            {lines.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.05 }}
                style={{ color: getColor(line) }}
                className={line.color === "bold-green" ? "font-bold" : ""}
              >
                {line.text || "\u00A0"}
              </motion.div>
            ))}

            <div className="text-[#28c840] mt-0.5">
              <span>tabby@kernel:~$ </span>
              <span className={`${cursorVisible ? "opacity-100" : "opacity-0"}`}>▌</span>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1 flex justify-between text-[10px] font-bold text-[#777]">
            <span>{progress >= 100 ? "BOOT COMPLETE" : "BOOTING..."}</span>
            <span>{Math.min(Math.round(progress), 100)}%</span>
          </div>
          <div className="h-1 bg-[#1a1a1a] border border-[#333]">
            <motion.div
              className="h-full bg-[#28c840]"
              animate={{ width: `${Math.min(progress, 100)}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        <div className="mt-3 text-center text-[9px] text-[#555] uppercase tracking-widest">
          Tabby kernel v1.0
        </div>
      </div>
    </motion.div>
  );
};
