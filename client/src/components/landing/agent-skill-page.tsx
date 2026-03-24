import React from "react";
import { ArrowLeft } from "lucide-react";

import tabbyDoc from "./SKILL.md?raw";

export const AgentSkillPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(tabbyDoc);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy agent markdown", error);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#0c0c0c] px-6 py-8 font-mono">
      <div className="mx-auto max-w-4xl pb-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#8a8a80] hover:text-[#28c840] transition-colors"
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <button
            onClick={handleCopy}
            className="border border-[#2a2a2a] bg-[#141414] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[#8a8a80] hover:border-[#28c840] hover:text-[#28c840] transition-colors"
          >
            {copied ? "Copied" : "Copy Skill"}
          </button>
        </div>

        <pre className="overflow-x-auto whitespace-pre-wrap text-[14px] leading-8 text-[#b8d4b0]">
          {tabbyDoc}
        </pre>
      </div>
    </div>
  );
};
