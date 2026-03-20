import { randomBytes, randomUUID } from "node:crypto";
import { encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getDb } from "@/db/mongodb.js";
import { HttpError } from "@/shared/http-errors.js";
import { env } from "@/config/env.js";
import { publicClient } from "@/shared/viem.js";
import { erc20BalanceOfAbi, vaultManagerAbi } from "@/shared/protocol.js";
import { getPoolSnapshot } from "@/features/liquidity/liquidity.service.js";
import { getMarketOverview, getVaultSummary } from "@/features/monitoring/monitoring.service.js";
import type {
  AgentBinding,
  AssistantCollateralIntent,
  AssistantMessage,
  AssistantMessageRole,
  AssistantMode,
  AssistantSession,
  BorrowPreflightQuote,
  PreflightCollateralQuote,
} from "@/features/assistant/assistant.types.js";

type AssistantSessionDoc = {
  sessionId: string;
  mode: AssistantMode;
  status: "active" | "completed" | "cancelled";
  ownerAddress?: string;
  operatorAddress?: string;
  vaultId?: number;
  desiredBorrowWei?: string;
  selectedCollaterals: { asset: string; amountWei: string }[];
  messages: { id: string; role: AssistantMessageRole; content: string; createdAt: Date }[];
  createdAt: Date;
  updatedAt: Date;
};

type AgentBindingDoc = {
  bindingId: string;
  sessionId?: string;
  owner: string;
  operator: string;
  vaultId: number;
  status: "prepared" | "bound" | "revoked";
  createdAt: Date;
  updatedAt: Date;
};

const zeroAddress = "0x0000000000000000000000000000000000000000";

