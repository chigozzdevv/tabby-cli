import WDK from "@tetherto/wdk";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { mnemonicToAccount } from "viem/accounts";
import { createWalletClient, http, type Chain } from "viem";

export type WDKWalletStore = {
  address: `0x${string}`;
  seedPhrase: string;
};

export function generateSeedPhrase(): string {
  return WDK.getRandomSeedPhrase();
}

export function deriveAccount(seedPhrase: string) {
  return mnemonicToAccount(seedPhrase);
}

export function createWDKInstance(seedPhrase: string, rpcUrl: string) {
  const wdk = new WDK(seedPhrase);
  return wdk.registerWallet("plasma", WalletManagerEvm, { provider: rpcUrl });
}

export function createViemWalletClient(seedPhrase: string, chain: Chain, rpcUrl: string) {
  const account = deriveAccount(seedPhrase);
  return createWalletClient({ account, chain, transport: http(rpcUrl) });
}

export function walletStoreFromSeedPhrase(seedPhrase: string): WDKWalletStore {
  const account = deriveAccount(seedPhrase);
  return { address: account.address, seedPhrase };
}
