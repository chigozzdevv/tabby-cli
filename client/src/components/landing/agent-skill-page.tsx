import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Clipboard,
  Coins,
  Copy,
  Shield,
  Terminal,
} from "lucide-react";

import borrowerSkill from "../../../../skills/tabby-borrower/SKILL.md?raw";
import lpSkill from "../../../../skills/tabby-lp/SKILL.md?raw";

type Tab = "borrower" | "operator" | "lp";

type RoleConfig = {
  label: string;
  eyebrow: string;
  desc: string;
  skillPath: string;
  skillText: string;
  prompts: string[];
  notes: string[];
  steps: { title: string; detail: string; command?: string }[];
};

const INSTALL_COMMAND = `git clone https://github.com/chigozzdevv/tabby-cli
cd tabby-cli/skills
npm install
npm run build`;

const ROLES: Record<Tab, RoleConfig> = {
  borrower: {
    label: "Borrower",
    eyebrow: "Agent-Owned Vault",
    desc: "Use this when the agent owns the vault and will manage collateral, borrowing, repayment, and monitoring directly.",
    skillPath: "skills/tabby-borrower/SKILL.md",
    skillText: borrowerSkill,
    prompts: [
      "How much can I borrow with 2 WETH?",
      "Open a vault and quote 500 USDT0.",
      "Check vault #3 health.",
    ],
    notes: [
      "The agent wallet opens and owns the vault.",
      "Quote first, then borrow with a buffer instead of at the max.",
      "Use monitoring for health-factor drift and low gas alerts.",
    ],
    steps: [
      {
        title: "Initialize the wallet",
        detail: "Create the local agent wallet used by the borrower runtime.",
        command: "node dist/tabby-borrower/bin/tabby-borrower.js init-wallet",
      },
      {
        title: "Read market state",
        detail: "Check the runtime, collateral set, and current pool conditions before acting.",
        command: "node dist/tabby-borrower/bin/tabby-borrower.js market",
      },
      {
        title: "Quote before borrowing",
        detail: "Start with a quote so the borrow plan uses current LTV and liquidity.",
        command: "node dist/tabby-borrower/bin/tabby-borrower.js quote-borrow --collateral 0xASSET:1.25 --desired-borrow 500",
      },
    ],
  },
  operator: {
    label: "Operator",
    eyebrow: "Delegated Vault",
    desc: "Use this when a human owns the vault and the agent only acts after the owner binds the agent wallet onchain.",
    skillPath: "skills/tabby-borrower/SKILL.md",
    skillText: borrowerSkill,
    prompts: [
      "Prepare operator binding for vault #3.",
      "Check delegated vault #3 health.",
      "Repay 100 USDT0 on vault #3.",
    ],
    notes: [
      "The human wallet remains the owner.",
      "The owner must sign the operator-binding transaction first.",
      "Confirm binding before attempting any delegated vault action.",
    ],
    steps: [
      {
        title: "Initialize the operator wallet",
        detail: "This wallet is the agent identity the owner will bind to the vault.",
        command: "node dist/tabby-borrower/bin/tabby-borrower.js init-wallet",
      },
      {
        title: "Prepare the binding transaction",
        detail: "Generate the transaction the human owner must sign.",
        command: "node dist/tabby-borrower/bin/tabby-borrower.js prepare-bind-operator --vault-id 1",
      },
      {
        title: "Confirm access after the owner signs",
        detail: "Once the owner signs, confirm the binding before reading or managing the vault.",
        command: "node dist/tabby-borrower/bin/tabby-borrower.js confirm-bind-operator --vault-id 1",
      },
    ],
  },
  lp: {
    label: "LP",
    eyebrow: "Pool Liquidity",
    desc: "Use this when the agent is providing USDT0 liquidity to DebtPool and reacting to yield or utilization conditions.",
    skillPath: "skills/tabby-lp/SKILL.md",
    skillText: lpSkill,
    prompts: [
      "What is the current pool APY?",
      "Deposit 1000 USDT0 into the pool.",
      "Withdraw all my pool liquidity.",
    ],
    notes: [
      "LP mode uses the dedicated tabby-lp runtime.",
      "Start with pool status before deposit or withdrawal decisions.",
      "Monitor utilization and yield before automating size changes.",
    ],
    steps: [
      {
        title: "Initialize the LP wallet",
        detail: "Create the local wallet that will hold pool shares.",
        command: "node dist/tabby-lp/bin/tabby-lp.js init-wallet",
      },
      {
        title: "Check pool status",
        detail: "Read APY, utilization, and available liquidity first.",
        command: "node dist/tabby-lp/bin/tabby-lp.js pool-status",
      },
      {
        title: "Start with a small position update",
        detail: "Use a small deposit to verify the runtime and wallet setup end to end.",
        command: "node dist/tabby-lp/bin/tabby-lp.js deposit-liquidity --amount 100",
      },
    ],
  },
};

