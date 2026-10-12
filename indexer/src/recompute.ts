import type { EvmOnEventContext as HandlerContext } from "envio";
import { SCORE_PARAMS, ZERO_ADDRESS } from "./constants";
import { computeScore } from "./score";

/**
 * Recalcula y guarda el puntaje verificado de un agente desde cero con lo que hay en la base.
 * Se llama cuando llega una reseña del agente o un pago a su billetera. Recalcular completo (en vez de sumar) es lo
 * que deja el puntaje correcto aunque los pagos y las reseñas lleguen en cualquier orden.
 */
export async function recomputeScore(
  context: HandlerContext,
  agentId: bigint,
  agentWallet: string | undefined,
  now: bigint,
): Promise<void> {
  const wallet = agentWallet && agentWallet !== ZERO_ADDRESS ? agentWallet : undefined;

  const feedbacks = await context.Feedback.getWhere({ agentId: { _eq: agentId } });
  const relations = wallet ? await context.PaidRelation.getWhere({ payee: { _eq: wallet } }) : [];

  const result = computeScore(
    feedbacks.map((f) => ({
      client: f.client,
      feedbackIndex: f.feedbackIndex,
      value: f.value,
      decimals: f.decimals,
      createdAt: f.createdAt,
    })),
    relations.map((r) => ({ client: r.client, owner: r.owner, totalPaid: r.totalPaid, relatedToPayee: r.relatedToPayee })),
    SCORE_PARAMS,
  );

  context.AgentScore.set({
    id: agentId.toString(),
    agentId,
    wallet,
    status: result.status,
    verifiedAverage: result.verifiedAverage ?? undefined,
    verifiedHumans: result.verifiedHumans,
    totalFeedbackCount: result.totalFeedbackCount,
    rawAverage: result.rawAverage ?? undefined,
    excludedNotPaid: result.excludedNotPaid,
    excludedBelowMinPaid: result.excludedBelowMinPaid,
    excludedRelated: result.excludedRelated,
    topClientShare: result.topClientShare ?? undefined,
    payingHumans: result.payingHumans,
    totalPaid: result.totalPaid,
    minPaid: SCORE_PARAMS.minPaid,
    minHumans: SCORE_PARAMS.minHumans,
    updatedAt: now,
  });
}
