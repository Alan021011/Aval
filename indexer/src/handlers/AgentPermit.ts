import { indexer } from "envio";
import type { EvmOnEventContext as HandlerContext } from "envio";
import { recomputeScore } from "../recompute";

const TIMESTAMP = { block: ["timestamp"] } as const;

indexer.onEvent({ contract: "AgentPermit", event: "PermitGranted", fields: TIMESTAMP }, async ({ event, context }) => {
  const { permitId, owner, agent, agentId, terms } = event.params;
  // terms = (agent, agentId, token, maxPerSpend, maxTotal, approvalThreshold, expiresAt)
  context.Permit.set({
    id: permitId.toString(),
    owner,
    agent,
    agentId,
    token: terms[2],
    maxPerSpend: BigInt(terms[3]),
    maxTotal: BigInt(terms[4]),
    approvalThreshold: BigInt(terms[5]),
    expiresAt: BigInt(terms[6]),
    spent: 0n,
    status: "Active",
    createdAt: BigInt(event.block.timestamp),
    revokedAt: undefined,
  });
});

indexer.onEvent({ contract: "AgentPermit", event: "PermitRevoked", fields: TIMESTAMP }, async ({ event, context }) => {
  const permit = await context.Permit.get(event.params.permitId.toString());
  if (!permit) return;
  context.Permit.set({ ...permit, status: "Revoked", revokedAt: BigInt(event.block.timestamp) });
});

indexer.onEvent({ contract: "AgentPermit", event: "SpendRequested", fields: TIMESTAMP }, async ({ event, context }) => {
  const { requestId, permitId, owner, to, amount, ref } = event.params;
  context.SpendRequest.set({
    id: requestId.toString(),
    permit_id: permitId.toString(),
    owner,
    payee: to,
    amount,
    ref,
    status: "Pending",
    createdAt: BigInt(event.block.timestamp),
    executedAt: undefined,
  });
});

indexer.onEvent({ contract: "AgentPermit", event: "Spent", fields: TIMESTAMP }, async ({ event, context }) => {
  const { permitId, agent, to: payee, owner, token, amount, ref, requestId } = event.params;
  const now = BigInt(event.block.timestamp);

  context.Payment.set({
    id: `${event.block.number}_${event.logIndex}`,
    permit_id: permitId.toString(),
    owner,
    agent,
    payee,
    token,
    amount,
    ref,
    requestId,
    approvedByUser: requestId > 0n,
    timestamp: now,
  });

  const permit = await context.Permit.get(permitId.toString());
  if (permit) context.Permit.set({ ...permit, spent: permit.spent + amount });

  if (requestId > 0n) {
    const request = await context.SpendRequest.get(requestId.toString());
    if (request) context.SpendRequest.set({ ...request, status: "Executed", executedAt: now });
  }

  // Igual que AgentPermit: tanto el dueño del permiso como su agente quedan como pagadores de este servicio.
  const ownerRelated = await isRelated(context, owner, payee);
  await recordRelation(context, { payee, client: owner, owner, amount, now, related: ownerRelated });
  await recordRelation(context, {
    payee,
    client: agent,
    owner,
    amount,
    now,
    related: ownerRelated || (await isRelated(context, agent, payee)),
  });

  // Este pago puede cambiar quién cuenta como cliente de los agentes que cobran en esta billetera.
  for (const registered of await context.Agent.getWhere({ wallet: { _eq: payee } })) {
    await recomputeScore(context, registered.agentId, payee, now);
  }
});

/** El servicio es la misma cuenta, o fue quien fondeó primero a esta cuenta: señal de autopago. */
async function isRelated(context: HandlerContext, account: string, payee: string): Promise<boolean> {
  if (account === payee) return true;
  const known = await context.Account.get(account);
  return known?.firstFundedBy === payee;
}

async function recordRelation(
  context: HandlerContext,
  args: { payee: string; client: string; owner: string; amount: bigint; now: bigint; related: boolean },
): Promise<void> {
  const id = `${args.payee}_${args.client}`;
  const existing = await context.PaidRelation.get(id);
  context.PaidRelation.set({
    id,
    payee: args.payee,
    client: args.client,
    owner: args.owner,
    totalPaid: (existing?.totalPaid ?? 0n) + args.amount,
    paymentCount: (existing?.paymentCount ?? 0) + 1,
    firstPaidAt: existing?.firstPaidAt ?? args.now,
    lastPaidAt: args.now,
    // Una vez relacionado, siempre relacionado.
    relatedToPayee: (existing?.relatedToPayee ?? false) || args.related,
  });
}
