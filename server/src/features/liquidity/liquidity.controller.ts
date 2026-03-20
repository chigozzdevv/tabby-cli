import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getLpPosition, getPoolSnapshot, quoteDeposit, quoteWithdraw } from "@/features/liquidity/liquidity.service.js";

export async function getPool(_request: FastifyRequest, reply: FastifyReply) {
  const data = await getPoolSnapshot();
  return reply.send({ ok: true, data });
}

const positionQuerySchema = z.object({
  account: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function getLpPositionByAccount(request: FastifyRequest, reply: FastifyReply) {
  const { account } = positionQuerySchema.parse(request.query);
  const data = await getLpPosition(account as `0x${string}`);
  return reply.send({ ok: true, data });
}

const depositQuoteSchema = z.object({
  assetsWei: z.string().regex(/^\d+$/),
});

export async function getDepositQuote(request: FastifyRequest, reply: FastifyReply) {
  const { assetsWei } = depositQuoteSchema.parse(request.query);
  const data = await quoteDeposit(BigInt(assetsWei));
  return reply.send({ ok: true, data });
}

const withdrawQuoteSchema = z.object({
  shares: z.string().regex(/^\d+$/),
});

export async function getWithdrawQuote(request: FastifyRequest, reply: FastifyReply) {
  const { shares } = withdrawQuoteSchema.parse(request.query);
  const data = await quoteWithdraw(BigInt(shares));
  return reply.send({ ok: true, data });
}
