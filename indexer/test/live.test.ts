import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

/**
 * Prueba con DATOS REALES de Monad testnet: procesa los bloques desde que se desplegaron nuestros contratos hasta un
 * bloque fijo, leyendo de HyperSync. No necesita Docker, pero sí `ENVIO_API_TOKEN`; sin token se salta.
 * Sirve para comprobar que los handlers entienden los eventos reales (y no solo los simulados).
 */
const FROM = 69_345_850; // PasskeyRegistry
const TO = 70_010_000;
const SERVICE_AGENT_ID = "2090";

describe.skipIf(!process.env.ENVIO_API_TOKEN)("indexador con datos reales de Monad testnet", () => {
  it("procesa permisos, pagos y reseñas reales y calcula el puntaje del servicio #2090", async (t) => {
    const indexer = createTestIndexer();
    const result = await indexer.process({ chains: { 10143: { startBlock: FROM, endBlock: TO } } });

    const events = result.changes.reduce((sum, c) => sum + c.eventsProcessed, 0);
    const permits = await indexer.Permit.getAll();
    const payments = await indexer.Payment.getAll();
    const relations = await indexer.PaidRelation.getAll();
    const feedbacks = await indexer.Feedback.getAll();
    const accounts = await indexer.Account.getAll();
    const score = await indexer.AgentScore.get(SERVICE_AGENT_ID);

    console.log(
      JSON.stringify(
        {
          events,
          accounts: accounts.length,
          withPasskey: accounts.filter((a) => a.hasPasskey).length,
          permits: permits.length,
          payments: payments.length,
          approvedByUser: payments.filter((p) => p.approvedByUser).length,
          relations: relations.length,
          feedbacks: feedbacks.length,
          feedbacksForService: feedbacks.filter((f) => f.agentId.toString() === SERVICE_AGENT_ID).length,
          score: score && { ...score, totalPaid: String(score.totalPaid), agentId: String(score.agentId), minPaid: String(score.minPaid), updatedAt: String(score.updatedAt) },
        },
        null,
        2,
      ),
    );

    t.expect(events).toBeGreaterThan(0);
    t.expect(permits.length).toBeGreaterThan(0);
    t.expect(payments.length).toBeGreaterThan(0);
    // Todo pago ejecutado pertenece a un permiso que se indexó.
    for (const p of payments) t.expect(permits.some((x) => x.id === p.permit_id)).toBe(true);
    // El permiso nunca gastó más de lo que pagó (los dos salen del mismo evento).
    for (const permit of permits) {
      const paid = payments.filter((p) => p.permit_id === permit.id).reduce((s, p) => s + p.amount, 0n);
      t.expect(paid).toBe(permit.spent);
    }
    t.expect(score).toBeDefined();
    t.expect(score!.wallet).toBe("0xdf7868e29d39addad5b6e1162738657432f53a19");
  }, 280_000);
});
