import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

const BOOT_SEQUENCE = [
  "tabby@kernel:~$ ./init --protocol tabby-v1",
  "Loading shared libraries... done",
  "Connecting to Plasma RPC endpoint",
  "  ├─ node: wss://plasma.mainnet.io",
  "  ├─ chain_id: 1088",
  "  └─ latency: 42ms",
  "Syncing asset registries [████████████] 100%",
  "Fetching market oracle data",
  "  ├─ ETH/USD: $3,241.08",
  "  └─ USDC/USD: $1.0001",
  "Establishing OpenClaw session",
  "  └─ agent: tabby-borrower-v1",
  "Verifying operator permissions",
  "  └─ status: AUTHORIZED",
  "",
  "All systems nominal. Ready.",
];

export const LoadingScreen: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [visibleLines, setVisibleLines] = useState(0);
  const [progress, setProgress] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const blink = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    let lineIndex = 0;
    const lineInterval = setInterval(() => {
      if (lineIndex < BOOT_SEQUENCE.length) {
        lineIndex++;
        setVisibleLines(lineIndex);
      } else {
        clearInterval(lineInterval);
      }
    }, 200);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          setTimeout(onComplete, 600);
          return 100;
        }
        return prev + Math.random() * 12;
      });
    }, 250);

    return () => {
      clearInterval(lineInterval);
      clearInterval(progressInterval);
    };
  }, [onComplete]);

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
          <div className="text-[10px] tracking-[0.4em] uppercase text-[#555] mt-1">
            Liquidity Rail
          </div>
        </div>

        <div className="bg-[#0a0a0a] border border-[#222] rounded-sm overflow-hidden shadow-[0_0_40px_rgba(0,255,80,0.03)]">
          <div className="bg-[#141414] border-b border-[#222] px-3 py-1.5 flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#ff5f57] opacity-80" />
              <div className="w-2 h-2 rounded-full bg-[#febc2e] opacity-80" />
              <div className="w-2 h-2 rounded-full bg-[#28c840] opacity-80" />
            </div>
            <span className="text-[9px] text-[#444] font-mono ml-2">tabby@kernel:~/boot</span>
          </div>

          <div className="p-4 h-[300px] overflow-y-auto font-mono text-[12px] leading-[1.7]">
            {BOOT_SEQUENCE.slice(0, visibleLines).map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.05 }}
                className={`${
                  line.startsWith("tabby@") ? "text-[#28c840]" :
                  line.startsWith("  ├─") || line.startsWith("  └─") ? "text-[#555]" :
                  line === "All systems nominal. Ready." ? "text-[#28c840] font-bold" :
                  "text-[#888]"
                }`}
              >
                {line || "\u00A0"}
              </motion.div>
            ))}

            <div className="text-[#28c840] mt-0.5">
              <span>tabby@kernel:~$ </span>
              <span className={`${cursorVisible ? "opacity-100" : "opacity-0"}`}>▌</span>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1 flex justify-between text-[10px] font-bold text-[#666]">
            <span>{progress >= 100 ? "BOOT COMPLETE" : "BOOTING..."}</span>
            <span>{Math.min(Math.round(progress), 100)}%</span>
          </div>
          <div className="h-1 bg-[#1a1a1a] border border-[#222]">
            <motion.div
              className="h-full bg-[#28c840]"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>

        <div className="mt-3 text-center text-[9px] text-[#333] uppercase tracking-widest">
          Tabby kernel v1.0
        </div>
      </div>
    </motion.div>
  );
};
