import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  parseUnits,
  type Address,
} from "viem";

import { getConfig } from "./api-client";

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
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

const debtPoolAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "previewDeposit",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "previewWithdraw",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

declare global {
  interface Window {
    ethereum?: any;
  }
}

type LpActionResult = {
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
    throw new Error("Switch your wallet to Plasma before managing LP.");
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

function formatDisplayAmount(value: bigint, decimals: number) {
  return Number(formatUnits(value, decimals)).toFixed(value < 10n ** BigInt(decimals) ? 4 : 2);
}

export async function depositLiquidityFromOwner(params: {
  ownerAddress: Address;
  amount: string;
}): Promise<LpActionResult> {
  const config = await getConfig();
  if (!config) {
    throw new Error("Tabby config is unavailable right now.");
  }

  await ensurePlasmaChain(config.chainId);
  const { publicClient, walletClient } = getBrowserClients(config.chainId);

  const [decimals, symbol, balance] = await Promise.all([
    publicClient.readContract({ address: config.debtAsset, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: config.debtAsset, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({
      address: config.debtAsset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [params.ownerAddress],
    }),
  ]);

  const amountWei = parseUnits(params.amount, Number(decimals));
  if (amountWei <= 0n) {
    throw new Error("Enter a deposit amount greater than zero.");
  }
  if (balance < amountWei) {
    throw new Error(`Wallet balance is too low. Need ${formatUnits(amountWei, Number(decimals))} ${symbol}.`);
  }

  await ensureAllowance(
    params.ownerAddress,
    config.debtAsset,
    config.debtPool,
    amountWei,
    publicClient,
    walletClient,
  );

  const hash = await walletClient.writeContract({
    account: params.ownerAddress,
    address: config.debtPool,
    abi: debtPoolAbi,
    functionName: "deposit",
    args: [amountWei],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

  const shares = await publicClient.readContract({
    address: config.debtPool,
    abi: debtPoolAbi,
    functionName: "balanceOf",
    args: [params.ownerAddress],
  });

  const amountText = formatDisplayAmount(amountWei, Number(decimals));
  const shareText = formatDisplayAmount(shares, Number(decimals));
  return {
    text: `Deposited ${amountText} ${symbol}. You now hold ${shareText} pool shares.`,
    detail: `${amountText} ${symbol} deposited. Current shares: ${shareText}.`,
    txHash: hash,
    explorerUrl: plasmaTxUrl(hash),
  };
}

export async function withdrawLiquidityFromOwner(params: {
  ownerAddress: Address;
  amount?: string;
  all?: boolean;
}): Promise<LpActionResult> {
  const config = await getConfig();
  if (!config) {
    throw new Error("Tabby config is unavailable right now.");
  }

  await ensurePlasmaChain(config.chainId);
  const { publicClient, walletClient } = getBrowserClients(config.chainId);

  const [decimals, symbol, currentShares] = await Promise.all([
    publicClient.readContract({ address: config.debtAsset, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: config.debtAsset, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({
      address: config.debtPool,
      abi: debtPoolAbi,
      functionName: "balanceOf",
      args: [params.ownerAddress],
    }),
  ]);

  if (currentShares <= 0n) {
    throw new Error("No LP shares available to withdraw.");
  }

  let sharesToWithdraw = currentShares;
  if (!params.all) {
    if (!params.amount) {
      throw new Error("Enter an amount to withdraw.");
    }
    const amountWei = parseUnits(params.amount, Number(decimals));
    if (amountWei <= 0n) {
      throw new Error("Enter a withdrawal amount greater than zero.");
    }
    sharesToWithdraw = await publicClient.readContract({
      address: config.debtPool,
      abi: debtPoolAbi,
      functionName: "previewDeposit",
      args: [amountWei],
    });
    if (sharesToWithdraw <= 0n) {
      throw new Error("Withdrawal amount is too small.");
    }
    if (sharesToWithdraw > currentShares) {
      throw new Error("Withdrawal amount exceeds your LP position.");
    }
  }

  const expectedAssets = await publicClient.readContract({
    address: config.debtPool,
    abi: debtPoolAbi,
    functionName: "previewWithdraw",
    args: [sharesToWithdraw],
  });

  const hash = await walletClient.writeContract({
    account: params.ownerAddress,
    address: config.debtPool,
    abi: debtPoolAbi,
    functionName: "withdraw",
    args: [sharesToWithdraw],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

  const remainingShares = await publicClient.readContract({
    address: config.debtPool,
    abi: debtPoolAbi,
    functionName: "balanceOf",
    args: [params.ownerAddress],
  });

  const assetsText = formatDisplayAmount(expectedAssets, Number(decimals));
  const shareText = formatDisplayAmount(remainingShares, Number(decimals));
  return {
    text: `Withdrew about ${assetsText} ${symbol}. Remaining shares: ${shareText}.`,
    detail: `About ${assetsText} ${symbol} withdrawn. Remaining shares: ${shareText}.`,
    txHash: hash,
    explorerUrl: plasmaTxUrl(hash),
  };
}
