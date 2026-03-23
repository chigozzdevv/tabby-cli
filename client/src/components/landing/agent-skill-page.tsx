import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Copy } from "lucide-react";

import borrowerSkill from "../../../../skills/tabby-borrower/SKILL.md?raw";
import lpSkill from "../../../../skills/tabby-lp/SKILL.md?raw";

type Tab = "borrower" | "operator" | "lp";

type RoleConfig = {
  label: string;
  desc: string;
  skillPath: string;
  skillText: string;
  commands: string[];
  prompts: string[];
};

const INSTALL_COMMAND = `git clone https://github.com/chigozzdevv/tabby-cli
cd tabby-cli/skills
npm install && npm run build`;

const ROLES: Record<Tab, RoleConfig> = {
  borrower: {
    label: "Borrower",
    desc: "Manage your own vaults, collateral, borrowing, and health.",
    skillPath: "skills/tabby-borrower/SKILL.md",
    skillText: borrowerSkill,
    commands: [
      "node dist/tabby-borrower/bin/tabby-borrower.js init-wallet",
      "node dist/tabby-borrower/bin/tabby-borrower.js market",
      "node dist/tabby-borrower/bin/tabby-borrower.js quote-borrow --collateral WETH:1.25 --desired-borrow 500",
    ],
    prompts: [
      "How much can I borrow with 2 WETH?",
      "Open a vault and quote 500 USDT0.",
      "Check vault #3 health.",
    ],
  },
  operator: {
    label: "Operator",
    desc: "Manage a human-owned vault after the owner binds your agent wallet.",
    skillPath: "skills/tabby-borrower/SKILL.md",
    skillText: borrowerSkill,
    commands: [
      "node dist/tabby-borrower/bin/tabby-borrower.js init-wallet",
      "node dist/tabby-borrower/bin/tabby-borrower.js prepare-bind-operator --vault-id 1",
      "node dist/tabby-borrower/bin/tabby-borrower.js confirm-bind-operator --vault-id 1",
    ],
    prompts: [
      "Prepare operator binding for vault #3.",
      "Check delegated vault #3 health.",
      "Repay 100 USDT0 on vault #3.",
    ],
  },
  lp: {
    label: "LP",
    desc: "Provide USDT0 liquidity, monitor APY, deposit, and withdraw.",
    skillPath: "skills/tabby-lp/SKILL.md",
    skillText: lpSkill,
    commands: [
      "node dist/tabby-lp/bin/tabby-lp.js init-wallet",
      "node dist/tabby-lp/bin/tabby-lp.js pool-status",
      "node dist/tabby-lp/bin/tabby-lp.js deposit-liquidity --amount 100",
    ],
    prompts: [
      "What is the current pool APY?",
      "Deposit 1000 USDT0 into the pool.",
      "Withdraw all my pool liquidity.",
    ],
  },
};

const TABS: Tab[] = ["borrower", "operator", "lp"];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-[#55554d]">
      {children}
    </p>
  );
}

