import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  formatUnits,
  parseUnits,
  type Address,
} from "viem";

import type { QuoteData } from "./api-client";
import {
  createOperatorWallet,
  getConfig,
  listPositions,
  confirmOperatorBinding,
} from "./api-client";

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const vaultManagerAbi = [
  {
    type: "function",
    name: "openVault",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "depositCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "vaultOperators",
    stateMutability: "view",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "setVaultOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "operator", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vaultId", type: "uint256" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "VaultOpened",
    inputs: [
      { indexed: true, name: "vaultId", type: "uint256" },
      { indexed: true, name: "owner", type: "address" },
    ],
  },
] as const;

export type BorrowBootstrapResult = {
  vaultId: number;
  ownerAddress: Address;
  operatorAddress: Address;
  openedVault: boolean;
  depositedCollateral: boolean;
  boundOperator: boolean;
};

export type VaultOwnerActionResult = {
  text: string;
  detail: string;
  txHash: string;
  explorerUrl: string;
};

function plasmaTxUrl(hash: string) {
  return `https://plasmascan.to/tx/${hash}`;
}

function requireEthereum() {
  if (!window.ethereum) {
    throw new Error("No wallet detected. Connect a browser wallet first.");
  }
  return window.ethereum;
}

async function ensurePlasmaChain(chainId: number) {
  const ethereum = requireEthereum();
  const currentChainId = await ethereum.request({ method: "eth_chainId" }) as string;
  const targetChainId = `0x${chainId.toString(16)}`;
  if (currentChainId === targetChainId) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainId }],
    });
  } catch (error: any) {
    if (error?.code === 4902) {
      throw new Error("Add the Plasma network to your wallet first, then try again.");
    }
    throw new Error("Switch your wallet to Plasma before borrowing.");
  }
}

function getBrowserClients(chainId: number) {
  const ethereum = requireEthereum();
  const chain = {
    id: chainId,
    name: chainId === 9745 ? "Plasma Mainnet" : "Plasma",
    nativeCurrency: { name: "XPL", symbol: "XPL", decimals: 18 },
    rpcUrls: { default: { http: [] } },
  } as const;

  return {
    publicClient: createPublicClient({ chain, transport: custom(ethereum) }) as any,
    walletClient: createWalletClient({ chain, transport: custom(ethereum) }) as any,
  };
}

async function ensureAllowance(
  ownerAddress: Address,
  token: Address,
  spender: Address,
  requiredAmount: bigint,
  publicClient: any,
  walletClient: any,
) {
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [ownerAddress, spender],
  });

  if (allowance >= requiredAmount) return;

  const hash = await walletClient.writeContract({
    account: ownerAddress,
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, requiredAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
}

async function ensureCollateralBalance(
  ownerAddress: Address,
  token: Address,
  requiredAmount: bigint,
  symbol: string,
  decimals: number,
  publicClient: any,
) {
  const balance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [ownerAddress],
  });

  if (balance < requiredAmount) {
    throw new Error(
      `Wallet balance is too low for ${symbol}. Need ${formatUnits(requiredAmount, decimals)} ${symbol}.`
    );
  }
}

async function openVault(
  ownerAddress: Address,
  vaultManager: Address,
  publicClient: any,
  walletClient: any,
) {
  const hash = await walletClient.writeContract({
    account: ownerAddress,
    address: vaultManager,
    abi: vaultManagerAbi,
    functionName: "openVault",
    args: [],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: vaultManagerAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "VaultOpened") {
        return Number(decoded.args.vaultId);
      }
    } catch {}
  }

  throw new Error("Vault opened but the receipt did not include a vault id.");
}

function firstExistingVault(ownerVaults: Awaited<ReturnType<typeof listPositions>>) {
  return ownerVaults[0]?.vaultId;
}

function requireVaultOwner(ownerAddress: Address, vaultOwner: string) {
  if (ownerAddress.toLowerCase() !== vaultOwner.toLowerCase()) {
    throw new Error("Connected wallet is not the owner of this vault.");
  }
}

async function isOperatorBound(
  vaultManager: Address,
  vaultId: number,
  operator: Address,
  publicClient: any,
) {
  return await publicClient.readContract({
    address: vaultManager,
    abi: vaultManagerAbi,
    functionName: "vaultOperators",
    args: [BigInt(vaultId), operator],
  });
}

