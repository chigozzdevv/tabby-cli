import type { FastifyInstance } from "fastify";
import { env } from "@/config/env.js";

export function registerPublicConfigRoutes(app: FastifyInstance) {
  app.get("/public/config", async () => ({
    ok: true,
    data: {
      chainId: env.CHAIN_ID,
      timeLock: env.TIMELOCK_ADDRESS,
      treasury: env.TREASURY_ADDRESS,
      priceOracle: env.PRICE_ORACLE_ADDRESS,
      marketConfig: env.MARKET_CONFIG_ADDRESS,
      debtPool: env.DEBT_POOL_ADDRESS,
      vaultManager: env.VAULT_MANAGER_ADDRESS,
      debtAsset: env.DEBT_ASSET_ADDRESS,
      collateralAssets: env.COLLATERAL_ASSETS,
      walletRegistry: env.WALLET_REGISTRY_ADDRESS,
    },
  }));
}
