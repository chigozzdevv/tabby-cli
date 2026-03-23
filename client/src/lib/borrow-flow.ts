import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  formatUnits,
  type Address,
  type Hex,
} from "viem";

import type { QuoteData } from "./api-client";
import {
  createOperatorWallet,
  getConfig,
  listPositions,
  prepareOperatorBinding,
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
  const existingVaults = await listPositions(ownerAddress);

  let vaultId = firstExistingVault(existingVaults);
  let openedVault = false;
  if (!vaultId) {
    vaultId = await openVault(ownerAddress, config.vaultManager, publicClient, walletClient);
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
    );
    await ensureAllowance(
      ownerAddress,
      collateral.asset as Address,
      config.vaultManager,
      amountWei,
      publicClient,
      walletClient,
    );

    const depositHash = await walletClient.writeContract({
      account: ownerAddress,
      address: config.vaultManager,
      abi: vaultManagerAbi,
      functionName: "depositCollateral",
      args: [BigInt(vaultId), collateral.asset as Address, amountWei],
    });
    await publicClient.waitForTransactionReceipt({ hash: depositHash, confirmations: 1 });
  }

  const operatorWallet = await createOperatorWallet();
  const prepared = await prepareOperatorBinding({
    vaultId,
    operator: operatorWallet.address,
  });

  let boundOperator = prepared.currentlyBound;
  if (!boundOperator) {
    const bindHash = await walletClient.sendTransaction({
      account: ownerAddress,
      to: prepared.transaction.to,
      data: prepared.transaction.data as Hex,
      value: BigInt(prepared.transaction.valueWei),
    });
    await publicClient.waitForTransactionReceipt({ hash: bindHash, confirmations: 1 });
    const confirmed = await confirmOperatorBinding({
      bindingId: prepared.binding.bindingId,
      vaultId,
      operator: operatorWallet.address,
    });
    boundOperator = confirmed.bound;
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
