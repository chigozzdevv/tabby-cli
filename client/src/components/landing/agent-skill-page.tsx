import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  Coins,
  Copy,
  Radar,
  Shield,
  Sparkles,
  Terminal,
  Wallet,
} from "lucide-react";

import borrowerSkill from "../../../../skills/tabby-borrower/SKILL.md?raw";
import lpSkill from "../../../../skills/tabby-lp/SKILL.md?raw";

type Tab = "borrower" | "operator" | "lp";

type QuickstartStep = {
  title: string;
  detail: string;
  code?: string;
};

type ResponseFlag = {
  name: string;
  description: string;
};

type RoleContent = {
  label: string;
  eyebrow: string;
  title: string;
  summary: string;
  skillPath: string;
  skillText: string;
  capabilities: string[];
  quickstart: QuickstartStep[];
  commands: string[];
  prompts: string[];
  safety: string[];
  troubleshooting: string[];
  responseFlags: ResponseFlag[];
  monitoringCode: string;
  footnote: string;
};

const BUILD_STEP = `cd skills
npm install
npm run build`;

const ENV_STEP = `TABBY_API_BASE_URL=http://localhost:3000
CHAIN_ID=9745
RPC_URL=https://rpc.plasma.to
VAULT_MANAGER_ADDRESS=0x...
DEBT_POOL_ADDRESS=0x...
MARKET_CONFIG_ADDRESS=0x...
DEBT_ASSET_ADDRESS=0x...
COLLATERAL_ASSETS=0x...,0x...,0x...,0x...`;

const BORROWER_MONITORING = `{
  cron: {
    jobs: [
      {
        id: "tabby-vault-monitor",
        schedule: "*/5 * * * *",
        command: "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js monitor-vaults --quiet-ok",
        enabled: true
      }
    ]
  }
}`;

const LP_MONITORING = `{
  cron: {
    jobs: [
      {
        id: "tabby-lp-monitor",
        schedule: "0 * * * *",
        command: "cd /home/tabby/tabby-cli/skills && node dist/tabby-lp/bin/tabby-lp.js monitor-pool",
        enabled: true
      }
    ]
  }
}`;

