import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  appendAssistantMessage,
  confirmOperatorBinding,
  createAssistantSession,
  generateOperatorWallet,
  getAssistantSession,
  getBorrowPreflightQuote,
  prepareOperatorBinding,
} from "@/features/assistant/assistant.service.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const amountSchema = z.string().regex(/^\d+$/);

const collateralIntentSchema = z.object({
  asset: addressSchema,
  amountWei: amountSchema,
});

const createSessionBodySchema = z.object({
  mode: z.enum(["human", "agent"]),
  ownerAddress: addressSchema.optional(),
  operatorAddress: addressSchema.optional(),
  vaultId: z.number().int().positive().optional(),
  desiredBorrowWei: amountSchema.optional(),
  selectedCollaterals: z.array(collateralIntentSchema).optional(),
  initialMessage: z
    .object({
      role: z.enum(["system", "assistant", "user"]),
      content: z.string().min(1),
    })
    .optional(),
});

export async function createSession(request: FastifyRequest, reply: FastifyReply) {
  const body = createSessionBodySchema.parse(request.body);
  const data = await createAssistantSession({
    mode: body.mode,
    ownerAddress: body.ownerAddress as `0x${string}` | undefined,
    operatorAddress: body.operatorAddress as `0x${string}` | undefined,
    vaultId: body.vaultId,
    desiredBorrowWei: body.desiredBorrowWei,
    selectedCollaterals: body.selectedCollaterals as { asset: `0x${string}`; amountWei: string }[] | undefined,
    initialMessage: body.initialMessage,
  });
  return reply.send({ ok: true, data });
}

const sessionParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export async function getSession(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = sessionParamsSchema.parse(request.params);
  const data = await getAssistantSession(sessionId);
  return reply.send({ ok: true, data });
}

const appendMessageBodySchema = z.object({
  role: z.enum(["system", "assistant", "user"]),
  content: z.string().min(1),
  patch: z
    .object({
      ownerAddress: addressSchema.optional(),
      operatorAddress: addressSchema.optional(),
      vaultId: z.number().int().positive().optional(),
      desiredBorrowWei: amountSchema.optional(),
      selectedCollaterals: z.array(collateralIntentSchema).optional(),
      status: z.enum(["active", "completed", "cancelled"]).optional(),
    })
    .optional(),
});

export async function addSessionMessage(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = sessionParamsSchema.parse(request.params);
  const body = appendMessageBodySchema.parse(request.body);
  const data = await appendAssistantMessage({
    sessionId,
    role: body.role,
    content: body.content,
    patch: body.patch
      ? {
          ownerAddress: body.patch.ownerAddress as `0x${string}` | undefined,
          operatorAddress: body.patch.operatorAddress as `0x${string}` | undefined,
          vaultId: body.patch.vaultId,
          desiredBorrowWei: body.patch.desiredBorrowWei,
          selectedCollaterals: body.patch.selectedCollaterals as { asset: `0x${string}`; amountWei: string }[] | undefined,
          status: body.patch.status,
        }
      : undefined,
  });
  return reply.send({ ok: true, data });
}

const preflightQuoteBodySchema = z.object({
  owner: addressSchema.optional(),
  vaultId: z.number().int().positive().optional(),
  collaterals: z.array(collateralIntentSchema).min(1),
  desiredBorrowWei: amountSchema.optional(),
});

export async function getPreflightQuote(request: FastifyRequest, reply: FastifyReply) {
  const body = preflightQuoteBodySchema.parse(request.body);
  const data = await getBorrowPreflightQuote({
    owner: body.owner as `0x${string}` | undefined,
    vaultId: body.vaultId,
    collaterals: body.collaterals as { asset: `0x${string}`; amountWei: string }[],
    desiredBorrowWei: body.desiredBorrowWei,
  });
  return reply.send({ ok: true, data });
}

const operatorWalletBodySchema = z.object({
  sessionId: z.string().uuid().optional(),
});

export async function createOperatorWallet(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = operatorWalletBodySchema.parse(request.body);
  const data = await generateOperatorWallet(sessionId);
  return reply.send({ ok: true, data });
}

const prepareBindingBodySchema = z.object({
  sessionId: z.string().uuid().optional(),
  vaultId: z.number().int().positive(),
  operator: addressSchema,
  allowed: z.boolean().optional(),
});

export async function prepareBinding(request: FastifyRequest, reply: FastifyReply) {
  const body = prepareBindingBodySchema.parse(request.body);
  const data = await prepareOperatorBinding({
    sessionId: body.sessionId,
    vaultId: body.vaultId,
    operator: body.operator as `0x${string}`,
    allowed: body.allowed,
  });
  return reply.send({ ok: true, data });
}

const confirmBindingBodySchema = z.object({
  bindingId: z.string().uuid().optional(),
  vaultId: z.number().int().positive(),
  operator: addressSchema,
});

export async function confirmBinding(request: FastifyRequest, reply: FastifyReply) {
  const body = confirmBindingBodySchema.parse(request.body);
  const data = await confirmOperatorBinding({
    bindingId: body.bindingId,
    vaultId: body.vaultId,
    operator: body.operator as `0x${string}`,
  });
  return reply.send({ ok: true, data });
}
