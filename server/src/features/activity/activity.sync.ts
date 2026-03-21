import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { publicClient } from "@/shared/viem.js";
import { debtPoolAbi, vaultManagerAbi } from "@/shared/protocol.js";
import { getActivityCursor, recordActivityEvent, setActivityCursor } from "@/features/activity/activity.service.js";
import type { FastifyInstance } from "fastify";

const poolCursorKey = "debt-pool";
const vaultCursorKey = "vault-manager";

function compareLogs(a: { log: { blockNumber: bigint; logIndex: number } }, b: { log: { blockNumber: bigint; logIndex: number } }) {
  if (a.log.blockNumber === b.log.blockNumber) return a.log.logIndex - b.log.logIndex;
  return a.log.blockNumber < b.log.blockNumber ? -1 : 1;
}

async function getSyncWindow(key: string) {
  const latest = await publicClient.getBlockNumber();
  const confirmations = BigInt(env.ACTIVITY_CONFIRMATIONS);
  const safeToBlock = latest > confirmations ? latest - confirmations : 0n;

  const cursor = await getActivityCursor(key);
  const fromBlock = cursor
    ? BigInt(cursor.lastProcessedBlock + 1)
    : env.ACTIVITY_START_BLOCK !== undefined
      ? BigInt(env.ACTIVITY_START_BLOCK)
      : safeToBlock;

  if (fromBlock > safeToBlock) return null;

  return {
    fromBlock,
    toBlock: safeToBlock,
    chunkSize: BigInt(env.ACTIVITY_CHUNK_SIZE),
  };
}

async function fetchBlockTimestamps(blockNumbers: bigint[]) {
  const unique = Array.from(new Set(blockNumbers.map((value) => value.toString()))).map((value) => BigInt(value));
  const blocks = await Promise.all(unique.map((blockNumber) => publicClient.getBlock({ blockNumber })));
  const timestamps = new Map<string, Date>();
  for (let i = 0; i < unique.length; i += 1) {
    timestamps.set(unique[i]!.toString(), new Date(Number(blocks[i]!.timestamp) * 1000));
  }
  return timestamps;
}

async function getVaultOwners(vaultIds: number[]): Promise<Map<number, string>> {
  const ids = Array.from(new Set(vaultIds.filter((vaultId) => Number.isInteger(vaultId) && vaultId > 0)));
  const entries = await Promise.all(
    ids.map(async (vaultId) => {
      const vault = await publicClient.readContract({
        address: env.VAULT_MANAGER_ADDRESS as `0x${string}`,
        abi: vaultManagerAbi,
        functionName: "vaults",
        args: [BigInt(vaultId)],
      });
      return [vaultId, vault[0].toLowerCase()] as const;
    })
  );

  return new Map(entries);
}

async function syncDebtPoolActivityOnce() {
  const window = await getSyncWindow(poolCursorKey);
  if (!window) return;

  const debtPool = env.DEBT_POOL_ADDRESS as `0x${string}`;

  for (let start = window.fromBlock; start <= window.toBlock; start += window.chunkSize) {
    const end = start + window.chunkSize - 1n > window.toBlock ? window.toBlock : start + window.chunkSize - 1n;

    const [depositedLogs, withdrawnLogs] = await Promise.all([
      publicClient.getContractEvents({
        address: debtPool,
        abi: debtPoolAbi,
        eventName: "Deposited",
        fromBlock: start,
        toBlock: end,
      }),
      publicClient.getContractEvents({
        address: debtPool,
        abi: debtPoolAbi,
        eventName: "Withdrawn",
        fromBlock: start,
        toBlock: end,
      }),
    ]);

    type DepositedLog = (typeof depositedLogs)[number];
    type WithdrawnLog = (typeof withdrawnLogs)[number];
    type PoolLog = { kind: "deposited"; log: DepositedLog } | { kind: "withdrawn"; log: WithdrawnLog };

    const allLogs: PoolLog[] = [
      ...depositedLogs.map((log) => ({ kind: "deposited" as const, log })),
      ...withdrawnLogs.map((log) => ({ kind: "withdrawn" as const, log })),
    ].sort(compareLogs);

    if (allLogs.length === 0) {
      await setActivityCursor(poolCursorKey, Number(end));
      continue;
    }

    const blockTimestamps = await fetchBlockTimestamps(allLogs.map((entry) => entry.log.blockNumber));

    for (const item of allLogs) {
      const txHash = item.log.transactionHash;
      const blockNumber = Number(item.log.blockNumber);
      const logIndex = Number(item.log.logIndex);
      const createdAt = blockTimestamps.get(item.log.blockNumber.toString()) ?? new Date();
      const account = item.log.args.account?.toLowerCase();
      if (!account || item.log.args.assets === undefined || item.log.args.shares === undefined) continue;

      const event = await recordActivityEvent({
        type: item.kind === "deposited" ? "lp.deposited" : "lp.withdrawn",
        dedupeKey: `${item.kind === "deposited" ? "lp.deposited" : "lp.withdrawn"}:${txHash}:${logIndex}`,
        owner: account,
        account,
        txHash,
        blockNumber,
        logIndex,
        payload: {
          assetsWei: item.log.args.assets.toString(),
          shares: item.log.args.shares.toString(),
        },
        createdAt,
      });

      if (globalApp?.io) {
        globalApp.io.emit("new-activity", event);
      }
    }

    await setActivityCursor(poolCursorKey, Number(end));
  }
}