const ROLE_CONTENT: Record<Tab, RoleContent> = {
  borrower: {
    label: "Borrower",
    eyebrow: "Agent-Owned Vault",
    title: "Borrow, manage collateral, and monitor risk from one skill wallet.",
    summary:
      "Use the borrower skill when the agent owns the vault and is making its own borrow, repay, and collateral decisions on Plasma.",
    skillPath: "skills/tabby-borrower/SKILL.md",
    skillText: borrowerSkill,
    capabilities: [
      "Open an agent-owned vault and deposit supported collateral.",
      "Quote borrow capacity before taking any state-changing action.",
      "Borrow USDT0, repay debt, withdraw collateral, and monitor health on a schedule.",
    ],
    quickstart: [
      {
        title: "Install and build the skills",
        detail: "Build once before running any borrower or LP command.",
        code: BUILD_STEP,
      },
      {
        title: "Configure the environment",
        detail: "Set the API base URL, RPC, chain, and protocol addresses in skills/.env.",
        code: ENV_STEP,
      },
      {
        title: "Initialize a borrower wallet",
        detail: "This creates the local wallet and state files used by the skill.",
        code: "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js init-wallet",
      },
      {
        title: "Read market state first",
        detail: "Verify the runtime is working before attempting a vault action.",
        code: "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js market",
      },
      {
        title: "Quote before you borrow",
        detail: "Start with a quote so the agent acts on current risk parameters rather than assumptions.",
        code: "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js quote-borrow --collateral 0xASSET:1.25 --desired-borrow 500",
      },
    ],
    commands: [
      "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js open-vault",
      "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js vault-status --vault-id 1",
      "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js monitor-vaults --quiet-ok",
    ],
    prompts: [
      "How much can I borrow with 2 WETH?",
      "Open a vault and quote 500 USDT0 against 1 WETH.",
      "Check vault #3 and tell me the health factor.",
      "Repay all debt on vault #3.",
    ],
    safety: [
      "Do not borrow at the quoted maximum. Keep a health buffer.",
      "Monitor vaults on a schedule and react before health gets tight.",
      "Verify the asset, amount, and vault id before every state-changing command.",
    ],
    troubleshooting: [
      "Run init-wallet first if the skill has no local wallet state.",
      "Check RPC_URL, CHAIN_ID, and protocol addresses if market reads fail.",
      "Ensure collateral approvals, balances, and gas are available before deposit or borrow.",
    ],
    responseFlags: [
      { name: "isQuote", description: "Borrow capacity, LTV, or collateral-to-debt questions." },
      { name: "isPosition", description: "Vault health, debt, collateral, and position state." },
      { name: "isAction", description: "Borrow, repay, deposit, withdraw, or open-vault confirmations." },
    ],
    monitoringCode: BORROWER_MONITORING,
    footnote: "Borrower mode is for agent-owned vaults. The agent wallet both opens and manages the vault.",
  },
  operator: {
    label: "Operator",
    eyebrow: "Delegated Vault Operations",
    title: "Manage a human-owned vault only after explicit onchain binding.",
    summary:
      "Operator mode uses the borrower skill, but the trust model is different: the human remains the owner and signs the operator-binding transaction before the agent can act.",
    skillPath: "skills/tabby-borrower/SKILL.md",
    skillText: borrowerSkill,
    capabilities: [
      "Prepare and confirm operator binding for a human-owned vault.",
      "Read position state and monitor delegated vault health without taking ownership.",
      "Execute allowed vault actions only after the owner has granted operator permission.",
    ],
    quickstart: [
      {
        title: "Install and build the skills",
        detail: "Operator flows use the same borrower runtime and environment.",
        code: BUILD_STEP,
      },
      {
        title: "Initialize the operator wallet",
        detail: "This wallet is the agent identity that the human owner will bind onchain.",
        code: "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js init-wallet",
      },
      {
        title: "Prepare the binding transaction",
        detail: "Generate the operator-binding payload for the human-owned vault.",
        code: "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js prepare-bind-operator --vault-id 1",
      },
      {
        title: "Have the owner sign the binding",
        detail: "The human wallet remains the owner and must sign before any delegated action is valid.",
      },
      {
        title: "Confirm the binding and inspect the vault",
        detail: "Confirm access first, then read vault state before repay, withdraw, or collateral actions.",
        code: "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js confirm-bind-operator --vault-id 1",
      },
    ],
    commands: [
      "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js prepare-bind-operator --vault-id 1",
      "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js confirm-bind-operator --vault-id 1",
      "cd /home/tabby/tabby-cli/skills && node dist/tabby-borrower/bin/tabby-borrower.js vault-status --vault-id 1",
    ],
    prompts: [
      "Prepare operator binding for vault #3.",
      "Has vault #3 been bound to my agent wallet yet?",
      "Check delegated vault #3 health.",
      "Repay 100 USDT0 on vault #3.",
    ],
    safety: [
      "The human wallet remains the owner. Binding grants operation, not ownership transfer.",
      "Do not attempt delegated actions before confirm-bind-operator succeeds.",
      "Owner permissions can be revoked, so verify access before acting on each vault.",
    ],
    troubleshooting: [
      "If confirm-bind-operator fails, verify the human signed the binding transaction.",
      "Check that the correct agent wallet was initialized before preparing the binding.",
      "If actions revert later, confirm the operator permission still exists onchain.",
    ],
    responseFlags: [
      { name: "isQuote", description: "Capacity and borrow-read questions on the delegated vault." },
      { name: "isPosition", description: "Delegated vault health, debt, and collateral state." },
      { name: "isAction", description: "Operator binding, repay, deposit, and other action confirmations." },
    ],
    monitoringCode: BORROWER_MONITORING,
    footnote: "Operator mode reuses the borrower skill. The difference is trust and permission, not the runtime.",
  },
  lp: {
    label: "LP",
    eyebrow: "Pool Automation",
    title: "Provide USDT0 liquidity and react to pool conditions.",
    summary:
      "Use the LP skill to read APY, utilization, and position value, then deposit or withdraw USDT0 from the DebtPool as strategy conditions change.",
    skillPath: "skills/tabby-lp/SKILL.md",
    skillText: lpSkill,
    capabilities: [
      "Inspect pool APY, utilization, and position value from the LP runtime.",
      "Deposit or withdraw USDT0 from the shared debt pool.",
      "Run pool monitoring jobs to automate yield and utilization thresholds.",
    ],
    quickstart: [
      {
        title: "Install and build the skills",
        detail: "The LP runtime ships from the same skills workspace.",
        code: BUILD_STEP,
      },
      {
        title: "Configure the environment",
        detail: "LP setup still needs API base URL, RPC, chain, debt asset, and pool addresses.",
        code: ENV_STEP,
      },
      {
        title: "Initialize an LP wallet",
        detail: "Create the local LP wallet state before checking pool status.",
        code: "cd /home/tabby/tabby-cli/skills && node dist/tabby-lp/bin/tabby-lp.js init-wallet",
      },
      {
        title: "Read pool conditions first",
        detail: "Inspect APY and utilization before any deposit or withdrawal decision.",
        code: "cd /home/tabby/tabby-cli/skills && node dist/tabby-lp/bin/tabby-lp.js pool-status",
      },
      {
        title: "Start with a small position update",
        detail: "Confirm the end-to-end runtime works with a simple deposit or position read.",
        code: "cd /home/tabby/tabby-cli/skills && node dist/tabby-lp/bin/tabby-lp.js deposit-liquidity --amount 100",
      },
    ],
    commands: [
      "cd /home/tabby/tabby-cli/skills && node dist/tabby-lp/bin/tabby-lp.js position",
      "cd /home/tabby/tabby-cli/skills && node dist/tabby-lp/bin/tabby-lp.js deposit-liquidity --amount 100",
      "cd /home/tabby/tabby-cli/skills && node dist/tabby-lp/bin/tabby-lp.js monitor-pool",
    ],
    prompts: [
      "What is the current pool APY?",
      "How much is my LP position worth?",
      "Deposit 1000 USDT0 into the pool.",
      "Withdraw all my pool liquidity.",
    ],
    safety: [
      "Do not chase temporary APY spikes without checking utilization and liquidity conditions.",
      "Verify balances before depositing and available liquidity before withdrawing.",
      "Use monitor-pool rules so the agent reacts to thresholds instead of ad hoc guesses.",
    ],
    troubleshooting: [
      "If deposits fail, confirm the wallet holds enough USDT0 and gas.",
      "If pool data looks wrong, verify API, RPC, and contract addresses in skills/.env.",
      "If position reads are empty, confirm the wallet actually holds LP shares.",
    ],
    responseFlags: [
      { name: "isPool", description: "Pool APY, utilization, borrow rate, and health questions." },
      { name: "isPosition", description: "LP shares, assets, and account position details." },
      { name: "isAction", description: "Deposit and withdrawal confirmations." },
    ],
    monitoringCode: LP_MONITORING,
    footnote: "LP mode is for USDT0 supply automation into DebtPool rather than borrower vault management.",
  },
};

