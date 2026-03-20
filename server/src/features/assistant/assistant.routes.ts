import type { FastifyInstance } from "fastify";
import {
  addSessionMessage,
  confirmBinding,
  createOperatorWallet,
  createSession,
  getPreflightQuote,
  getSession,
  prepareBinding,
} from "@/features/assistant/assistant.controller.js";

export function registerAssistantRoutes(app: FastifyInstance) {
  app.post("/assistant/sessions", createSession);
  app.get("/assistant/sessions/:sessionId", getSession);
  app.post("/assistant/sessions/:sessionId/messages", addSessionMessage);

  app.post("/assistant/quotes/preflight", getPreflightQuote);

  app.post("/assistant/bindings/operator-wallet", createOperatorWallet);
  app.post("/assistant/bindings/prepare", prepareBinding);
  app.post("/assistant/bindings/confirm", confirmBinding);
}