const ROLE_ORDER: { key: Tab; icon: React.ReactNode }[] = [
  { key: "borrower", icon: <Bot size={16} /> },
  { key: "operator", icon: <Shield size={16} /> },
  { key: "lp", icon: <Coins size={16} /> },
];

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

function CodeBlock({
  code,
  copied,
  onCopy,
}: {
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="overflow-hidden border border-[#232323] bg-[#0a0a0a]">
      <div className="flex items-center justify-between border-b border-[#232323] px-4 py-2">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[#55554d]">Command</div>
        <CopyButton copied={copied} label="Copy" onClick={onCopy} />
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[12px] leading-7 text-[#a9f3b3]">{code}</pre>
    </div>
  );
}

export const AgentSkillPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("borrower");
  const [showSkill, setShowSkill] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
      <div className="mx-auto max-w-6xl px-6 py-10">
        <button
          onClick={onBack}
          className="mb-8 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[#4d4d46] transition-colors hover:text-[#28c840]"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div className="border border-[#232323] bg-[#101010] p-5">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#55554d]">Agent Setup</div>
              <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.08em] text-[#ececdf]">
                Skills
              </h1>
              <p className="mt-3 text-[12px] leading-7 text-[#8a8a80]">
                A simple flow: install once, choose a role, run the first commands, then start prompting.
              </p>
            </div>

            <div className="border border-[#232323] bg-[#101010] p-3">
              <div className="mb-3 px-2 text-[10px] uppercase tracking-[0.24em] text-[#55554d]">Choose Role</div>
              <div className="space-y-2">
                {ROLE_ORDER.map(({ key, icon }) => {
                  const item = ROLES[key];
                  const active = key === tab;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setTab(key);
                        setShowSkill(false);
                        setCopiedKey(null);
                      }}
                      className={`w-full border px-3 py-3 text-left transition-colors ${
                        active
                          ? "border-[#28c840] bg-[#111b11]"
                          : "border-[#232323] bg-[#0c0c0c] hover:border-[#355a3b]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className={active ? "text-[#28c840]" : "text-[#66665f]"}>{icon}</div>
                          <div>
                            <div className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#e4e4d6]">
                              {item.label}
                            </div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[#66665f]">
                              {item.eyebrow}
                            </div>
                          </div>
                        </div>
                        <ChevronRight size={14} className={active ? "text-[#28c840]" : "text-[#444]"} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border border-[#232323] bg-[#101010] p-5">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#55554d]">Flow</div>
              <div className="mt-4 space-y-3 text-[12px] leading-6 text-[#8a8a80]">
                <div>1. Install and build the skills workspace once.</div>
                <div>2. Pick the role that matches how the agent should act.</div>
                <div>3. Run the first commands in order.</div>
                <div>4. Copy the skill file into your agent context and start prompting.</div>
              </div>
            </div>
          </aside>

          <main className="space-y-6">
            <section className="border border-[#232323] bg-[#101010] p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-[#55554d]">Step 1</div>
                  <h2 className="mt-2 text-[22px] font-black uppercase tracking-[0.06em] text-[#f0f0e4]">
                    Install Once
                  </h2>
                  <p className="mt-2 max-w-2xl text-[12px] leading-7 text-[#8a8a80]">
                    Clone the repo, move into the skills workspace, install dependencies, and build before using any borrower, operator, or LP runtime.
                  </p>
                </div>
                <CopyButton
                  copied={copiedKey === "install"}
                  label="Copy install"
                  onClick={() => handleCopy("install", INSTALL_COMMAND)}
                />
              </div>

              <div className="mt-5">
                <CodeBlock
                  code={INSTALL_COMMAND}
                  copied={copiedKey === "install-code"}
                  onCopy={() => handleCopy("install-code", INSTALL_COMMAND)}
                />
              </div>
            </section>

            <section className="border border-[#232323] bg-[#101010] p-6">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#55554d]">Step 2</div>
              <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-[22px] font-black uppercase tracking-[0.06em] text-[#f0f0e4]">
                    {role.label}
                  </h2>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-[#66665f]">{role.eyebrow}</div>
                  <p className="mt-3 max-w-3xl text-[12px] leading-7 text-[#8a8a80]">{role.desc}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="border border-[#232323] bg-[#0c0c0c] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[#717168]">
                    {role.skillPath}
                  </div>
                  <CopyButton
                    copied={copiedKey === "skill"}
                    label="Copy skill file"
                    onClick={() => handleCopy("skill", role.skillText)}
                  />
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {role.notes.map((note) => (
                  <div key={note} className="border border-[#1e2f21] bg-[#0d150f] p-4 text-[12px] leading-6 text-[#b6d8bc]">
                    {note}
                  </div>
                ))}
              </div>
            </section>

            <section className="border border-[#232323] bg-[#101010] p-6">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#55554d]">Step 3</div>
              <h2 className="mt-2 text-[22px] font-black uppercase tracking-[0.06em] text-[#f0f0e4]">
                Run These First
              </h2>
              <div className="mt-5 space-y-4">
                {role.steps.map((step, index) => (
                  <div key={step.title} className="border border-[#232323] bg-[#0c0c0c] p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#24512c] bg-[#102112] text-[11px] font-bold text-[#9bf0aa]">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#ececdf]">
                              {step.title}
                            </div>
                            <p className="mt-2 text-[12px] leading-7 text-[#86867d]">{step.detail}</p>
                          </div>
                          {step.command ? (
                            <CopyButton
                              copied={copiedKey === `step-${tab}-${index}`}
                              label="Copy command"
                              onClick={() => handleCopy(`step-${tab}-${index}`, `cd tabby-cli/skills\n${step.command}`)}
                            />
                          ) : null}
                        </div>

                        {step.command ? (
                          <div className="mt-4 overflow-hidden border border-[#232323] bg-[#090909]">
                            <div className="flex items-center gap-2 border-b border-[#232323] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-[#55554d]">
                              <Terminal size={12} />
                              First command
                            </div>
                            <pre className="overflow-x-auto px-4 py-4 text-[12px] leading-7 text-[#a9f3b3]">{`cd tabby-cli/skills
${step.command}`}</pre>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="border border-[#232323] bg-[#101010] p-6">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#55554d]">Step 4</div>
              <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-[22px] font-black uppercase tracking-[0.06em] text-[#f0f0e4]">
                    Start Prompting
                  </h2>
                  <p className="mt-2 text-[12px] leading-7 text-[#8a8a80]">
                    Use these as starting prompts once the skill has been loaded into your agent runtime.
                  </p>
                </div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-[#5d5d55]">
                  Click any prompt to copy it
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                {role.prompts.map((prompt, index) => (
                  <button
                    key={prompt}
                    onClick={() => handleCopy(`prompt-${tab}-${index}`, prompt)}
                    className="flex items-start justify-between gap-4 border border-[#232323] bg-[#0c0c0c] px-4 py-4 text-left transition-colors hover:border-[#355a3b] hover:bg-[#101410]"
                  >
                    <div className="text-[12px] leading-7 text-[#d1d1c3]">{prompt}</div>
                    <div className="mt-1 shrink-0 text-[#66665f]">
                      {copiedKey === `prompt-${tab}-${index}` ? <Check size={14} className="text-[#28c840]" /> : <Clipboard size={14} />}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="border border-[#232323] bg-[#101010] p-6">
              <button
                onClick={() => setShowSkill((value) => !value)}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-[#55554d]">Reference</div>
                  <div className="mt-2 text-[18px] font-black uppercase tracking-[0.06em] text-[#f0f0e4]">
                    Raw Skill File
                  </div>
                </div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-[#7b7b71]">
                  {showSkill ? "Hide" : "Show"}
                </div>
              </button>

              <AnimatePresence initial={false}>
                {showSkill ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-5 overflow-hidden border border-[#232323] bg-[#090909]">
                      <div className="flex items-center justify-between border-b border-[#232323] px-4 py-2">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[#55554d]">{role.skillPath}</div>
                        <CopyButton
                          copied={copiedKey === "raw-skill"}
                          label="Copy raw skill"
                          onClick={() => handleCopy("raw-skill", role.skillText)}
                        />
                      </div>
                      <pre className="max-h-[440px] overflow-auto px-4 py-4 text-[11px] leading-6 text-[#909086]">
                        {role.skillText}
                      </pre>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </section>
          </main>
        </div>
      </div>
    </motion.div>
  );
};
