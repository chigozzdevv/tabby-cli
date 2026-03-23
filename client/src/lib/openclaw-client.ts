import { buildQuoteSummaryText } from "./api-client";

const GATEWAY_URL = import.meta.env.VITE_OPENCLAW_GATEWAY_URL || "ws://localhost:3000/gateway";
const GATEWAY_TOKEN = import.meta.env.VITE_OPENCLAW_TOKEN || "";

const SCOPES = ["operator.read", "operator.write", "operator.admin", "operator.approvals", "operator.pairing"];
const DEVICE_KEY = "tabby:device:v1";

export type ChunkHandler = (streamingText: string, done: boolean) => void;

export type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
  card?: TabbyCard | null;
};

function extractTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextContent(item))
      .filter((item) => item.trim().length > 0)
      .join("\n")
      .trim();
  }

  if (typeof value !== "object" || value === null) return "";

  const record = value as Record<string, unknown>;

  if (typeof record.text === "string") return record.text;
  if (typeof record.body === "string") return record.body;
  if (typeof record.message === "string") return record.message;

  const nestedKeys = ["content", "parts", "message", "payload", "value"];
  for (const key of nestedKeys) {
    if (key in record) {
      const nested = extractTextContent(record[key]);
      if (nested.trim().length > 0) return nested;
    }
  }

  return "";
}

function isStartupBoilerplate(text: string): boolean {
  return (
    text.startsWith("A new session was started via /new or /reset.") ||
    (text.includes("Run your Session Startup sequence") && text.includes("what they want to do"))
  );
}

function sanitizeHistoryText(role: HistoryMessage["role"], text: string): string | null {
  if (!text.trim()) return null;

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (isStartupBoilerplate(normalized)) return null;

  const cleanedLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      if (!line) return "";
      if (/^System:\s*\[[^\]]+\]\s*Exec (completed|failed)\b/i.test(line)) return "";
      return line.replace(/^\[[^\]]+\]\s*/, "").trim();
    })
    .filter(Boolean);

  if (cleanedLines.length === 0) return null;

  const cleaned = cleanedLines.join("\n").trim();
  if (!cleaned) return null;
  if (role === "user" && isStartupBoilerplate(cleaned)) return null;
  return cleaned;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

async function getOrCreateDevice() {
  const ED25519 = { name: "Ed25519" } as const;
  const stored = localStorage.getItem(DEVICE_KEY);
  if (stored) {
    try {
      const { deviceId, publicKeyB64, privateKeyB64 } = JSON.parse(stored);
      const privateKey = await crypto.subtle.importKey("pkcs8", base64ToBytes(privateKeyB64) as unknown as ArrayBuffer, ED25519, false, ["sign"]);
      return { deviceId, publicKeyB64, privateKey };
    } catch {}
  }
  const keyPair = await crypto.subtle.generateKey(ED25519, true, ["sign"]);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const hashBuffer = await crypto.subtle.digest("SHA-256", publicKeyRaw);
  const deviceId = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  const publicKeyB64 = bytesToBase64(publicKeyRaw);
  const privateKeyB64 = bytesToBase64(privateKeyPkcs8);
  localStorage.setItem(DEVICE_KEY, JSON.stringify({ deviceId, publicKeyB64, privateKeyB64 }));
  return { deviceId, publicKeyB64, privateKey: keyPair.privateKey };
}

class OpenClawClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, (res: any) => void>();
  private chunkHandler: ChunkHandler | null = null;
  private _connected = false;

  get connected() {
    return this._connected && this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(GATEWAY_URL);
      this.ws = ws;

      ws.onmessage = (event) => {
        let frame: any;
        try { frame = JSON.parse(event.data); } catch { return; }

        if (frame.type === "res") {
          const cb = this.pending.get(frame.id);
          if (cb) { this.pending.delete(frame.id); cb(frame); }
          return;
        }

        if (frame.type === "event" && frame.event === "chat") {
          const { state, message } = frame.payload ?? {};
          const chunk = message?.content?.[0]?.text ?? message?.content ?? "";
          const done = state === "final" || state === "aborted" || state === "error";
          if (chunk || done) {
            this.chunkHandler?.(typeof chunk === "string" ? chunk : JSON.stringify(chunk), done);
          }
          if (done) this.chunkHandler = null;
        }
      };

      ws.onerror = () => reject(new Error("OpenClaw gateway unreachable"));
      ws.onclose = () => { this._connected = false; };

      ws.onopen = async () => {
        try {
          // Wait for connect.challenge (up to 3s)
          const nonce = await new Promise<string>((res) => {
            const timer = setTimeout(() => res(""), 3000);
            const handler = (e: MessageEvent) => {
              try {
                const f = JSON.parse(e.data);
                if (f.type === "event" && f.event === "connect.challenge") {
                  clearTimeout(timer);
                  ws.removeEventListener("message", handler);
                  res(f.payload.nonce);
                }
              } catch {}
            };
            ws.addEventListener("message", handler);
          });

          let device: any = undefined;
          if (nonce) {
            const dev = await getOrCreateDevice();
            const signedAt = Date.now();
            const payload = ["v2", dev.deviceId, "webchat-ui", "webchat", "operator", SCOPES.join(","), String(signedAt), GATEWAY_TOKEN, nonce].join("|");
            const sig = await crypto.subtle.sign("Ed25519", dev.privateKey, new TextEncoder().encode(payload));
            device = {
              id: dev.deviceId,
              publicKey: dev.publicKeyB64,
              signature: bytesToBase64(new Uint8Array(sig)),
              signedAt,
              nonce,
            };
          }

          await this.rpc("connect", {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "webchat-ui", displayName: "Tabby Web", mode: "webchat", version: "1.0.0", platform: "web" },
            auth: { token: GATEWAY_TOKEN },
            role: "operator",
            scopes: SCOPES,
            caps: ["tool-events"],
            locale: navigator.language,
            userAgent: navigator.userAgent,
            ...(device ? { device } : {}),
          });
          await this.rpc("sessions.messages.subscribe", { key: "main" }).catch(() => {});
          this._connected = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      };
    });
  }

  private rpc(method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, 10_000);

      this.pending.set(id, (res) => {
        clearTimeout(timeout);
        if (res.ok) resolve(res.payload);
        else reject(new Error(res.error?.message ?? `RPC error: ${method}`));
      });

      this.ws?.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  async history(): Promise<HistoryMessage[]> {
    if (!this.connected) return [];
    try {
      const res = await this.rpc("chat.history", { sessionKey: "main" });
      const entries: any[] = res?.messages ?? res?.entries ?? [];
      return entries
        .filter((e: any) => e.role === "user" || e.role === "assistant")
        .map((e: any): HistoryMessage | null => {
          const rawContent = extractTextContent(e.content ?? e.message?.content ?? e.body ?? "");
          if (e.role === "assistant") {
            const { text, card } = parseResponse(rawContent);
            const sanitizedText = sanitizeHistoryText(e.role, text);
            if (!sanitizedText && !card) return null;
            return { role: e.role, content: sanitizedText ?? "", card };
          }

          const sanitizedText = sanitizeHistoryText(e.role, rawContent);
          if (!sanitizedText) return null;
          return { role: e.role, content: sanitizedText, card: null };
        })
        .filter((e): e is HistoryMessage => !!e)
        .filter((e: HistoryMessage) => e.content.trim().length > 0 || !!e.card);
    } catch {
      return [];
    }
  }

  async send(text: string, onChunk: ChunkHandler): Promise<void> {
    if (!this.connected) throw new Error("Not connected");
    this.chunkHandler = onChunk;
    await this.rpc("chat.send", {
      sessionKey: "main",
      message: text,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }
}

export const openClawClient = new OpenClawClient();

export type TabbyCardType = "quote" | "position" | "pool" | "action";

export type TabbyCard = { type: TabbyCardType; data: any };

export type TabbyResponse = {
  text: string;
  isQuote: boolean;
  isPosition: boolean;
  isPool: boolean;
  isAction: boolean;
  quote: any;
  position: any;
  pool: any;
  action: any;
};

export function extractStreamingText(partial: string): string {
  const match = partial.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

export function parseResponse(raw: string): { text: string; card: TabbyCard | null } {
  let parsed: Partial<TabbyResponse> | null = null;
  const fallbackRaw = raw.trim();

  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    }
  } catch {
    return { text: fallbackRaw, card: null };
  }

  if (!parsed) return { text: fallbackRaw, card: null };

  let card: TabbyCard | null = null;
  if (parsed.isQuote && parsed.quote) card = { type: "quote", data: parsed.quote };
  else if (parsed.isPosition && parsed.position) card = { type: "position", data: parsed.position };
  else if (parsed.isPool && parsed.pool) card = { type: "pool", data: parsed.pool };
  else if (parsed.isAction && parsed.action) card = { type: "action", data: parsed.action };

  let parsedText = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (card?.type === "quote") {
    try {
      parsedText = buildQuoteSummaryText(card.data);
    } catch {}
  }
  const fallbackText =
    card?.type === "quote" ? "Quote ready." :
    card?.type === "position" ? "Position loaded." :
    card?.type === "pool" ? "Pool status loaded." :
    card?.type === "action" ? "Action completed." :
    fallbackRaw;
  return { text: parsedText || fallbackText, card };
}