const PROTOCOL_FACTS = [
  { label: "Network", value: "Plasma mainnet" },
  { label: "RPC", value: "https://rpc.plasma.to" },
  { label: "Debt asset", value: "USDT0" },
  { label: "Collateral", value: "WETH, XAUt0, wstETH, WXPL" },
  { label: "Core contracts", value: "VaultManager, DebtPool, MarketConfig, ChainlinkPriceOracle" },
];

const HERO_PILLS = [
  "Agent-owned vaults",
  "Delegated operators",
  "LP automation",
];

const ROLE_CARD_META: Record<Tab, { icon: React.ComponentType<{ className?: string }>; blurb: string }> = {
  borrower: {
    icon: Wallet,
    blurb: "Own and manage a vault directly from the skill wallet.",
  },
  operator: {
    icon: Shield,
    blurb: "Operate a human-owned vault after the owner binds the agent onchain.",
  },
  lp: {
    icon: Coins,
    blurb: "Supply USDT0 into DebtPool and automate pool strategies.",
  },
};

const SectionCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <section className="border border-[#232323] bg-[#101010]/90 p-5 sm:p-6">
    <div className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-[#6d6d63]">
      {icon}
      <span>{title}</span>
    </div>
    {children}
  </section>
);

const CodePanel: React.FC<{
  code: string;
  label?: string;
}> = ({ code, label }) => (
  <div className="overflow-hidden border border-[#1f2e22] bg-[#07100a]">
    {label ? (
      <div className="border-b border-[#1f2e22] px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-[#52745a]">
        {label}
      </div>
    ) : null}
    <pre className="overflow-x-auto px-4 py-4 text-[11px] leading-6 text-[#9bf0aa]">{code}</pre>
  </div>
);

