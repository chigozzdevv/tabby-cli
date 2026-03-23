import { useState, useEffect } from "react";
import { ActivityFeed } from "../sidebar/activity-feed";
import { ContextCard } from "../sidebar/context-card";
import type { ContextItem } from "../sidebar/context-card";
import { ChatWindow } from "../chat/chat-window";
import { useSocket } from "../../hooks/use-socket";
import { useWallet } from "../../hooks/use-wallet";
import { Wallet } from "lucide-react";
import { listPositions, getLpPosition, formatUsd, formatAmount, formatHealthFactor } from "../../lib/api-client";
import type { VaultPosition } from "../../lib/api-client";

type FilterType = "all" | "vault" | "pool";

const FILTERS: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "vault", label: "Vaults" },
  { key: "pool", label: "LP" },
];

function vaultToCard(v: VaultPosition): ContextItem {
  const hf = formatHealthFactor(v.healthFactorE18);
  return {
    id: `vault-${v.vaultId}`,
    type: "vault",
    title: `VAULT #${String(v.vaultId).padStart(3, "0")}`,
    subtitle: v.collaterals.map((c) => c.asset.symbol).join(" + "),
    stats: [
      { label: "HF", value: hf.value },
      { label: "DEBT", value: formatUsd(v.debtValueUsd) },
    ],
  };
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export const Dashboard: React.FC = () => {
  const { activities, isConnected: serverConnected } = useSocket();
  const { address, isConnected: walletConnected, isConnecting, connect, disconnect, error: walletError } = useWallet();
  const [filter, setFilter] = useState<FilterType>("all");
  const [positions, setPositions] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setPositions([]);
      return;
    }

    let cancelled = false;

    async function fetchPositions() {
      setLoading(true);
      const items: ContextItem[] = [];

      const vaults = await listPositions(address!);
      for (const v of vaults) {
        items.push(vaultToCard(v));
      }

      const lp = await getLpPosition(address!);
      if (lp && BigInt(lp.shares) > 0n) {
        items.push({
          id: "lp-position",
          type: "pool",
          title: "LP POSITION",
          subtitle: `${lp.assetSymbol} Pool`,
          stats: [
            { label: "DEPOSITED", value: `${formatAmount(lp.estimatedAssetsWei, lp.assetDecimals)} ${lp.assetSymbol}` },
            { label: "SHARES", value: formatAmount(lp.shares, lp.assetDecimals) },
          ],
        });
      }

      if (!cancelled) {
        setPositions(items);
        setLoading(false);
      }
    }

    fetchPositions();
    const interval = setInterval(fetchPositions, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address]);

  const filtered = filter === "all" ? positions : positions.filter((p) => p.type === filter);

  const getCount = (key: FilterType) => {
    if (key === "all") return positions.length;
    if (key === "vault") return positions.filter((p) => p.type === "vault").length;
    return positions.filter((p) => p.type === "pool").length;
  };

  return (
    <div className="tactical-container">
      <header className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-1.5">
          <img src="/favicon.svg" alt="Tabby Logo" className="w-8 h-8" />
          <h1 className="text-2xl font-black tracking-widest uppercase leading-none text-tactical-accent">TABBY</h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[10px] text-tactical-dim">
            <div className={`w-1.5 h-1.5 rounded-full ${serverConnected ? "bg-tactical-accent animate-pulse" : "bg-tactical-error"}`} />
            {serverConnected ? "SERVER ONLINE" : "SERVER OFFLINE"}
          </div>

          <div className="panel px-3 py-1.5 flex items-center gap-3 text-[10px]">
            <Wallet size={12} className={walletConnected ? "text-tactical-accent" : "text-tactical-dim"} />
            {walletConnected ? (
              <>
                <span className="text-tactical-text font-mono">{truncateAddress(address!)}</span>
                <button onClick={disconnect} className="btn py-0.5 px-2 text-[9px]">DISCONNECT</button>
              </>
            ) : (
              <>
                <span className="text-tactical-dim">No wallet</span>
                <button
                  onClick={connect}
                  disabled={isConnecting}
                  className="btn py-0.5 px-2 text-[9px] disabled:opacity-50"
                >
                  {isConnecting ? "..." : "CONNECT"}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {walletError && (
        <div className="mb-3 px-3 py-2 border border-tactical-error/40 bg-tactical-error/5 text-[10px] text-tactical-error uppercase tracking-wider">
          {walletError}
        </div>
      )}

      <div className="border-t border-tactical-border mb-4" />

      <div className="tactical-grid">
        <aside className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="panel-header mb-0 !border-x-0 !border-t-0">
              <span>Positions</span>
              <span className="text-tactical-accent text-[9px]">{walletConnected ? positions.length : "—"}</span>
            </div>

            <div className="flex border-b border-tactical-border">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex-1 py-2 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer border-b-2 ${
                    filter === f.key
                      ? "border-tactical-accent text-tactical-accent"
                      : "border-transparent text-tactical-dim hover:text-tactical-text"
                  }`}
                >
                  {f.label}
                  <span className={`ml-1 text-[8px] ${filter === f.key ? "text-tactical-accent/70" : "text-tactical-dim"}`}>
                    {walletConnected ? getCount(f.key) : "—"}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-2">
              {!walletConnected ? (
                <div className="text-center text-[10px] text-tactical-dim uppercase py-6">
                  Connect wallet to view positions
                </div>
              ) : loading ? (
                <div className="text-center text-[10px] text-tactical-dim uppercase py-6 animate-pulse">
                  Fetching positions...
                </div>
              ) : filtered.length > 0 ? (
                filtered.map((card) => (
                  <ContextCard key={card.id} item={card} />
                ))
              ) : (
                <div className="text-center text-[10px] text-tactical-dim uppercase py-6">
                  {positions.length === 0
                    ? "No positions found"
                    : `No ${filter === "vault" ? "vault" : "LP"} positions`}
                </div>
              )}
            </div>
          </div>

          <div className="min-h-[220px] shrink-0 basis-[32%] overflow-hidden">
            <ActivityFeed activities={activities} />
          </div>
        </aside>

        <ChatWindow />
      </div>
    </div>
  );
};
