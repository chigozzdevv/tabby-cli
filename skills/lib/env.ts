import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseDotEnv(content: string) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function loadLocalEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", ".env"), 
    path.join(here, "..", "..", ".env"),
    path.join(process.cwd(), ".env")
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      parseDotEnv(raw);
    } catch {}
  }
}

loadLocalEnv();

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

export type TabbyEnv = z.infer<typeof envSchema>;

export function getEnv(): TabbyEnv {
  return envSchema.parse(process.env);
}
