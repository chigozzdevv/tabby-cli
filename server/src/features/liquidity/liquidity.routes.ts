import type { FastifyInstance } from "fastify";
import {
  getDepositQuote,
  getLpPositionByAccount,
  getPool,
  getWithdrawQuote,
} from "@/features/liquidity/liquidity.controller.js";

export function registerLiquidityRoutes(app: FastifyInstance) {
  app.get("/liquidity/pool", getPool);
  app.get("/liquidity/position", getLpPositionByAccount);
  app.get("/liquidity/quote/deposit", getDepositQuote);
  app.get("/liquidity/quote/withdraw", getWithdrawQuote);
}
