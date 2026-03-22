import React from "react";
import { motion } from "framer-motion";
import { User, Bot } from "lucide-react";

interface ModeSelectProps {
  onSelect: (mode: "human" | "agent") => void;
}

export const ModeSelect: React.FC<ModeSelectProps> = ({ onSelect }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-[#0c0c0c] p-8"
    >
      <div className="w-full max-w-xl flex flex-col items-center text-center">
        <div className="flex items-center justify-center gap-1.5 mb-3">
          <img src="/favicon.svg" alt="Tabby Logo" className="w-12 h-12" />
          <h1 className="text-4xl font-black tracking-[0.15em] uppercase text-tactical-accent leading-none">
            TABBY
          </h1>
        </div>
        <p className="text-[11px] tracking-[0.3em] uppercase text-[#444] mb-12">
          Liquidity Rail on OpenClaw
        </p>

        <div className="grid grid-cols-2 gap-4">
          <motion.button
            whileHover={{ borderColor: "#28c840" }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect("human")}
            className="border border-[#2a2a2a] bg-[#141414] p-8 flex flex-col items-center gap-4 cursor-pointer transition-all hover:shadow-[0_0_30px_rgba(40,200,64,0.08)] group"
          >
            <User size={32} className="text-[#555] group-hover:text-[#28c840] transition-colors" />
            <div>
              <div className="text-[14px] font-black uppercase tracking-wider text-[#c8c8b8] mb-2">
                I'm a Human
              </div>
              <div className="text-[10px] text-[#555] leading-relaxed uppercase tracking-wider">
                Connect wallet, chat with Tabby, manage positions
              </div>
            </div>
          </motion.button>

          <motion.button
            whileHover={{ borderColor: "#28c840" }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect("agent")}
            className="border border-[#2a2a2a] bg-[#141414] p-8 flex flex-col items-center gap-4 cursor-pointer transition-all hover:shadow-[0_0_30px_rgba(40,200,64,0.08)] group"
          >
            <Bot size={32} className="text-[#555] group-hover:text-[#28c840] transition-colors" />
            <div>
              <div className="text-[14px] font-black uppercase tracking-wider text-[#c8c8b8] mb-2">
                I'm an Agent
              </div>
              <div className="text-[10px] text-[#555] leading-relaxed uppercase tracking-wider">
                Open quickstart, commands, risk rules, and skill files
              </div>
            </div>
          </motion.button>
        </div>

        <div className="mt-8 text-[9px] text-[#333] uppercase tracking-widest">
          Tabby kernel v1.0
        </div>
      </div>
    </motion.div>
  );
};