function toSessionApi(doc: AssistantSessionDoc): AssistantSession {
  return {
    sessionId: doc.sessionId,
    mode: doc.mode,
    status: doc.status,
    ownerAddress: doc.ownerAddress as `0x${string}` | undefined,
    operatorAddress: doc.operatorAddress as `0x${string}` | undefined,
    vaultId: doc.vaultId,
    desiredBorrowWei: doc.desiredBorrowWei,
    selectedCollaterals: doc.selectedCollaterals.map((item) => ({
      asset: item.asset as `0x${string}`,
      amountWei: item.amountWei,
    })),
    messages: doc.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    })),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toBindingApi(doc: AgentBindingDoc): AgentBinding {
  return {
    bindingId: doc.bindingId,
    sessionId: doc.sessionId,
    owner: doc.owner as `0x${string}`,
    operator: doc.operator as `0x${string}`,
    vaultId: doc.vaultId,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function minBigInt(...values: bigint[]) {
  return values.reduce((min, value) => (value < min ? value : min));
}

function quoteBand(maxValue: bigint, bps: bigint) {
  return ((maxValue * bps) / 10_000n).toString();
}

export async function createAssistantSession(input: {
  mode: AssistantMode;
  ownerAddress?: `0x${string}`;
  operatorAddress?: `0x${string}`;
  vaultId?: number;
  desiredBorrowWei?: string;
  selectedCollaterals?: AssistantCollateralIntent[];
  initialMessage?: { role: AssistantMessageRole; content: string };
}): Promise<AssistantSession> {
  const db = getDb();
  const sessions = db.collection<AssistantSessionDoc>("assistant-sessions");

  const sessionId = randomUUID();
  const now = new Date();
  const messages: AssistantSessionDoc["messages"] = input.initialMessage
    ? [{ id: randomUUID(), role: input.initialMessage.role, content: input.initialMessage.content, createdAt: now }]
    : [];

  const doc: AssistantSessionDoc = {
    sessionId,
    mode: input.mode,
    status: "active",
    ownerAddress: input.ownerAddress?.toLowerCase(),
    operatorAddress: input.operatorAddress?.toLowerCase(),
    vaultId: input.vaultId,
    desiredBorrowWei: input.desiredBorrowWei,
    selectedCollaterals: (input.selectedCollaterals ?? []).map((item) => ({
      asset: item.asset.toLowerCase(),
      amountWei: item.amountWei,
    })),
    messages,
    createdAt: now,
    updatedAt: now,
  };

  await sessions.insertOne(doc);
  return toSessionApi(doc);
}

export async function getAssistantSession(sessionId: string): Promise<AssistantSession> {
  const db = getDb();
  const sessions = db.collection<AssistantSessionDoc>("assistant-sessions");
  const doc = await sessions.findOne({ sessionId });
  if (!doc) throw new HttpError(404, "session-not-found", "assistant session not found");
  return toSessionApi(doc);
}

export async function appendAssistantMessage(input: {
  sessionId: string;
  role: AssistantMessageRole;
  content: string;
  patch?: {
    ownerAddress?: `0x${string}`;
    operatorAddress?: `0x${string}`;
    vaultId?: number;
    desiredBorrowWei?: string;
    selectedCollaterals?: AssistantCollateralIntent[];
    status?: "active" | "completed" | "cancelled";
  };
}): Promise<AssistantSession> {
  const db = getDb();
  const sessions = db.collection<AssistantSessionDoc>("assistant-sessions");
  const now = new Date();

  const updateSet: Record<string, unknown> = {
    updatedAt: now,
  };

  if (input.patch?.ownerAddress !== undefined) updateSet.ownerAddress = input.patch.ownerAddress.toLowerCase();
  if (input.patch?.operatorAddress !== undefined) updateSet.operatorAddress = input.patch.operatorAddress.toLowerCase();
  if (input.patch?.vaultId !== undefined) updateSet.vaultId = input.patch.vaultId;
  if (input.patch?.desiredBorrowWei !== undefined) updateSet.desiredBorrowWei = input.patch.desiredBorrowWei;
  if (input.patch?.selectedCollaterals !== undefined) {
    updateSet.selectedCollaterals = input.patch.selectedCollaterals.map((item) => ({
      asset: item.asset.toLowerCase(),
      amountWei: item.amountWei,
    }));
  }
  if (input.patch?.status !== undefined) updateSet.status = input.patch.status;

  const result = await sessions.findOneAndUpdate(
    { sessionId: input.sessionId },
    {
      $set: updateSet,
      $push: {
        messages: {
          id: randomUUID(),
          role: input.role,
          content: input.content,
          createdAt: now,
        },
      },
    },
    { returnDocument: "after" }
  );

  if (!result) throw new HttpError(404, "session-not-found", "assistant session not found");
  return toSessionApi(result);
}

export async function generateOperatorWallet(sessionId?: string) {
  const privateKey = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  if (sessionId) {
    const db = getDb();
    const sessions = db.collection<AssistantSessionDoc>("assistant-sessions");
    await sessions.updateOne(
      { sessionId },
      { $set: { operatorAddress: account.address.toLowerCase(), updatedAt: new Date() } }
    );
  }

  return {
    address: account.address as `0x${string}`,
    privateKey,
  };
}

export async function getBorrowPreflightQuote(input: {
  owner?: `0x${string}`;
  vaultId?: number;
  collaterals: AssistantCollateralIntent[];
  desiredBorrowWei?: string;
}): Promise<BorrowPreflightQuote> {
  if (input.collaterals.length === 0) {
    throw new HttpError(400, "missing-collateral", "at least one collateral selection is required");
  }

  const [market, pool, existingVault] = await Promise.all([
    getMarketOverview(),
    getPoolSnapshot(),
    input.vaultId ? getVaultSummary(input.vaultId) : Promise.resolve(undefined),
  ]);

  if (existingVault && input.owner && existingVault.owner.toLowerCase() !== input.owner.toLowerCase()) {
    throw new HttpError(400, "vault-owner-mismatch", "vault owner does not match requested owner");
  }

  const collateralMap = new Map(market.collaterals.map((item) => [item.asset.address.toLowerCase(), item]));
  const owner = input.owner?.toLowerCase() as `0x${string}` | undefined;

  const requestedCollaterals = await Promise.all(
    input.collaterals.map(async (intent): Promise<PreflightCollateralQuote> => {
      const asset = collateralMap.get(intent.asset.toLowerCase());
      if (!asset) {
        throw new HttpError(400, "unsupported-collateral", `unsupported collateral: ${intent.asset}`);
      }
      if (!asset.config.enabled) {
        throw new HttpError(400, "collateral-disabled", `collateral disabled: ${intent.asset}`);
      }

      const requestedAmount = BigInt(intent.amountWei);
      const priceUsd = BigInt(asset.asset.priceUsd);
      const valueUsd = requestedAmount === 0n ? 0n : (requestedAmount * priceUsd) / (10n ** BigInt(asset.asset.decimals));
      const borrowCapacityUsd = (valueUsd * BigInt(asset.config.borrowLtvBps)) / 10_000n;
      const liquidationCapacityUsd = (valueUsd * BigInt(asset.config.liquidationThresholdBps)) / 10_000n;

      let walletBalanceWei: string | undefined;
      let withinWalletBalance: boolean | undefined;
      if (owner) {
        const balance = await publicClient.readContract({
          address: asset.asset.address,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [owner],
        });
        walletBalanceWei = balance.toString();
        withinWalletBalance = requestedAmount <= balance;
      }

      return {
        asset: asset.asset.address,
        symbol: asset.asset.symbol,
        decimals: asset.asset.decimals,
        requestedAmountWei: intent.amountWei,
        walletBalanceWei,
        withinWalletBalance,
        priceUsd: asset.asset.priceUsd,
        valueUsd: valueUsd.toString(),
        borrowCapacityUsd: borrowCapacityUsd.toString(),
        liquidationCapacityUsd: liquidationCapacityUsd.toString(),
        borrowLtvBps: asset.config.borrowLtvBps,
        liquidationThresholdBps: asset.config.liquidationThresholdBps,
      };
    })
  );

  const requestedCollateralValueUsd = requestedCollaterals.reduce((sum, item) => sum + BigInt(item.valueUsd), 0n);
  const requestedBorrowCapacityUsd = requestedCollaterals.reduce((sum, item) => sum + BigInt(item.borrowCapacityUsd), 0n);
  const requestedLiquidationCapacityUsd = requestedCollaterals.reduce((sum, item) => sum + BigInt(item.liquidationCapacityUsd), 0n);

  const existingDebtValueUsd = existingVault ? BigInt(existingVault.debtValueUsd) : 0n;
  const totalCollateralValueUsd = requestedCollateralValueUsd + BigInt(existingVault?.collateralValueUsd ?? "0");
  const totalBorrowCapacityUsd = requestedBorrowCapacityUsd + BigInt(existingVault?.borrowCapacityUsd ?? "0");
  const totalLiquidationCapacityUsd = requestedLiquidationCapacityUsd + BigInt(existingVault?.liquidationCapacityUsd ?? "0");

  const maxAdditionalBorrowUsd = totalBorrowCapacityUsd > existingDebtValueUsd ? totalBorrowCapacityUsd - existingDebtValueUsd : 0n;
  const debtAssetPriceUsd = BigInt(market.debtAsset.priceUsd);
  const maxAdditionalBorrowWeiByCollateral =
    debtAssetPriceUsd === 0n
      ? 0n
      : (maxAdditionalBorrowUsd * 10n ** BigInt(market.debtAsset.decimals)) / debtAssetPriceUsd;

  const poolAvailableLiquidityWei = BigInt(pool.availableLiquidityWei);
  const debtCapHeadroomWei =
    market.debtCapWei === "0"
      ? maxAdditionalBorrowWeiByCollateral
      : (() => {
          const cap = BigInt(market.debtCapWei);
          const totalDebt = BigInt(pool.totalDebtAssetsWei);
          return cap > totalDebt ? cap - totalDebt : 0n;
        })();

  const maxAdditionalBorrowWei = minBigInt(maxAdditionalBorrowWeiByCollateral, poolAvailableLiquidityWei, debtCapHeadroomWei);

  const desiredBorrow = input.desiredBorrowWei
    ? (() => {
        const amountWei = BigInt(input.desiredBorrowWei);
        const reasons: string[] = [];

        if (amountWei > maxAdditionalBorrowWei) reasons.push("requested borrow exceeds available quoted range");
        if (!existingVault && amountWei !== 0n && amountWei < BigInt(market.minBorrowAmountWei)) {
          reasons.push("requested borrow is below market minimum for a new debt position");
        }

        const resultingDebtWei = (existingVault ? BigInt(existingVault.debtWei) : 0n) + amountWei;
        if (resultingDebtWei !== 0n && resultingDebtWei < BigInt(market.minDebtAmountWei)) {
          reasons.push("resulting debt would be below the minimum debt amount");
        }

        const desiredDebtValueUsd =
          debtAssetPriceUsd === 0n ? 0n : (amountWei * debtAssetPriceUsd) / (10n ** BigInt(market.debtAsset.decimals));
        const projectedDebtValueUsd = existingDebtValueUsd + desiredDebtValueUsd;
        const projectedHealthFactorE18 =
          projectedDebtValueUsd === 0n ? undefined : ((totalLiquidationCapacityUsd * 10n ** 18n) / projectedDebtValueUsd).toString();

        return {
          amountWei: input.desiredBorrowWei,
          feasible: reasons.length === 0,
          projectedHealthFactorE18,
          reasons,
        };
      })()
    : undefined;

  return {
    owner: owner as `0x${string}` | undefined,
    vaultId: input.vaultId,
    debtAsset: market.debtAsset,
    existingVault: existingVault
      ? {
          owner: existingVault.owner,
          debtWei: existingVault.debtWei,
          debtValueUsd: existingVault.debtValueUsd,
          collateralValueUsd: existingVault.collateralValueUsd,
          borrowCapacityUsd: existingVault.borrowCapacityUsd,
          liquidationCapacityUsd: existingVault.liquidationCapacityUsd,
          healthFactorE18: existingVault.healthFactorE18,
        }
      : undefined,
    requestedCollaterals,
    totals: {
      requestedCollateralValueUsd: requestedCollateralValueUsd.toString(),
      totalCollateralValueUsd: totalCollateralValueUsd.toString(),
      totalBorrowCapacityUsd: totalBorrowCapacityUsd.toString(),
      totalLiquidationCapacityUsd: totalLiquidationCapacityUsd.toString(),
      currentDebtValueUsd: existingDebtValueUsd.toString(),
      maxAdditionalBorrowUsd: maxAdditionalBorrowUsd.toString(),
      maxAdditionalBorrowWei: maxAdditionalBorrowWei.toString(),
      poolAvailableLiquidityWei: pool.availableLiquidityWei,
      debtCapHeadroomWei: debtCapHeadroomWei.toString(),
    },
    suggestedRangeWei: {
      conservative: quoteBand(maxAdditionalBorrowWei, 5_000n),
      balanced: quoteBand(maxAdditionalBorrowWei, 7_000n),
      aggressive: quoteBand(maxAdditionalBorrowWei, 8_500n),
    },
    desiredBorrow,
  };
}

export async function prepareOperatorBinding(input: {
  sessionId?: string;
  vaultId: number;
  operator: `0x${string}`;
  allowed?: boolean;
}) {
  const vault = await publicClient.readContract({
    address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
    abi: vaultManagerAbi,
    functionName: "vaults",
    args: [BigInt(input.vaultId)],
  });

  const owner = vault[0];
  if (owner === zeroAddress) {
    throw new HttpError(404, "vault-not-found", "vault not found");
  }

  const allowed = input.allowed ?? true;
  const currentlyBound = await publicClient.readContract({
    address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
    abi: vaultManagerAbi,
    functionName: "vaultOperators",
    args: [BigInt(input.vaultId), input.operator],
  });

  const bindingId = randomUUID();
  const db = getDb();
  const bindings = db.collection<AgentBindingDoc>("agent-bindings");
  const now = new Date();

  const doc: AgentBindingDoc = {
    bindingId,
    sessionId: input.sessionId,
    owner: owner.toLowerCase(),
    operator: input.operator.toLowerCase(),
    vaultId: input.vaultId,
    status: currentlyBound && allowed ? "bound" : "prepared",
    createdAt: now,
    updatedAt: now,
  };

  await bindings.insertOne(doc);

  if (input.sessionId) {
    const sessions = db.collection<AssistantSessionDoc>("assistant-sessions");
    await sessions.updateOne(
      { sessionId: input.sessionId },
      {
        $set: {
          ownerAddress: owner.toLowerCase(),
          operatorAddress: input.operator.toLowerCase(),
          vaultId: input.vaultId,
          updatedAt: now,
        },
      }
    );
  }

  return {
    binding: toBindingApi(doc),
    currentlyBound,
    transaction: {
      to: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
      valueWei: "0",
      data: encodeFunctionData({
        abi: vaultManagerAbi,
        functionName: "setVaultOperator",
        args: [BigInt(input.vaultId), input.operator, allowed],
      }),
    },
  };
}

export async function confirmOperatorBinding(input: { bindingId?: string; vaultId: number; operator: `0x${string}` }) {
  const db = getDb();
  const bindings = db.collection<AgentBindingDoc>("agent-bindings");

  const bound = await publicClient.readContract({
    address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
    abi: vaultManagerAbi,
    functionName: "vaultOperators",
    args: [BigInt(input.vaultId), input.operator],
  });

  const vault = await publicClient.readContract({
    address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
    abi: vaultManagerAbi,
    functionName: "vaults",
    args: [BigInt(input.vaultId)],
  });

  const owner = vault[0];
  if (owner === zeroAddress) {
    throw new HttpError(404, "vault-not-found", "vault not found");
  }

  const now = new Date();
  let doc: AgentBindingDoc | null = null;

  if (input.bindingId) {
    await bindings.updateOne(
      { bindingId: input.bindingId },
      {
        $set: {
          owner: owner.toLowerCase(),
          operator: input.operator.toLowerCase(),
          vaultId: input.vaultId,
          status: bound ? "bound" : "prepared",
          updatedAt: now,
        },
      }
    );
    doc = await bindings.findOne({ bindingId: input.bindingId });
  } else {
    doc = await bindings.findOne({ vaultId: input.vaultId, operator: input.operator.toLowerCase() });
    if (!doc) {
      doc = {
        bindingId: randomUUID(),
        owner: owner.toLowerCase(),
        operator: input.operator.toLowerCase(),
        vaultId: input.vaultId,
        status: bound ? "bound" : "prepared",
        createdAt: now,
        updatedAt: now,
      };
      await bindings.insertOne(doc);
    } else {
      await bindings.updateOne(
        { bindingId: doc.bindingId },
        { $set: { status: bound ? "bound" : "prepared", updatedAt: now } }
      );
      doc = await bindings.findOne({ bindingId: doc.bindingId });
    }
  }

  if (!doc) {
    throw new HttpError(500, "binding-state-error", "binding state could not be loaded");
  }

  return {
    binding: toBindingApi(doc),
    bound,
  };
}