async function bindOperatorOnchain(params: {
  ownerAddress: Address;
  vaultManager: Address;
  vaultId: number;
  operator: Address;
  publicClient: any;
  walletClient: any;
}) {
  const alreadyBound = await isOperatorBound(
    params.vaultManager,
    params.vaultId,
    params.operator,
    params.publicClient,
  );
  if (alreadyBound) return true;

  const hash = await params.walletClient.writeContract({
    account: params.ownerAddress,
    address: params.vaultManager,
    abi: vaultManagerAbi,
    functionName: "setVaultOperator",
    args: [BigInt(params.vaultId), params.operator, true],
  });
  await params.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

  return await isOperatorBound(
    params.vaultManager,
    params.vaultId,
    params.operator,
    params.publicClient,
  );
}

export async function bootstrapBorrowForOwner(params: {
  ownerAddress: Address;
  quote: QuoteData;
  amountWei: string;
}): Promise<BorrowBootstrapResult> {
  const { ownerAddress, quote } = params;
  const config = await getConfig();
  if (!config) {
    throw new Error("Tabby config is unavailable right now.");
  }

  await ensurePlasmaChain(config.chainId);
  const { publicClient, walletClient } = getBrowserClients(config.chainId);
  const existingVaults = await listPositions(ownerAddress).catch((error: any) => {
    throw new Error(`Failed to load existing vaults: ${error?.message ?? "unknown error"}`);
  });

  let vaultId = firstExistingVault(existingVaults);
  let openedVault = false;
  if (!vaultId) {
    vaultId = await openVault(ownerAddress, config.vaultManager, publicClient, walletClient).catch((error: any) => {
      throw new Error(`Failed to open a vault from the connected wallet: ${error?.message ?? "unknown error"}`);
    });
    openedVault = true;
  }

  for (const collateral of quote.requestedCollaterals) {
    const amountWei = BigInt(collateral.requestedAmountWei);
    if (amountWei === 0n) continue;

    await ensureCollateralBalance(
      ownerAddress,
      collateral.asset as Address,
      amountWei,
      collateral.symbol,
      collateral.decimals,
      publicClient,
    ).catch((error: any) => {
      throw new Error(`Insufficient ${collateral.symbol} for the quoted collateral deposit: ${error?.message ?? "unknown error"}`);
    });
    await ensureAllowance(
      ownerAddress,
      collateral.asset as Address,
      config.vaultManager,
      amountWei,
      publicClient,
      walletClient,
    ).catch((error: any) => {
      throw new Error(`Failed to approve ${collateral.symbol} for the vault: ${error?.message ?? "unknown error"}`);
    });

    const depositHash = await walletClient.writeContract({
      account: ownerAddress,
      address: config.vaultManager,
      abi: vaultManagerAbi,
      functionName: "depositCollateral",
      args: [BigInt(vaultId), collateral.asset as Address, amountWei],
    }).catch((error: any) => {
      throw new Error(`Failed to submit the ${collateral.symbol} collateral deposit: ${error?.message ?? "unknown error"}`);
    });
    await publicClient.waitForTransactionReceipt({ hash: depositHash, confirmations: 1 }).catch((error: any) => {
      throw new Error(`The ${collateral.symbol} collateral deposit transaction did not confirm: ${error?.message ?? "unknown error"}`);
    });
  }

  const operatorWallet = await createOperatorWallet().catch((error: any) => {
    throw new Error(`Failed to create or load the borrower operator wallet: ${error?.message ?? "unknown error"}`);
  });
  let boundOperator = await bindOperatorOnchain({
    ownerAddress,
    vaultManager: config.vaultManager,
    vaultId,
    operator: operatorWallet.address,
    publicClient,
    walletClient,
  }).catch((error: any) => {
    throw new Error(`Failed to bind operator ${operatorWallet.address} for vault #${vaultId}: ${error?.message ?? "unknown error"}`);
  });

  if (boundOperator) {
    await confirmOperatorBinding({
      vaultId,
      operator: operatorWallet.address,
    }).catch(() => undefined);
  }

  if (!boundOperator) {
    throw new Error("Operator binding did not complete.");
  }

  return {
    vaultId,
    ownerAddress,
    operatorAddress: operatorWallet.address,
    openedVault,
    depositedCollateral: quote.requestedCollaterals.some((item) => BigInt(item.requestedAmountWei) > 0n),
    boundOperator,
  };
}

