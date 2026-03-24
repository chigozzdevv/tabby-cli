import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Terminal, Hash, Pin, X, Wifi, WifiOff, CheckCircle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import type { ContextItem } from "../sidebar/context-card";
import { QuoteCard } from "./quote-card";
import { PositionCard } from "./position-card";
import { LpPoolCard } from "./lp-pool-card";
import { LpPositionCard } from "./lp-position-card";
import { openClawClient, extractStreamingText, parseResponse } from "../../lib/openclaw-client";
import type { TabbyCard } from "../../lib/openclaw-client";
import type { QuoteData, VaultPosition, LpPosition } from "../../lib/api-client";
import { bootstrapBorrowForOwner, buildBorrowExecutionPrompt } from "../../lib/borrow-flow";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  context?: ContextItem[];
  card?: TabbyCard;
  streaming?: boolean;
}

const SUGGESTIONS = [
  "What loan can my 2 WETH get me?",
  "Show my vault positions",
  "What is the current pool APY?",
];

const ActionCard: React.FC<{
  action: { type: string; success: boolean; detail: string; txHash?: string; explorerUrl?: string };
}> = ({ action }) => (
  <div className="border border-tactical-accent/30 bg-tactical-accent/5 mt-2 px-3 py-2 flex items-center gap-2 text-[11px]">
    <CheckCircle size={12} className="text-tactical-accent shrink-0" />
    <span className="font-bold uppercase text-tactical-accent">{action.type}</span>
    <span className="text-tactical-dim">—</span>
    <span>{action.detail}</span>
    {action.explorerUrl && (
      <a
        href={action.explorerUrl}
        target="_blank"
        rel="noreferrer"
        className="ml-auto inline-flex items-center gap-1 text-tactical-accent hover:underline"
      >
        <span className="font-mono text-[10px]">
          {action.txHash ? `${action.txHash.slice(0, 6)}...${action.txHash.slice(-4)}` : "View tx"}
        </span>
        <ExternalLink size={10} />
      </a>
    )}
  </div>
);

const COLLAPSE_THRESHOLD = 400;
const AUTO_SCROLL_THRESHOLD = 96;

