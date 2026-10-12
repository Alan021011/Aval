import { indexer } from "envio";
import { getAgentWallet } from "../effects";
import { recomputeScore } from "../recompute";

indexer.onEvent({ contract: "ReputationRegistry", event: "NewFeedback", fields: { block: ["timestamp"] } }, async ({ event, context }) => {
  const { agentId, clientAddress: client, feedbackIndex, value, valueDecimals, tag1, tag2 } = event.params;
  const now = BigInt(event.block.timestamp);

  context.Feedback.set({
    id: `${agentId}_${client}_${feedbackIndex}`,
    agentId,
    client,
    feedbackIndex,
    value,
    decimals: Number(valueDecimals),
    tag1,
    tag2,
    createdAt: now,
  });

  // El agente cobra en una billetera que se consulta en el Identity Registry. Se vuelve a consultar con cada reseña.
  const wallet = await context.effect(getAgentWallet, agentId);
  context.Agent.set({ id: agentId.toString(), agentId, wallet, walletCheckedAt: now });

  await recomputeScore(context, agentId, wallet, now);
});