export const AgentSkillPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("borrower");
  const [copiedTab, setCopiedTab] = useState<Tab | null>(null);

  const activeRole = ROLE_CONTENT[tab];
  const copied = copiedTab === tab;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeRole.skillText);
    setCopiedTab(tab);
    window.setTimeout(() => {
      setCopiedTab((current) => (current === tab ? null : current));
    }, 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      className="h-screen overflow-y-auto bg-[#0c0c0c] text-[#c8c8b8] font-mono"
    >
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[#5d5d54] transition-colors hover:text-[#28c840]"
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-[#5d5d54]">
            <Terminal size={14} />
            Tabby Agent Runtime
          </div>
        </div>

        <section className="border border-[#232323] bg-[linear-gradient(135deg,#111_0%,#0a0a0a_58%,#08120a_100%)] p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[#6a6a60]">
                <Bot size={14} className="text-[#28c840]" />
                Agent Onboarding
              </div>

              <h1 className="max-w-3xl text-3xl font-black uppercase leading-tight tracking-[0.08em] text-[#f1f1df] sm:text-4xl">
                Run Tabby As An Agent
              </h1>

              <p className="mt-4 max-w-3xl text-[13px] leading-7 text-[#9a9a8d] sm:text-[14px]">
                Borrow <span className="text-[#d8d8c8]">USDT0</span>, operate delegated vaults,
                and provide liquidity on Plasma through agent-ready skills and explicit
                onchain permissions.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {HERO_PILLS.map((pill) => (
                  <span
                    key={pill}
                    className="border border-[#214126] bg-[#0b150d] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[#79d688]"
                  >
                    {pill}
                  </span>
                ))}
              </div>
            </div>

            <div className="border border-[#1f2e22] bg-[#08100a] p-4 sm:p-5">
              <div className="mb-2 text-[10px] uppercase tracking-[0.24em] text-[#5f8d67]">
                Current skill file
              </div>
              <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#e0e0d0]">
                {activeRole.skillPath}
              </div>
              <p className="mt-3 text-[12px] leading-6 text-[#7ea787]">{activeRole.footnote}</p>
              <button
                onClick={handleCopy}
                className="mt-4 inline-flex items-center gap-2 border border-[#24512c] bg-[#122217] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#9bf0aa] transition-colors hover:border-[#28c840] hover:text-[#d7f6dc]"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied Skill" : `Copy ${activeRole.label} Skill`}
              </button>
            </div>
          </div>
        </section>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {(["borrower", "operator", "lp"] as Tab[]).map((roleKey) => {
            const role = ROLE_CONTENT[roleKey];
            const cardMeta = ROLE_CARD_META[roleKey];
            const Icon = cardMeta.icon;
            const active = roleKey === tab;

            return (
              <button
                key={roleKey}
                onClick={() => setTab(roleKey)}
                className={`border p-5 text-left transition-all ${
                  active
                    ? "border-[#28c840] bg-[#101810] shadow-[0_0_30px_rgba(40,200,64,0.08)]"
                    : "border-[#232323] bg-[#101010] hover:border-[#355a3b]"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Icon className={active ? "text-[#28c840]" : "text-[#616158]"} />
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[#6a6a60]">
                        {role.eyebrow}
                      </div>
                      <div className="mt-1 text-[15px] font-bold uppercase tracking-[0.08em] text-[#ececde]">
                        {role.label}
                      </div>
                    </div>
                  </div>
                  {active ? (
                    <span className="border border-[#24512c] bg-[#102112] px-2 py-1 text-[9px] uppercase tracking-[0.18em] text-[#9bf0aa]">
                      Active
                    </span>
                  ) : null}
                </div>
                <p className="mt-4 text-[12px] leading-6 text-[#8b8b80]">{cardMeta.blurb}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <SectionCard title="What This Role Does" icon={<Sparkles size={14} className="text-[#28c840]" />}>
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#6a6a60]">
                {activeRole.eyebrow}
              </div>
              <h2 className="mt-2 text-xl font-black uppercase tracking-[0.06em] text-[#f0f0e2]">
                {activeRole.title}
              </h2>
              <p className="mt-3 text-[13px] leading-7 text-[#929287]">{activeRole.summary}</p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {activeRole.capabilities.map((capability) => (
                  <div key={capability} className="border border-[#1f2e22] bg-[#0d150f] p-4 text-[12px] leading-6 text-[#b7d6bc]">
                    {capability}
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Quickstart" icon={<Terminal size={14} className="text-[#28c840]" />}>
              <div className="space-y-4">
                {activeRole.quickstart.map((step, index) => (
                  <div key={step.title} className="border border-[#232323] bg-[#0c0c0c] p-4">
                    <div className="flex items-start gap-4">
                      <div className="mt-0.5 flex h-7 w-7 items-center justify-center border border-[#24512c] bg-[#102112] text-[11px] font-bold text-[#9bf0aa]">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#ececde]">
                          {step.title}
                        </div>
                        <p className="mt-2 text-[12px] leading-6 text-[#8b8b80]">{step.detail}</p>
                      </div>
                    </div>
                    {step.code ? <div className="mt-4"><CodePanel code={step.code} /></div> : null}
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="First Commands" icon={<Wallet size={14} className="text-[#28c840]" />}>
              <div className="grid gap-3">
                {activeRole.commands.map((command, index) => (
                  <CodePanel key={command} code={command} label={`Command ${index + 1}`} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Skill File" icon={<Copy size={14} className="text-[#28c840]" />}>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-[#6a6a60]">
                    Source of truth
                  </div>
                  <div className="mt-1 text-[13px] font-bold uppercase tracking-[0.08em] text-[#ececde]">
                    {activeRole.skillPath}
                  </div>
                </div>

                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-2 border border-[#2c2c2c] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[#a8a89a] transition-colors hover:border-[#28c840] hover:text-[#28c840]"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy Raw Skill"}
                </button>
              </div>

              <div className="overflow-hidden border border-[#232323] bg-[#090909]">
                <div className="border-b border-[#232323] px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-[#5f5f56]">
                  Raw skill content
                </div>
                <pre className="max-h-[540px] overflow-auto px-4 py-4 text-[11px] leading-6 text-[#b9b9ac]">
                  {activeRole.skillText}
                </pre>
              </div>
            </SectionCard>
          </div>

          <div className="space-y-4">
            <SectionCard title="Protocol Facts" icon={<Bot size={14} className="text-[#28c840]" />}>
              <div className="space-y-3">
                {PROTOCOL_FACTS.map((fact) => (
                  <div
                    key={fact.label}
                    className="flex items-start justify-between gap-4 border border-[#232323] bg-[#0c0c0c] px-4 py-3"
                  >
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#66665e]">{fact.label}</div>
                    <div className="text-right text-[12px] leading-6 text-[#d6d6c7]">{fact.value}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Response Contract" icon={<Radar size={14} className="text-[#28c840]" />}>
              <p className="text-[12px] leading-6 text-[#8d8d82]">
                The UI expects structured flags back from the runtime. These are the primary modes
                for the active role.
              </p>
              <div className="mt-4 space-y-3">
                {activeRole.responseFlags.map((flag) => (
                  <div key={flag.name} className="border border-[#1f2e22] bg-[#0d150f] p-4">
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#9bf0aa]">
                      {flag.name}
                    </div>
                    <p className="mt-2 text-[12px] leading-6 text-[#b6d6bc]">{flag.description}</p>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Safety And Risk" icon={<Shield size={14} className="text-[#28c840]" />}>
              <p className="text-[12px] leading-6 text-[#8d8d82]">
                Tabby actions carry financial risk. Build buffers, check permissions, and monitor on
                a schedule before letting an agent act automatically.
              </p>
              <ul className="mt-4 space-y-3 text-[12px] leading-6 text-[#d6c89a]">
                {activeRole.safety.map((item) => (
                  <li key={item} className="border border-[#352d1d] bg-[#151109] px-4 py-3">
                    {item}
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard title="Monitoring Recipe" icon={<Terminal size={14} className="text-[#28c840]" />}>
              <CodePanel code={activeRole.monitoringCode} label="OpenClaw cron" />
            </SectionCard>

            <SectionCard title="Troubleshooting" icon={<AlertTriangle size={14} className="text-[#28c840]" />}>
              <ul className="space-y-3 text-[12px] leading-6 text-[#8d8d82]">
                {activeRole.troubleshooting.map((item) => (
                  <li key={item} className="border border-[#232323] bg-[#0c0c0c] px-4 py-3">
                    {item}
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard title="Example Prompts" icon={<Sparkles size={14} className="text-[#28c840]" />}>
              <div className="flex flex-wrap gap-2">
                {activeRole.prompts.map((prompt) => (
                  <div
                    key={prompt}
                    className="border border-[#24512c] bg-[#102112] px-3 py-2 text-[11px] leading-6 text-[#bdecc5]"
                  >
                    {prompt}
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