async function syncVaultActivityOnce() {
  const window = await getSyncWindow(vaultCursorKey);
  if (!window) return;

  const vaultManager = env.VAULT_MANAGER_ADDRESS as `0x${string}`;

  for (let start = window.fromBlock; start <= window.toBlock; start += window.chunkSize) {
    const end = start + window.chunkSize - 1n > window.toBlock ? window.toBlock : start + window.chunkSize - 1n;

    const [openedLogs, operatorLogs, depositedLogs, withdrawnLogs, borrowedLogs, repaidLogs, liquidatedLogs, badDebtLogs] =
      await Promise.all([
        publicClient.getContractEvents({
          address: vaultManager,
          abi: vaultManagerAbi,
          eventName: "VaultOpened",
          fromBlock: start,
          toBlock: end,
        }),
        publicClient.getContractEvents({
          address: vaultManager,
          abi: vaultManagerAbi,
          eventName: "VaultOperatorUpdated",
          fromBlock: start,
          toBlock: end,
        }),
        publicClient.getContractEvents({
          address: vaultManager,
          abi: vaultManagerAbi,
          eventName: "CollateralDeposited",
          fromBlock: start,
          toBlock: end,
        }),
        publicClient.getContractEvents({
          address: vaultManager,
          abi: vaultManagerAbi,
          eventName: "CollateralWithdrawn",
          fromBlock: start,
          toBlock: end,
        }),
        publicClient.getContractEvents({
          address: vaultManager,
          abi: vaultManagerAbi,
          eventName: "Borrowed",
          fromBlock: start,
          toBlock: end,
        }),
        publicClient.getContractEvents({
          address: vaultManager,
          abi: vaultManagerAbi,
          eventName: "Repaid",
          fromBlock: start,
          toBlock: end,
        }),
        publicClient.getContractEvents({
          address: vaultManager,
          abi: vaultManagerAbi,
          eventName: "Liquidated",
          fromBlock: start,
          toBlock: end,
        }),
        publicClient.getContractEvents({
          address: vaultManager,
          abi: vaultManagerAbi,
          eventName: "BadDebtResolved",
          fromBlock: start,
          toBlock: end,
        }),
      ]);

    type OpenedLog = (typeof openedLogs)[number];
    type OperatorLog = (typeof operatorLogs)[number];
    type DepositedLog = (typeof depositedLogs)[number];
    type WithdrawnLog = (typeof withdrawnLogs)[number];
    type BorrowedLog = (typeof borrowedLogs)[number];
    type RepaidLog = (typeof repaidLogs)[number];
    type LiquidatedLog = (typeof liquidatedLogs)[number];
    type BadDebtLog = (typeof badDebtLogs)[number];

    type VaultLog =
      | { kind: "opened"; log: OpenedLog }
      | { kind: "operator"; log: OperatorLog }
      | { kind: "collateral-deposited"; log: DepositedLog }
      | { kind: "collateral-withdrawn"; log: WithdrawnLog }
      | { kind: "borrowed"; log: BorrowedLog }
      | { kind: "repaid"; log: RepaidLog }
      | { kind: "liquidated"; log: LiquidatedLog }
      | { kind: "bad-debt"; log: BadDebtLog };

    const allLogs: VaultLog[] = [
      ...openedLogs.map((log) => ({ kind: "opened" as const, log })),
      ...operatorLogs.map((log) => ({ kind: "operator" as const, log })),
      ...depositedLogs.map((log) => ({ kind: "collateral-deposited" as const, log })),
      ...withdrawnLogs.map((log) => ({ kind: "collateral-withdrawn" as const, log })),
      ...borrowedLogs.map((log) => ({ kind: "borrowed" as const, log })),
      ...repaidLogs.map((log) => ({ kind: "repaid" as const, log })),
      ...liquidatedLogs.map((log) => ({ kind: "liquidated" as const, log })),
      ...badDebtLogs.map((log) => ({ kind: "bad-debt" as const, log })),
    ].sort(compareLogs);

    if (allLogs.length === 0) {
      await setActivityCursor(vaultCursorKey, Number(end));
      continue;
    }

    const blockTimestamps = await fetchBlockTimestamps(allLogs.map((entry) => entry.log.blockNumber));
    const ownerMap = await getVaultOwners(
      allLogs
        .map((entry) => entry.log.args.vaultId)
        .filter((value): value is bigint => value !== undefined)
        .map((value) => Number(value))
    );

    for (const item of allLogs) {
      const txHash = item.log.transactionHash;
      const blockNumber = Number(item.log.blockNumber);
      const logIndex = Number(item.log.logIndex);
      const createdAt = blockTimestamps.get(item.log.blockNumber.toString()) ?? new Date();
      const vaultIdRaw = item.log.args.vaultId;
      if (vaultIdRaw === undefined) continue;
      const vaultId = Number(vaultIdRaw);
      const owner = ownerMap.get(vaultId);

      if (item.kind === "opened") {
        const eventOwner = item.log.args.owner?.toLowerCase();
        if (!eventOwner) continue;
        const event = await recordActivityEvent({
          type: "vault.opened",
          dedupeKey: `vault.opened:${txHash}:${logIndex}`,
          owner: eventOwner,
          account: eventOwner,
          vaultId,
          txHash,
          blockNumber,
          logIndex,
          payload: { owner: eventOwner },
          createdAt,
        });

        if (globalApp?.io) {
          globalApp.io.emit("new-activity", event);
        }
        continue;
      }

      if (item.kind === "operator") {
        const operator = item.log.args.operator?.toLowerCase();
        if (!owner || !operator || item.log.args.allowed === undefined) continue;
        const event = await recordActivityEvent({
          type: "vault.operator-updated",
          dedupeKey: `vault.operator-updated:${txHash}:${logIndex}`,
          owner,
          account: operator,
          vaultId,
          txHash,
          blockNumber,
          logIndex,
          payload: {
            operator,
            allowed: item.log.args.allowed,
          },
          createdAt,
        });

        if (globalApp?.io) {
          globalApp.io.emit("new-activity", event);
        }
        continue;
      }

      if (item.kind === "collateral-deposited") {
        if (!owner || item.log.args.asset === undefined || item.log.args.amount === undefined) continue;
        const event = await recordActivityEvent({
          type: "collateral.deposited",
          dedupeKey: `collateral.deposited:${txHash}:${logIndex}`,
          owner,
          vaultId,
          txHash,
          blockNumber,
          logIndex,
          payload: {
            asset: item.log.args.asset,
            amountWei: item.log.args.amount.toString(),
          },
          createdAt,
        });

        if (globalApp?.io) {
          globalApp.io.emit("new-activity", event);
        }
        continue;
      }

      if (item.kind === "collateral-withdrawn") {
        if (!owner || item.log.args.asset === undefined || item.log.args.amount === undefined || item.log.args.to === undefined) continue;
        const event = await recordActivityEvent({
          type: "collateral.withdrawn",
          dedupeKey: `collateral.withdrawn:${txHash}:${logIndex}`,
          owner,
          account: item.log.args.to.toLowerCase(),
          vaultId,
          txHash,
          blockNumber,
          logIndex,
          payload: {
            asset: item.log.args.asset,
            amountWei: item.log.args.amount.toString(),
            to: item.log.args.to,
          },
          createdAt,
        });

        if (globalApp?.io) {
          globalApp.io.emit("new-activity", event);
        }
        continue;
      }

      if (item.kind === "borrowed") {
        const eventOwner = item.log.args.owner?.toLowerCase();
        const receiver = item.log.args.receiver?.toLowerCase();
        if (!eventOwner || !receiver || item.log.args.amount === undefined || item.log.args.normalizedDebtAdded === undefined || item.log.args.borrowRateBps === undefined) {
          continue;
        }
        const event = await recordActivityEvent({
          type: "debt.borrowed",
          dedupeKey: `debt.borrowed:${txHash}:${logIndex}`,
          owner: eventOwner,
          account: receiver,
          vaultId,
          txHash,
          blockNumber,
          logIndex,
          payload: {
            receiver,
            amountWei: item.log.args.amount.toString(),
            normalizedDebtAdded: item.log.args.normalizedDebtAdded.toString(),
            borrowRateBps: Number(item.log.args.borrowRateBps),
          },
          createdAt,
        });

        if (globalApp?.io) {
          globalApp.io.emit("new-activity", event);
        }
        continue;
      }

      if (item.kind === "repaid") {
        const payer = item.log.args.payer?.toLowerCase();
        if (!owner || !payer || item.log.args.amount === undefined || item.log.args.normalizedDebtRepaid === undefined || item.log.args.remainingDebt === undefined) {
          continue;
        }
        const event = await recordActivityEvent({
          type: "debt.repaid",
          dedupeKey: `debt.repaid:${txHash}:${logIndex}`,
          owner,
          account: payer,
          vaultId,
          txHash,
          blockNumber,
          logIndex,
          payload: {
            payer,
            amountWei: item.log.args.amount.toString(),
            normalizedDebtRepaid: item.log.args.normalizedDebtRepaid.toString(),
            remainingDebtWei: item.log.args.remainingDebt.toString(),
          },
          createdAt,
        });

        if (globalApp?.io) {
          globalApp.io.emit("new-activity", event);
        }
        continue;
      }

      if (item.kind === "liquidated") {
        const liquidator = item.log.args.liquidator?.toLowerCase();
        if (!owner || !liquidator || item.log.args.collateralAsset === undefined || item.log.args.repaidDebt === undefined || item.log.args.normalizedDebtRepaid === undefined || item.log.args.seizedCollateral === undefined || item.log.args.remainingDebt === undefined) {
          continue;
        }
        const event = await recordActivityEvent({
          type: "vault.liquidated",
          dedupeKey: `vault.liquidated:${txHash}:${logIndex}`,
          owner,
          account: liquidator,
          vaultId,
          txHash,
          blockNumber,
          logIndex,
          payload: {
            liquidator,
            collateralAsset: item.log.args.collateralAsset,
            repaidDebtWei: item.log.args.repaidDebt.toString(),
            normalizedDebtRepaid: item.log.args.normalizedDebtRepaid.toString(),
            seizedCollateralWei: item.log.args.seizedCollateral.toString(),
            remainingDebtWei: item.log.args.remainingDebt.toString(),
          },
          createdAt,
        });

        if (globalApp?.io) {
          globalApp.io.emit("new-activity", event);
        }
        continue;
      }

      const resolver = item.log.args.resolver?.toLowerCase();
      const collateralReceiver = item.log.args.collateralReceiver?.toLowerCase();
      if (!owner || !resolver || !collateralReceiver || item.log.args.writtenOffDebt === undefined || item.log.args.normalizedDebtWrittenOff === undefined) {
        continue;
      }
      const event = await recordActivityEvent({
        type: "vault.bad-debt-resolved",
        dedupeKey: `vault.bad-debt-resolved:${txHash}:${logIndex}`,
        owner,
        account: resolver,
        vaultId,
        txHash,
        blockNumber,
        logIndex,
        payload: {
          resolver,
          collateralReceiver,
          writtenOffDebtWei: item.log.args.writtenOffDebt.toString(),
          normalizedDebtWrittenOff: item.log.args.normalizedDebtWrittenOff.toString(),
        },
        createdAt,
      });

      if (globalApp?.io) {
        globalApp.io.emit("new-activity", event);
      }
    }

    await setActivityCursor(vaultCursorKey, Number(end));
  }
}

let started = false;
let timer: NodeJS.Timeout | null = null;

async function syncLoop() {
  try {
    await syncDebtPoolActivityOnce();
    await syncVaultActivityOnce();
  } catch (error) {
    logger.error({ error }, "activity-sync-failed");
  } finally {
    timer = setTimeout(syncLoop, env.ACTIVITY_POLL_INTERVAL_MS);
  }
}

let globalApp: FastifyInstance | null = null;

export function startActivitySync(app: FastifyInstance) {
  if (started || !env.ACTIVITY_SYNC_ENABLED) return;
  globalApp = app;
  started = true;
  void syncLoop();
}

export function stopActivitySync() {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}
