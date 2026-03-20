import type { FastifyInstance } from "fastify";
import { requireMoltbookAuth } from "@/features/auth/auth.middleware.js";
import { getMarket, getVaultById, getVaultsByOwner } from "@/features/monitoring/monitoring.controller.js";

export function registerMonitoringRoutes(app: FastifyInstance) {
  app.get("/monitoring/market", { preHandler: requireMoltbookAuth }, getMarket);
  app.get("/monitoring/vaults", { preHandler: requireMoltbookAuth }, getVaultsByOwner);
  app.get("/monitoring/vaults/:vaultId", { preHandler: requireMoltbookAuth }, getVaultById);

  app.get("/public/monitoring/market", getMarket);
  app.get("/public/monitoring/vaults", getVaultsByOwner);
  app.get("/public/monitoring/vaults/:vaultId", getVaultById);
}
