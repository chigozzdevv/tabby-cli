import React from "react";
import { ArrowLeft } from "lucide-react";

import tabbyDoc from "./tabby.md?raw";

export const AgentSkillPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#0c0c0c] px-6 py-8 text-[#c8c8b8] font-mono">
      <div className="mx-auto max-w-4xl pb-8">
        <button
          onClick={onBack}
          className="mb-6 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#8a8a80] hover:text-[#c8c8b8]"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <pre className="overflow-x-auto whitespace-pre-wrap border border-[#232323] bg-[#101010] p-5 text-[12px] leading-7 text-[#d2d2c3]">
          {tabbyDoc}
        </pre>
      </div>
    </div>
  );
};
