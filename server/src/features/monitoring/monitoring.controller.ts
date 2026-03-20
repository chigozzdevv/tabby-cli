import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getMarketOverview, getVaultSummary, listVaultsByOwner } from "@/features/monitoring/monitoring.service.js";

export async function getMarket(_request: FastifyRequest, reply: FastifyReply) {
  const data = await getMarketOverview();
  return reply.send({ ok: true, data });
}

const ownerVaultsQuerySchema = z.object({
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function getVaultsByOwner(request: FastifyRequest, reply: FastifyReply) {
  const query = ownerVaultsQuerySchema.parse(request.query);
  const data = await listVaultsByOwner(query);
  return reply.send({ ok: true, data });
}

const vaultIdParamsSchema = z.object({
  vaultId: z.coerce.number().int().positive(),
});

export async function getVaultById(request: FastifyRequest, reply: FastifyReply) {
  const { vaultId } = vaultIdParamsSchema.parse(request.params);
  const data = await getVaultSummary(vaultId);
  return reply.send({ ok: true, data });
}