const MessageContent: React.FC<{ content: string; streaming?: boolean }> = ({ content, streaming }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > COLLAPSE_THRESHOLD;
  const displayed = isLong && !expanded ? content.slice(0, COLLAPSE_THRESHOLD) + "…" : content;

  return (
    <div>
      <div className="whitespace-pre-wrap text-[13px]">
        {displayed}
        {streaming && <span className="inline-block w-1.5 h-3 bg-tactical-accent ml-0.5 animate-pulse" />}
      </div>
      {isLong && !streaming && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 mt-1.5 text-[9px] uppercase tracking-wider text-tactical-dim hover:text-tactical-accent transition-colors"
        >
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
};

export const ChatWindow: React.FC<{
  walletAddress: `0x${string}` | null;
  connectWallet: () => Promise<`0x${string}` | null>;
}> = ({ walletAddress, connectWallet }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingContext, setPendingContext] = useState<ContextItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamingIdRef = useRef<string | null>(null);
  const accumulatedRef = useRef<string>("");
  const shouldAutoScrollRef = useRef(true);

  const syncAutoScrollState = () => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD;
  };

  useEffect(() => {
    let cancelled = false;
    openClawClient.connect()
      .then(async () => {
        if (cancelled) return;
        setIsConnected(true);
        setIsConnecting(false);
        const history = await openClawClient.history();
        if (!cancelled && history.length > 0) {
          setMessages(history.map((m, i) => ({
            id: `history-${i}`,
            role: m.role,
            content: m.content,
            card: m.card ?? undefined,
          })));
        }
      })
      .catch(() => { if (!cancelled) setIsConnecting(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !shouldAutoScrollRef.current) return;
    requestAnimationFrame(() => {
      const nextNode = scrollRef.current;
      if (!nextNode) return;
      nextNode.scrollTop = nextNode.scrollHeight;
    });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const msg = text || input;
    if (!msg.trim() && pendingContext.length === 0) return;
    if (!isConnected) return;

    const contextSuffix = pendingContext.length > 0
      ? `\n\nContext: ${pendingContext.map(c => `${c.title} (${c.id})`).join(", ")}`
      : "";

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: msg,
      context: pendingContext.length > 0 ? [...pendingContext] : undefined,
    };

    const assistantId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput("");
    setPendingContext([]);
    shouldAutoScrollRef.current = true;
    streamingIdRef.current = assistantId;
    accumulatedRef.current = "";

    try {
      await openClawClient.send(msg + contextSuffix, (chunk, done) => {
        if (!done) {
          accumulatedRef.current += chunk;
          const streamText = extractStreamingText(accumulatedRef.current);
          if (streamText) {
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: streamText } : m
            ));
          }
        } else {
          const finalContent = chunk || accumulatedRef.current;
          const { text, card } = parseResponse(finalContent);
          const normalizedText = text.trim();
          setMessages(prev => {
            if (!normalizedText && !card) {
              return prev.filter(m => m.id !== assistantId);
            }

            return prev.map(m =>
              m.id === assistantId
                ? {
                    ...m,
                    content: normalizedText || m.content,
                    card: card ?? undefined,
                    streaming: false,
                  }
                : m
            );
          });
          streamingIdRef.current = null;
        }
      });
    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: `Error: ${err?.message ?? "unknown"}`, streaming: false }
          : m
      ));
    }
  };

  const appendLocalActionMessage = (payload: {
    type: string;
    text: string;
    detail: string;
    txHash?: string;
    explorerUrl?: string;
  }) => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: payload.text,
        card: {
          type: "action",
          data: {
            type: payload.type,
            success: true,
            detail: payload.detail,
            txHash: payload.txHash,
            explorerUrl: payload.explorerUrl,
          },
        },
      },
    ]);
    shouldAutoScrollRef.current = true;
  };

  const handleQuoteAccept = async ({ amountWei, quote }: { amountWei: string; quote: QuoteData }) => {
    const ownerAddress = walletAddress ?? (await connectWallet());
    if (!ownerAddress) {
      throw new Error("Connect your wallet to continue.");
    }

    const result = await bootstrapBorrowForOwner({
      ownerAddress,
      quote,
      amountWei,
    });

    await handleSend(
      buildBorrowExecutionPrompt({
        quote,
        amountWei,
        vaultId: result.vaultId,
        ownerAddress: result.ownerAddress,
        operatorAddress: result.operatorAddress,
      })
    );
  };

  const onInputDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const data = e.dataTransfer.getData("application/tabby-context");
    if (data) {
      const item = JSON.parse(data) as ContextItem;
      if (!pendingContext.find(c => c.id === item.id)) {
        setPendingContext(prev => [...prev, item]);
      }
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div
      className="panel relative flex h-full min-h-0 flex-col overflow-hidden"
      onDragOver={e => { e.preventDefault(); setIsDraggingOver(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOver(false); }}
      onDrop={onInputDrop}
    >
      <div className="shrink-0 border-b border-tactical-border px-4 py-2 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-widest text-tactical-dim font-bold">AI Assistant</span>
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider">
          {isConnecting ? (
            <span className="text-tactical-dim">connecting...</span>
          ) : isConnected ? (
            <><Wifi size={9} className="text-tactical-accent" /><span className="text-tactical-accent">openclaw</span></>
          ) : (
            <><WifiOff size={9} className="text-tactical-error" /><span className="text-tactical-error">offline</span></>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={syncAutoScrollState}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6"
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-[13px] uppercase tracking-wider text-tactical-dim mb-8">
              AI {">>"} Ask Tabby all your queries
            </p>
            <div className="flex flex-col gap-3 w-full max-w-md">
              {SUGGESTIONS.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(suggestion)}
                  disabled={!isConnected}
                  className="suggestion-btn text-left flex items-center gap-3 disabled:opacity-30 disabled:cursor-not-allowed"
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
              {messages.map(msg => (
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
                        {msg.context.map(c => (
                          <span key={c.id} className="inline-flex items-center gap-1 border border-tactical-accent/30 bg-tactical-accent/5 px-1.5 py-0.5 text-[9px] font-bold uppercase text-tactical-accent">
                            <Pin size={8} />{c.title}
                          </span>
                        ))}
                      </div>
                    )}

                    <MessageContent content={msg.content} streaming={msg.streaming} />

                    {!msg.streaming && msg.card?.type === "quote" && (
                      <QuoteCard
                        quote={msg.card.data as QuoteData}
                        onAccept={handleQuoteAccept}
                      />
                    )}
                    {!msg.streaming && msg.card?.type === "position" && (
                      <PositionCard
                        vault={msg.card.data as VaultPosition}
                        walletAddress={walletAddress}
                        connectWallet={connectWallet}
                        onActionComplete={appendLocalActionMessage}
                      />
                    )}
                    {!msg.streaming && msg.card?.type === "lp-position" && (
                      <LpPositionCard
                        position={msg.card.data as LpPosition}
                        walletAddress={walletAddress}
                        connectWallet={connectWallet}
                        onActionComplete={appendLocalActionMessage}
                      />
                    )}
                    {!msg.streaming && msg.card?.type === "pool" && (
                      <LpPoolCard
                        pool={msg.card.data}
                        walletAddress={walletAddress}
                        connectWallet={connectWallet}
                        onActionComplete={appendLocalActionMessage}
                      />
                    )}
                    {!msg.streaming && msg.card?.type === "action" && (
                      <ActionCard action={msg.card.data} />
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className={`relative shrink-0 border-t p-4 transition-colors ${isDraggingOver ? "border-tactical-accent bg-tactical-accent/5" : "border-tactical-border"}`}>
        <AnimatePresence>
          {pendingContext.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex gap-1.5 flex-wrap mb-2"
            >
              {pendingContext.map(c => (
                <div key={c.id} className="flex items-center gap-1 border border-tactical-accent/30 bg-tactical-accent/5 px-2 py-0.5 text-[9px] font-bold uppercase text-tactical-accent shrink-0">
                  <Pin size={8} />{c.title}
                  <X size={8} className="ml-0.5 cursor-pointer hover:text-tactical-error transition-colors" onClick={() => setPendingContext(prev => prev.filter(item => item.id !== c.id))} />
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            disabled={!isConnected}
            placeholder={
              isConnecting ? "Connecting to OpenClaw..." :
              !isConnected ? "OpenClaw offline — check gateway" :
              isDraggingOver ? "Drop context here..." :
              "Type your message..."
            }
            className="flex-1 bg-transparent border-none p-2 text-sm font-mono focus:outline-none placeholder:text-tactical-dim/50 placeholder:uppercase disabled:opacity-40"
          />
          <button
            onClick={() => handleSend()}
            disabled={!isConnected || (!input.trim() && pendingContext.length === 0)}
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
