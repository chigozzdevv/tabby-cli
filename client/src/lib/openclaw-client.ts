const GATEWAY_URL = import.meta.env.VITE_OPENCLAW_GATEWAY_URL || "ws://localhost:18789";
const GATEWAY_TOKEN = import.meta.env.VITE_OPENCLAW_TOKEN || "";

export type ChunkHandler = (streamingText: string, done: boolean) => void;

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
          await this.rpc("connect", {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "webchat-ui", displayName: "Tabby Web", mode: "webchat", version: "1.0.0", platform: "web" },
            auth: { token: GATEWAY_TOKEN },
            role: "operator",
            scopes: ["operator.read", "operator.write", "operator.admin", "operator.approvals", "operator.pairing"],
            caps: ["tool-events"],
            locale: navigator.language,
            userAgent: navigator.userAgent,
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

  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    }
  } catch {
    return { text: raw.trim(), card: null };
  }

  if (!parsed) return { text: raw.trim(), card: null };

  const text = parsed.text ?? raw.trim();

  if (parsed.isQuote && parsed.quote) return { text, card: { type: "quote", data: parsed.quote } };
  if (parsed.isPosition && parsed.position) return { text, card: { type: "position", data: parsed.position } };
  if (parsed.isPool && parsed.pool) return { text, card: { type: "pool", data: parsed.pool } };
  if (parsed.isAction && parsed.action) return { text, card: { type: "action", data: parsed.action } };

  return { text, card: null };
}
