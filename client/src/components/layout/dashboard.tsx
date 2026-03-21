import { ActivityFeed } from "../sidebar/activity-feed";
import { ContextCard } from "../sidebar/context-card";
import { ChatWindow } from "../chat/chat-window";
import { useSocket } from "../../hooks/use-socket";
import { Plug } from "lucide-react";

const MOCK_CARDS = [
  {
    id: "vault-1",
    type: "loan" as const,
    title: "VAULT #042",
    subtitle: "ETH-A / USDC",
    stats: [
      { label: "HF", value: "1.42" },
      { label: "DEBT", value: "10K USDC" },
    ],
  },
  {
    id: "pool-1",
    type: "pool" as const,
    title: "USDC POOL",
    subtitle: "Lending Liquidity",
    stats: [
      { label: "APY", value: "8.4%" },
      { label: "TVL", value: "$1.2M" },
    ],
  },
];

export const Dashboard: React.FC = () => {
  const { activities, isConnected } = useSocket();

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
            <div className="panel-header mb-2 !border-x-0 !border-t-0">
              <span>Active Context</span>
              <span className="text-tactical-accent text-[9px]">{MOCK_CARDS.length}</span>
            </div>
            {MOCK_CARDS.map((card) => (
              <ContextCard key={card.id} item={card} />
            ))}
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
