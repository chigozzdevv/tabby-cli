import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Terminal, Hash, Pin, X } from "lucide-react";
import type { ContextItem } from "../sidebar/context-card";
import { QuoteCard } from "./quote-card";
import { PositionCard } from "./position-card";
import { getQuote, listPositions } from "../../lib/api-client";
import type { QuoteData, VaultPosition } from "../../lib/api-client";

type CardPayload =
  | { type: "quote"; data: QuoteData }
  | { type: "position"; data: VaultPosition };

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  context?: ContextItem[];
  card?: CardPayload;
}

const SUGGESTIONS = [
  "What loan can my 200 BTC get me?",
  "Show my positions",
  "How does Tabby work?",
];

function parseIntent(text: string): "quote" | "position" | "general" {
  const lower = text.toLowerCase();
  if (/\b(borrow|loan|lend|collateral|ltv|what.*get|how much can i)\b/.test(lower)) return "quote";
  if (/\b(position|vault|health|my vault|show.*position|status)\b/.test(lower)) return "position";
  return "general";
}

export const ChatWindow: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingContext, setPendingContext] = useState<ContextItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (text?: string) => {
    const msg = text || input;
    if (!msg.trim() && pendingContext.length === 0) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: msg,
      context: pendingContext.length > 0 ? [...pendingContext] : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    const sentContext = [...pendingContext];
    setPendingContext([]);
    setIsThinking(true);

    const intent = parseIntent(msg);

    try {
      if (intent === "quote") {
        const collateralAsset = sentContext.length > 0
          ? sentContext[0].id
          : "0x9895D81bB462A195b4922ED7De0e3ACD007c32CB";

        const quote = await getQuote([{
          asset: collateralAsset,
          amountWei: "20000000000",
        }]);

        if (quote) {
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: "Here's your borrow quote based on the collateral provided:",
            card: { type: "quote", data: quote },
          };
          setMessages((prev) => [...prev, assistantMessage]);
        } else {
          setMessages((prev) => [...prev, {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: "Unable to generate quote — backend is offline. Please ensure the server is running.",
          }]);
        }
      } else if (intent === "position") {
        const ownerAddress = "0x5ee2796f3014b524A2C51521B48F830B8467E341";
        const positions = await listPositions(ownerAddress);
        if (positions.length > 0) {
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: `Found ${positions.length} active position${positions.length > 1 ? "s" : ""}:`,
            card: { type: "position", data: positions[0] },
          };
          setMessages((prev) => [...prev, assistantMessage]);
        } else {
          setMessages((prev) => [...prev, {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: "No active positions found. Open a vault to get started.",
          }]);
        }
      } else {
        setMessages((prev) => [...prev, {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Processing request for [${sentContext.map((c) => c.title).join(", ") || "GENERAL"}]... Tabby is a lending protocol on Plasma. You can borrow against collateral or provide liquidity to earn yield. Ask me about borrowing or check your positions.`,
        }]);
      }
    } catch {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Unable to reach the protocol backend. Please check your connection and ensure the server is running.",
      }]);
    } finally {
      setIsThinking(false);
    }
  };

  const onInputDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const data = e.dataTransfer.getData("application/tabby-context");
    if (data) {
      const item = JSON.parse(data) as ContextItem;
      if (!pendingContext.find((c) => c.id === item.id)) {
        setPendingContext((prev) => [...prev, item]);
      }
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div
      className="panel flex h-full flex-col relative"
      onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOver(false); }}
      onDrop={onInputDrop}
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
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
                    {msg.context && msg.context.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2 pb-2 border-b border-tactical-border/50">
                        {msg.context.map((c) => (
                          <span
                            key={c.id}
                            className="inline-flex items-center gap-1 border border-tactical-accent/30 bg-tactical-accent/5 px-1.5 py-0.5 text-[9px] font-bold uppercase text-tactical-accent"
                          >
                            <Pin size={8} />
                            {c.title}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap text-[13px]">{msg.content}</div>
                    {msg.card?.type === "quote" && <QuoteCard quote={msg.card.data} />}
                    {msg.card?.type === "position" && <PositionCard vault={msg.card.data} />}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isThinking && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3">
                <div className="p-3 border border-tactical-accent/30 bg-tactical-accent/5">
                  <div className="flex items-center gap-2 text-[9px] text-tactical-dim uppercase font-black">
                    <Terminal size={10} />
                    assistant
                  </div>
                  <div className="flex gap-1 mt-2">
                    <span className="w-1.5 h-1.5 bg-tactical-accent rounded-full animate-pulse" />
                    <span className="w-1.5 h-1.5 bg-tactical-accent rounded-full animate-pulse [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-tactical-accent rounded-full animate-pulse [animation-delay:300ms]" />
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        )}
      </div>

      <div className={`border-t p-4 transition-colors relative ${isDraggingOver ? "border-tactical-accent bg-tactical-accent/5" : "border-tactical-border"}`}>
        <AnimatePresence>
          {pendingContext.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex gap-1.5 flex-wrap mb-2"
            >
              {pendingContext.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-1 border border-tactical-accent/30 bg-tactical-accent/5 px-2 py-0.5 text-[9px] font-bold uppercase text-tactical-accent shrink-0"
                >
                  <Pin size={8} />
                  {c.title}
                  <X
                    size={8}
                    className="ml-0.5 cursor-pointer hover:text-tactical-error transition-colors"
                    onClick={() => setPendingContext((prev) => prev.filter((item) => item.id !== c.id))}
                  />
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={isDraggingOver ? "Drop context here..." : "Type your message here..."}
            className="flex-1 bg-transparent border-none p-2 text-sm font-mono focus:outline-none placeholder:text-tactical-dim/50 placeholder:uppercase"
          />
          <button
            onClick={() => handleSend()}
            disabled={isThinking}
            className="h-8 w-8 flex items-center justify-center border border-tactical-border rounded-full hover:border-tactical-accent hover:text-tactical-accent transition-colors disabled:opacity-30"
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      {isDraggingOver && (
        <div className="absolute inset-0 bg-tactical-accent/5 border-2 border-dashed border-tactical-accent/40 pointer-events-none flex items-center justify-center z-10">
          <span className="text-tactical-accent text-[11px] font-bold uppercase tracking-wider">Drop Context</span>
        </div>
      )}
    </div>
  );
};
