import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { Activity } from "../components/sidebar/activity-feed";

const SOCKET_URL = import.meta.env.VITE_TABBY_API_BASE_URL || "http://localhost:3000";

export const useSocket = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const s = io(SOCKET_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    s.on("connect", () => {
      console.log("Tactics: Signal established.");
      setIsConnected(true);
    });

    s.on("disconnect", () => {
      console.log("Tactics: Signal lost.");
      setIsConnected(false);
    });

    s.on("new-activity", (data: any) => {
      console.log("Tactics: New activity signal received.", data);
      
      const newActivity: Activity = {
        id: data.id || data._id || Math.random().toString(),
        type: mapActivityType(data.type),
        title: formatActivityTitle(data),
        description: formatActivityDescription(data),
        timestamp: new Date(data.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setActivities((prev) => [newActivity, ...prev].slice(0, 50));
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  return { socket, activities, isConnected };
};

function mapActivityType(type: string): Activity["type"] {
  if (type.startsWith("lp.")) return "deposit";
  if (type === "debt.borrowed") return "borrow";
  if (type === "debt.repaid") return "repay";
  if (type === "vault.liquidated") return "alert";
  return "trade";
}

function formatActivityTitle(data: any): string {
  switch (data.type) {
    case "lp.deposited": return "LIQUIDITY ADDED";
    case "lp.withdrawn": return "LIQUIDITY REMOVED";
    case "vault.opened": return "VAULT OPENED";
    case "collateral.deposited": return "COLLATERAL IN";
    case "collateral.withdrawn": return "COLLATERAL OUT";
    case "debt.borrowed": return "BORROW EXECUTED";
    case "debt.repaid": return "DEBR REPAID";
    case "vault.liquidated": return "LIQUIDATION ALERT";
    default: return data.type.toUpperCase().replace(".", " ");
  }
}

function formatActivityDescription(data: any): string {
  if (data.payload?.assetsWei) return `${(BigInt(data.payload.assetsWei) / 10n**18n).toString()} ASSETS`;
  if (data.payload?.amountWei) return `${(BigInt(data.payload.amountWei) / 10n**18n).toString()} TOKENS`;
  return `Signal detected on vault #${data.vaultId || "N/A"}`;
}
