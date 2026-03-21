import React, { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Copy, Check, Terminal } from "lucide-react";

const BORROWER_SKILL = `# Tabby Borrower

This skill is the borrower/operator runtime for Tabby's Plasma vault protocol.

Model:
- borrower or agent creates a local wallet
- vaults live in VaultManager
- debt is borrowed from DebtPool
- debt asset is USDT0
- collateral is configured by the live market
- an agent wallet can be bound as a vault operator for a human-owned vault

## Local wallet persistence

~/.config/tabby-borrower/wallet.json
~/.config/tabby-borrower/state.json

## Quick Start

\`\`\`bash
cd {baseDir}
npm install
npm run build
cp .env.example .env

# Create the skill wallet
npx tabby-borrower init-wallet

# Read live market config
npx tabby-borrower market
\`\`\`

## Vault Operations

\`\`\`bash
# Quote borrowing power
npx tabby-borrower quote-borrow \\
  --collateral 0xASSET:1.25 \\
  --desired-borrow 500

# Open a vault
npx tabby-borrower open-vault

# Deposit collateral
npx tabby-borrower approve-collateral --asset 0xASSET --amount 1.25
npx tabby-borrower deposit-collateral --vault-id 1 --asset 0xASSET --amount 1.25

# Borrow / Repay / Withdraw
npx tabby-borrower borrow --vault-id 1 --amount 500
npx tabby-borrower repay --vault-id 1 --amount all
npx tabby-borrower withdraw-collateral --vault-id 1 --asset 0xASSET --amount all
\`\`\`

## Monitoring

\`\`\`bash
npx tabby-borrower vault-status --vault-id 1
npx tabby-borrower monitor-vaults --quiet-ok
npx tabby-borrower liquidate --vault-id 1 --amount 100 --asset 0xASSET
\`\`\`

## Operator Model

For human-owned vaults:
- the human wallet owns the vault
- the skill wallet is bound as operator
- the human signs the binding transaction
- after binding, the skill can manage the vault

For agent-owned vaults:
- the skill wallet itself opens and owns the vault`;

const LP_SKILL = `# Tabby Liquidity Provider

This skill is the LP runtime for Tabby's Plasma protocol.
It allows agents and users to provide liquidity to the DebtPool and monitor yields.

## Local wallet persistence

~/.config/tabby-lp/wallet.json
~/.config/tabby-lp/state.json

## Quick Start

\`\`\`bash
cd {baseDir}
npm install
npm run build

# Create the skill wallet
npx tabby-lp init-wallet

# Read pool metrics
npx tabby-lp pool-status
\`\`\`

## LP Operations

\`\`\`bash
# Deposit liquidity
npx tabby-lp deposit-liquidity --amount 100

# Withdraw liquidity
npx tabby-lp withdraw-liquidity --all

# Monitor pool
npx tabby-lp monitor-pool
\`\`\`

## Agent LP Strategy

- Yield Capture: monitor pool-status, deposit when Supply APY > target
- Risk Mitigation: monitor utilizationBps, withdraw if > 95%
- Autonomous Monitoring: use cron for periodic checks`;

type Tab = "borrower" | "lp";

export const AgentSkillPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("borrower");
  const [copied, setCopied] = useState(false);

  const content = tab === "borrower" ? BORROWER_SKILL : LP_SKILL;

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      className="min-h-screen bg-[#0c0c0c] text-[#c8c8b8] font-mono"
    >
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-[11px] text-[#555] uppercase tracking-wider hover:text-[#28c840] transition-colors cursor-pointer"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <div className="flex items-center gap-2 text-[11px] text-[#555] uppercase tracking-wider">
            <Terminal size={14} />
            Tabby Skills
          </div>
        </div>

        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setTab("borrower")}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider cursor-pointer transition-all ${
              tab === "borrower"
                ? "bg-[#28c840] text-[#0a0a0a]"
                : "bg-[#1a1a1a] text-[#555] hover:text-[#888]"
            }`}
          >
            Borrower
          </button>
          <button
            onClick={() => setTab("lp")}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider cursor-pointer transition-all ${
              tab === "lp"
                ? "bg-[#28c840] text-[#0a0a0a]"
                : "bg-[#1a1a1a] text-[#555] hover:text-[#888]"
            }`}
          >
            LP Provider
          </button>
          <div className="flex-1" />
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-2 text-[10px] text-[#555] uppercase tracking-wider border border-[#2a2a2a] hover:border-[#28c840] hover:text-[#28c840] transition-colors cursor-pointer"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="bg-[#0a0a0a] border border-[#222] overflow-hidden">
          <div className="bg-[#141414] border-b border-[#222] px-4 py-1.5 flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#ff5f57] opacity-80" />
              <div className="w-2 h-2 rounded-full bg-[#febc2e] opacity-80" />
              <div className="w-2 h-2 rounded-full bg-[#28c840] opacity-80" />
            </div>
            <span className="text-[9px] text-[#444] ml-2">
              {tab === "borrower" ? "tabby-borrower/SKILL.md" : "tabby-lp/SKILL.md"}
            </span>
          </div>

          <div className="p-6 text-[12px] leading-[1.8] overflow-y-auto max-h-[calc(100vh-220px)]">
            {content.split("\n").map((line, i) => {
              if (line.startsWith("# ")) {
                return (
                  <div key={i} className="text-[#28c840] font-bold text-[16px] mt-4 mb-2">
                    {line.replace("# ", "")}
                  </div>
                );
              }
              if (line.startsWith("## ")) {
                return (
                  <div key={i} className="text-[#c8c8b8] font-bold text-[13px] mt-6 mb-2 border-b border-[#222] pb-1">
                    {line.replace("## ", "")}
                  </div>
                );
              }
              if (line.startsWith("```")) {
                return null;
              }
              if (line.startsWith("npx ") || line.startsWith("cd ") || line.startsWith("npm ") || line.startsWith("cp ") || line.startsWith("# ")) {
                return (
                  <div key={i} className="text-[#28c840] bg-[#0d1a0f] px-3 py-0.5 my-0.5 border-l-2 border-[#28c840]/30">
                    {line}
                  </div>
                );
              }
              if (line.startsWith("- ")) {
                return (
                  <div key={i} className="text-[#888] pl-4">
                    <span className="text-[#28c840] mr-2">›</span>{line.replace("- ", "")}
                  </div>
                );
              }
              if (line.trim() === "") {
                return <div key={i} className="h-2" />;
              }
              return (
                <div key={i} className="text-[#888]">{line}</div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
