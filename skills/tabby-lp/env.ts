import { z } from "zod";

function emptyToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  return value.trim().length === 0 ? undefined : value;
}

const envSchema = z
  .object({
    TABBY_API_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default("https://api.tabby.cash")),
    CHAIN_ID: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
    RPC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    VAULT_MANAGER_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
    DEBT_POOL_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
    MARKET_CONFIG_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
    DEBT_ASSET_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
    COLLATERAL_ASSETS: z.preprocess(emptyToUndefined, z.string().optional()),
    COLLATERAL_ASSET: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
    TABBY_MIN_GAS_WEI: z.preprocess(emptyToUndefined, z.string().regex(/^\d+$/).optional()),
    TABBY_WARN_HEALTH_FACTOR_E18: z.preprocess(emptyToUndefined, z.string().regex(/^\d+$/).optional()),
    TABBY_CRITICAL_HEALTH_FACTOR_E18: z.preprocess(emptyToUndefined, z.string().regex(/^\d+$/).optional()),
    TABBY_NOTIFICATION_TARGET: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .passthrough();

export type BorrowerEnv = z.infer<typeof envSchema>;

export function getEnv(): BorrowerEnv {
  return envSchema.parse(process.env);
}
