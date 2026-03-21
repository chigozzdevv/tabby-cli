import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Terminal, Hash, Pin, X } from "lucide-react";
import type { ContextItem } from "../sidebar/context-card";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

const SUGGESTIONS = [
  "HOW DOES IT WORK?",
  "HOW TO EARN USDC REWARD?",
  "WHAT IS MY CURRENT BALANCE?",
];

export const ChatWindow: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [context, setContext] = useState<ContextItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (text?: string) => {
    const msg = text || input;
    if (!msg.trim() && context.length === 0) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: msg,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Processing request for [${context.map((c) => c.title).join(", ") || "GENERAL"}]...`,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }, 1000);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const data = e.dataTransfer.getData("application/tabby-context");
    if (data) {
      const item = JSON.parse(data) as ContextItem;
      if (!context.find((c) => c.id === item.id)) {
        setContext((prev) => [...prev, item]);
      }
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="panel flex h-full flex-col relative">
      <AnimatePresence>
        {context.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-tactical-border bg-tactical-active p-2 flex gap-2 overflow-x-auto"
          >
            {context.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-1 border border-tactical-border px-2 py-1 text-[10px] font-bold uppercase shrink-0"
              >
                <Pin size={10} className="text-tactical-accent" />
                {c.title}
                <X
                  size={10}
                  className="ml-1 cursor-pointer hover:text-tactical-error transition-colors"
                  onClick={() => setContext((prev) => prev.filter((item) => item.id !== c.id))}
                />
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 relative"
        onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={onDrop}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-[13px] uppercase tracking-wider text-tactical-dim mb-8">
              AI {">>"}  Ask Tabby all your queries
            </p>
            <div className="flex flex-col gap-3 w-full max-w-md">
              {SUGGESTIONS.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(suggestion)}
                  className="suggestion-btn text-left flex items-center gap-3"
                >
                  <span className="text-tactical-dim">{i + 1}-/</span>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex items-start gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <div className={`p-3 border max-w-[80%] ${msg.role === "assistant" ? "border-tactical-accent/30 bg-tactical-accent/5" : "border-tactical-border bg-tactical-active"}`}>
                    <div className="flex items-center gap-2 mb-1 text-[9px] text-tactical-dim uppercase font-black">
                      {msg.role === "assistant" ? <Terminal size={10} /> : <Hash size={10} />}
                      {msg.role}
                    </div>
                    <div className="whitespace-pre-wrap text-[13px]">{msg.content}</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {isDraggingOver && (
          <div className="absolute inset-0 bg-tactical-accent/5 border-2 border-dashed border-tactical-accent/40 flex items-center justify-center pointer-events-none z-10">
            <div className="text-tactical-accent font-black text-lg uppercase tracking-wider">
              Drop Context Here
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-tactical-border">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type your message here..."
            className="flex-1 bg-transparent border-none p-2 text-sm font-mono focus:outline-none placeholder:text-tactical-dim/50 placeholder:uppercase"
          />
          <button
            onClick={() => handleSend()}
            className="h-8 w-8 flex items-center justify-center border border-tactical-border rounded-full hover:border-tactical-accent hover:text-tactical-accent transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
