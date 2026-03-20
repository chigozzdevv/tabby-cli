import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "@/config/env.js";

export const chain = {
  id: env.CHAIN_ID,
  name: env.CHAIN_ID === 9745 ? "Plasma Mainnet" : "Plasma",
  nativeCurrency: { name: "XPL", symbol: "XPL", decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_URL] } },
} as const;

export const operatorAccount = privateKeyToAccount(env.OPERATOR_PRIVATE_KEY as Hex);

export const publicClient = createPublicClient({
  chain,
  transport: http(env.RPC_URL),
});

export const walletClient = createWalletClient({
  account: operatorAccount,
  chain,
  transport: http(env.RPC_URL),
});

export function asAddress(value: string | undefined, label = "address"): Address {
  if (!value) {
    throw new Error(`${label}-not-configured`);
  }
  return value as Address;
}
