import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Check, Copy } from "lucide-react";

import borrowerSkill from "../../../../skills/tabby-borrower/SKILL.md?raw";
import lpSkill from "../../../../skills/tabby-lp/SKILL.md?raw";

type Tab = "borrower" | "operator" | "lp";

const ROLES: Record<Tab, { label: string; desc: string; skillPath: string; skillText: string; prompts: string[] }> = {
  borrower: {
    label: "Borrower",
    desc: "Own and manage vaults. Deposit collateral, borrow USDT0, monitor health.",
    skillPath: "skills/tabby-borrower/SKILL.md",
    skillText: borrowerSkill,
    prompts: [
      "How much can I borrow with 2 WETH?",
      "Open a vault and quote 500 USDT0.",
      "Check vault #3 health.",
    ],
  },
  operator: {
    label: "Operator",
    desc: "Manage a human-owned vault after the owner binds you onchain.",
    skillPath: "skills/tabby-borrower/SKILL.md",
    skillText: borrowerSkill,
    prompts: [
      "Prepare operator binding for vault #3.",
      "Check delegated vault #3 health.",
      "Repay 100 USDT0 on vault #3.",
    ],
  },
  lp: {
    label: "LP",
    desc: "Provide USDT0 liquidity into DebtPool. Read APY, deposit, withdraw.",
    skillPath: "skills/tabby-lp/SKILL.md",
    skillText: lpSkill,
    prompts: [
      "What is the current pool APY?",
      "Deposit 1000 USDT0 into the pool.",
      "Withdraw all my pool liquidity.",
    ],
  },
};

const TABS: Tab[] = ["borrower", "operator", "lp"];

export const AgentSkillPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("borrower");
  const [copied, setCopied] = useState(false);
  const [showSkill, setShowSkill] = useState(false);

  const role = ROLES[tab];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(role.skillText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      className="h-screen overflow-y-auto bg-[#0c0c0c] text-[#c8c8b8] font-mono"
    >
      <div className="mx-auto max-w-2xl px-6 py-10">
        {/* Back */}
        <button
          onClick={onBack}
          className="mb-12 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[#444] hover:text-[#28c840] transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        {/* Title */}
        <h1 className="text-2xl font-black uppercase tracking-[0.1em] text-[#e8e8d8]">
          Agent Setup
        </h1>
        <p className="mt-2 text-[12px] text-[#555]">
          Clone, pick a role, copy the skill file, start prompting.
        </p>

        {/* Getting started */}
        <div className="mt-10">
          <p className="text-[10px] uppercase tracking-[0.25em] text-[#444] mb-3">
            Getting started
          </p>
          <pre className="text-[12px] leading-7 text-[#9bf0aa] bg-[#0a0a0a] p-4 overflow-x-auto">
{`git clone https://github.com/chigozzdevv/tabby-cli
cd tabby-cli/skills
npm install && npm run build`}
          </pre>
        </div>

        {/* Role picker */}
        <div className="mt-10">
          <p className="text-[10px] uppercase tracking-[0.25em] text-[#444] mb-3">
            Choose role
          </p>
          <div className="flex gap-2">
            {TABS.map((key) => (
              <button
                key={key}
                onClick={() => { setTab(key); setCopied(false); setShowSkill(false); }}
                className={`px-4 py-2 text-[12px] uppercase tracking-[0.12em] transition-colors ${
                  key === tab
                    ? "bg-[#28c840] text-[#0c0c0c] font-bold"
                    : "text-[#555] hover:text-[#999]"
                }`}
              >
                {ROLES[key].label}
              </button>
            ))}
          </div>
        </div>

        {/* Role content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-6"
          >
            <p className="text-[13px] leading-7 text-[#888]">{role.desc}</p>

            {/* Skill copy */}
            <div className="mt-6 flex items-center gap-4">
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-[#28c840] hover:text-[#5fd870] transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy skill file"}
              </button>
              <span className="text-[11px] text-[#333]">{role.skillPath}</span>
            </div>

            {/* Prompts */}
            <div className="mt-8">
              <p className="text-[10px] uppercase tracking-[0.25em] text-[#444] mb-3">
                Try saying
              </p>
              <div className="space-y-2">
                {role.prompts.map((p) => (
                  <p key={p} className="text-[12px] text-[#777]">
                    "{p}"
                  </p>
                ))}
              </div>
            </div>

            {/* View raw skill */}
            <button
              onClick={() => setShowSkill(!showSkill)}
              className="mt-8 text-[10px] uppercase tracking-[0.2em] text-[#444] hover:text-[#666] transition-colors"
            >
              {showSkill ? "Hide" : "View"} raw skill file
            </button>
            <AnimatePresence>
              {showSkill && (
                <motion.pre
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-3 max-h-[400px] overflow-auto bg-[#0a0a0a] p-4 text-[11px] leading-6 text-[#888]"
                >
                  {role.skillText}
                </motion.pre>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
