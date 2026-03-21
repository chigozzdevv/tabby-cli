import React from "react";
import { motion } from "framer-motion";
import { MoveRight } from "lucide-react";

export interface ContextItem {
  id: string;
  type: "loan" | "pool" | "vault";
  title: string;
  subtitle: string;
  stats: { label: string; value: string }[];
}

export const ContextCard: React.FC<{ item: ContextItem }> = ({ item }) => {
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className="draggable-card group relative"
      draggable
      onDragStart={(e: any) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData("application/tabby-context", JSON.stringify(item));
        }
      }}
    >
      <div className="flex justify-between items-start mb-1">
        <div>
          <div className="text-[9px] text-tactical-accent uppercase tracking-widest">{item.type}</div>
          <div className="font-black text-[13px] mt-0.5">{item.title}</div>
          <div className="text-[10px] text-[#999]">{item.subtitle}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-tactical-border">
        {item.stats.map((stat, i) => (
          <div key={i}>
            <div className="text-[8px] text-[#999] uppercase tracking-wider">{stat.label}</div>
            <div className="font-bold text-[12px] text-tactical-text">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="absolute right-2 bottom-2 text-[8px] flex items-center gap-1 text-tactical-dim opacity-0 group-hover:opacity-100 uppercase transition-opacity">
        Drag <MoveRight size={8} />
      </div>
    </motion.div>
  );
};