export function buildBorrowExecutionPrompt(params: {
  quote: QuoteData;
  amountWei: string;
  vaultId: number;
  ownerAddress: Address;
  operatorAddress: Address;
}) {
  const amount = formatUnits(BigInt(params.amountWei), params.quote.debtAsset.decimals);
  return `Borrow ${amount} ${params.quote.debtAsset.symbol} from vault #${params.vaultId} to ${params.ownerAddress}. The owner already opened the vault, deposited the quoted collateral, and bound operator ${params.operatorAddress}. Run the borrow directly now.`;
}

export async function depositCollateralFromOwner(params: {
  ownerAddress: Address;
  vault: {
    vaultId: number;
    owner: string;
    collaterals: {
      asset: { address: string; symbol: string; decimals: number };
    }[];
  };
  assetAddress: Address;
  amount: string;
}): Promise<VaultOwnerActionResult> {
  const config = await getConfig();
  if (!config) {
    throw new Error("Tabby config is unavailable right now.");
  }

  requireVaultOwner(params.ownerAddress, params.vault.owner);
  await ensurePlasmaChain(config.chainId);
  const { publicClient, walletClient } = getBrowserClients(config.chainId);

  const selected = params.vault.collaterals.find(
    (item) => item.asset.address.toLowerCase() === params.assetAddress.toLowerCase(),
  );
  if (!selected) {
    throw new Error("Selected collateral asset is not available on this vault card.");
  }

  const amountWei = parseUnits(params.amount || "0", selected.asset.decimals);
  if (amountWei <= 0n) {
    throw new Error("Enter a collateral amount greater than zero.");
  }

  await ensureCollateralBalance(
    params.ownerAddress,
    params.assetAddress,
    amountWei,
    selected.asset.symbol,
    selected.asset.decimals,
    publicClient,
  );
  await ensureAllowance(
    params.ownerAddress,
    params.assetAddress,
    config.vaultManager,
    amountWei,
    publicClient,
    walletClient,
  );

  const hash = await walletClient.writeContract({
    account: params.ownerAddress,
    address: config.vaultManager,
    abi: vaultManagerAbi,
    functionName: "depositCollateral",
    args: [BigInt(params.vault.vaultId), params.assetAddress, amountWei],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

  const amountText = formatUnits(amountWei, selected.asset.decimals);
  return {
    text: `Deposited ${amountText} ${selected.asset.symbol} into vault #${params.vault.vaultId}.`,
    detail: `${amountText} ${selected.asset.symbol} deposited into vault #${params.vault.vaultId}.`,
    txHash: hash,
    explorerUrl: plasmaTxUrl(hash),
  };
}

export async function withdrawCollateralFromOwner(params: {
  ownerAddress: Address;
  vault: {
    vaultId: number;
    owner: string;
    collaterals: {
      asset: { address: string; symbol: string; decimals: number };
      balanceWei: string;
    }[];
  };
  assetAddress: Address;
  amountWei: bigint;
}): Promise<VaultOwnerActionResult> {
  const config = await getConfig();
  if (!config) {
    throw new Error("Tabby config is unavailable right now.");
  }

  requireVaultOwner(params.ownerAddress, params.vault.owner);
  await ensurePlasmaChain(config.chainId);
  const { publicClient, walletClient } = getBrowserClients(config.chainId);

  const selected = params.vault.collaterals.find(
    (item) => item.asset.address.toLowerCase() === params.assetAddress.toLowerCase(),
  );
  if (!selected) {
    throw new Error("Selected collateral asset is not available on this vault.");
  }
  if (params.amountWei <= 0n) {
    throw new Error("Enter a withdrawal amount greater than zero.");
  }
  if (BigInt(selected.balanceWei) < params.amountWei) {
    throw new Error("Withdrawal amount exceeds collateral balance.");
  }

  const hash = await walletClient.writeContract({
    account: params.ownerAddress,
    address: config.vaultManager,
    abi: vaultManagerAbi,
    functionName: "withdrawCollateral",
    args: [BigInt(params.vault.vaultId), params.assetAddress, params.amountWei, params.ownerAddress],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

  const amountText = formatUnits(params.amountWei, selected.asset.decimals);
  return {
    text: `Withdrew ${amountText} ${selected.asset.symbol} from vault #${params.vault.vaultId}.`,
    detail: `${amountText} ${selected.asset.symbol} withdrawn from vault #${params.vault.vaultId}.`,
    txHash: hash,
    explorerUrl: plasmaTxUrl(hash),
  };
}