function CopyButton({
  copied,
  label,
  onClick,
}: {
  copied: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[#8e8e82] transition-colors hover:border-[#28c840] hover:text-[#28c840]"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

function CodeCard({
  label,
  code,
  copied,
  onCopy,
}: {
  label: string;
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="border border-[#232323] bg-[#101010]">
      <div className="flex items-center justify-between gap-3 border-b border-[#232323] px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[#66665f]">{label}</div>
        <CopyButton copied={copied} label="Copy" onClick={onCopy} />
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[12px] leading-7 text-[#a9f3b3]">{code}</pre>
    </div>
  );
}

export const AgentSkillPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("borrower");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showSkill, setShowSkill] = useState(false);

  const role = ROLES[tab];

  const handleCopy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      className="h-screen overflow-y-auto bg-[#0c0c0c] text-[#c8c8b8] font-mono"
    >
      <div className="mx-auto max-w-4xl px-6 py-10">
        <button
          onClick={onBack}
          className="mb-10 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[#4d4d46] transition-colors hover:text-[#28c840]"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <h1 className="text-2xl font-black uppercase tracking-[0.1em] text-[#ececdf]">
          Agent Setup
        </h1>
        <p className="mt-2 text-[12px] text-[#66665f]">
          Install once, pick a role, copy the skill, start prompting.
        </p>

        <div className="mt-10">
          <SectionLabel>Install Once</SectionLabel>
          <CodeCard
            label="Tabby CLI"
            code={INSTALL_COMMAND}
            copied={copiedKey === "install"}
            onCopy={() => handleCopy("install", INSTALL_COMMAND)}
          />
        </div>

        <div className="mt-10">
          <SectionLabel>Choose Role</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {TABS.map((key) => {
              const active = key === tab;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setTab(key);
                    setCopiedKey(null);
                    setShowSkill(false);
                  }}
                  className={`px-4 py-2 text-[12px] uppercase tracking-[0.12em] transition-colors ${
                    active
                      ? "bg-[#28c840] text-[#0c0c0c] font-bold"
                      : "border border-[#2a2a2a] text-[#6f6f66] hover:border-[#28c840] hover:text-[#c8c8b8]"
                  }`}
                >
                  {ROLES[key].label}
                </button>
              );
            })}
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="mt-6 space-y-6"
          >
            <div className="border border-[#232323] bg-[#101010] p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-[#55554d]">
                    {role.label}
                  </div>
                  <p className="mt-3 max-w-2xl text-[13px] leading-7 text-[#8a8a80]">
                    {role.desc}
                  </p>
                  <p className="mt-4 text-[11px] text-[#44443d]">{role.skillPath}</p>
                </div>
                <CopyButton
                  copied={copiedKey === "skill"}
                  label="Copy Skill"
                  onClick={() => handleCopy("skill", role.skillText)}
                />
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="space-y-4">
                <SectionLabel>Starter Commands</SectionLabel>
                {role.commands.map((command, index) => (
                  <CodeCard
                    key={command}
                    label={`Command 0${index + 1}`}
                    code={command}
                    copied={copiedKey === `${tab}-command-${index}`}
                    onCopy={() => handleCopy(`${tab}-command-${index}`, command)}
                  />
                ))}
              </div>

              <div className="space-y-4">
                <SectionLabel>Try These</SectionLabel>
                <div className="border border-[#232323] bg-[#101010] p-4">
                  <div className="space-y-3">
                    {role.prompts.map((prompt, index) => (
                      <button
                        key={prompt}
                        onClick={() => handleCopy(`${tab}-prompt-${index}`, prompt)}
                        className="block w-full border border-[#1f1f1f] bg-[#0c0c0c] px-4 py-3 text-left text-[12px] leading-6 text-[#b8b8ab] transition-colors hover:border-[#28c840] hover:text-[#f0f0df]"
                      >
                        <span className="block text-[10px] uppercase tracking-[0.2em] text-[#55554d]">
                          {copiedKey === `${tab}-prompt-${index}` ? "Copied" : "Prompt"}
                        </span>
                        <span className="mt-2 block">"{prompt}"</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-[#232323] bg-[#101010] p-4">
                  <button
                    onClick={() => setShowSkill((current) => !current)}
                    className="text-[10px] uppercase tracking-[0.2em] text-[#66665f] transition-colors hover:text-[#c8c8b8]"
                  >
                    {showSkill ? "Hide" : "View"} Raw Skill
                  </button>

                  <AnimatePresence initial={false}>
                    {showSkill ? (
                      <motion.pre
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="mt-4 max-h-[380px] overflow-auto border border-[#1f1f1f] bg-[#0c0c0c] p-4 text-[11px] leading-6 text-[#88887d]"
                      >
                        {role.skillText}
                      </motion.pre>
                    ) : null}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
