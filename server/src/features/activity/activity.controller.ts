import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { listActivityEvents } from "@/features/activity/activity.service.js";

const activityQuerySchema = z.object({
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  account: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  vaultId: z.coerce.number().int().positive().optional(),
  type: z
    .enum([
      "lp.deposited",
      "lp.withdrawn",
      "vault.opened",
      "vault.operator-updated",
      "collateral.deposited",
      "collateral.withdrawn",
      "debt.borrowed",
      "debt.repaid",
      "vault.liquidated",
      "vault.bad-debt-resolved",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

export async function getActivity(request: FastifyRequest, reply: FastifyReply) {
  const query = activityQuerySchema.parse(request.query);
  const data = await listActivityEvents(query);
  return reply.send({ ok: true, data });
}

export async function getPublicActivity(request: FastifyRequest, reply: FastifyReply) {
  const query = activityQuerySchema.parse(request.query);
  const data = await listActivityEvents(query);
  return reply.send({ ok: true, data });
}
