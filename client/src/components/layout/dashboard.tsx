import { useState, useEffect } from "react";
import { ActivityFeed } from "../sidebar/activity-feed";
import { ContextCard } from "../sidebar/context-card";
import type { ContextItem } from "../sidebar/context-card";
import { ChatWindow } from "../chat/chat-window";
import { useSocket } from "../../hooks/use-socket";
import { Plug } from "lucide-react";
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

const OWNER_ADDRESS = "0x5ee2796f3014b524A2C51521B48F830B8467E341";

export const Dashboard: React.FC = () => {
  const { activities, isConnected } = useSocket();
  const [filter, setFilter] = useState<FilterType>("all");
  const [positions, setPositions] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPositions() {
      setLoading(true);
      const items: ContextItem[] = [];

      const vaults = await listPositions(OWNER_ADDRESS);
      for (const v of vaults) {
        items.push(vaultToCard(v));
      }

      const lp = await getLpPosition(OWNER_ADDRESS);
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

      setPositions(items);
      setLoading(false);
    }

    fetchPositions();
    const interval = setInterval(fetchPositions, 30000);
    return () => clearInterval(interval);
  }, []);

  const filtered = filter === "all" ? positions : positions.filter((p) => p.type === filter);
  const vaultCount = positions.filter((p) => p.type === "vault").length;
  const poolCount = positions.filter((p) => p.type === "pool").length;

  const getCount = (key: FilterType) => {
    if (key === "all") return positions.length;
    if (key === "vault") return vaultCount;
    return poolCount;
  };

  return (
    <div className="tactical-container">
      <header className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-lg font-black tracking-wider uppercase leading-none">TABBY</h1>
          <p className="text-[8px] uppercase tracking-[0.3em] text-tactical-dim">Liquidity Rail</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[10px] text-tactical-dim">
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-tactical-accent animate-pulse" : "bg-tactical-error"}`} />
            {isConnected ? "CONNECTED" : "OFFLINE"}
          </div>
          <div className="panel px-3 py-1.5 flex items-center gap-3 text-[10px]">
            <Plug size={12} className="text-tactical-dim" />
            <span className="text-tactical-dim">0xEv4...0f1d</span>
            <button className="btn py-0.5 px-2 text-[9px]">
              {isConnected ? "UNLINK" : "CONNECT"}
            </button>
          </div>
        </div>
      </header>

      <div className="border-t border-tactical-border mb-4" />

      <div className="tactical-grid">
        <aside className="flex flex-col gap-3 overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="panel-header mb-0 !border-x-0 !border-t-0">
              <span>Positions</span>
              <span className="text-tactical-accent text-[9px]">{positions.length}</span>
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
                    {getCount(f.key)}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-2">
              {loading ? (
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
                    ? "No positions — server offline or no vaults"
                    : `No ${filter === "vault" ? "vault" : "LP"} positions`}
                </div>
              )}
            </div>
          </div>
          <div className="h-[45%] min-h-[200px]">
            <ActivityFeed activities={activities} />
          </div>
        </aside>

        <ChatWindow />
      </div>
    </div>
  );
};
