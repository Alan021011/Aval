import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

/**
 * Flujo completo con eventos simulados (sin esperar a la cadena). La única llamada de red es la billetera del agente
 * #2090, que se lee del Identity Registry de Monad testnet: es la del servicio de traducción de la demo.
 */
const SERVICE_AGENT_ID = 2090n;
const SERVICE = "0xdf7868e29d39addad5b6e1162738657432f53a19" as `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const USER = addr(0x1001);
const USER_AGENT = addr(0x1002);
const SYBIL = addr(0x2001); // fondeado por el propio servicio
const SYBIL_AGENT = addr(0x2002);
const LATE = addr(0x3001); // reseña antes de pagar
const LATE_AGENT = addr(0x3002);
const TUSD = addr(0xeed);

// Cada evento simulado se escribe con su contrato y sus parámetros; el tipo exacto lo valida `process` al ejecutarse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = any;

let block = 69_600_000;
const at = (timestamp: number) => ({ number: ++block, timestamp });

const terms = (agent: `0x${string}`) => [agent, 0n, TUSD, 100_000_000n, 300_000_000n, 50_000_000n, 9_999_999_999n] as const;

const permit = (id: bigint, owner: `0x${string}`, agent: `0x${string}`, t: number): Item => ({
  contract: "AgentPermit",
  event: "PermitGranted",
  block: at(t),
  params: { permitId: id, owner, agent, agentId: 0n, terms: terms(agent) },
}) as Item;

const spent = (permitId: bigint, agent: `0x${string}`, owner: `0x${string}`, amount: bigint, requestId: bigint, t: number): Item => ({
  contract: "AgentPermit",
  event: "Spent",
  block: at(t),
  params: { permitId, agent, to: SERVICE, owner, token: TUSD, amount, ref: "0x00", requestId },
}) as Item;

const feedback = (client: `0x${string}`, value: bigint, index: bigint, t: number): Item => ({
  contract: "ReputationRegistry",
  event: "NewFeedback",
  block: at(t),
  params: { agentId: SERVICE_AGENT_ID, clientAddress: client, feedbackIndex: index, value, valueDecimals: 0, tag1: "calidad", tag2: "" },
}) as Item;

const mint = (to: `0x${string}`, from: `0x${string}`, t: number): Item => ({
  contract: "TestUSD",
  event: "Transfer",
  block: at(t),
  params: { from, to, value: 500_000_000n },
}) as Item;

describe("indexador de Aval", () => {
  it("indexa permisos, pagos y cuentas, y calcula el puntaje solo con clientes que pagaron", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        10143: {
          simulate: [
            // Un usuario real: recibe tUSD del faucet, registra su huella, da un permiso y su agente paga.
            { contract: "PasskeyRegistry", event: "PasskeyRegistered", block: at(1000), params: { owner: USER, x: "0x01", y: "0x02" } } as Item,
            mint(USER, ZERO, 1001),
            permit(1n, USER, USER_AGENT, 1002),
            spent(1n, USER_AGENT, USER, 25_000_000n, 0n, 1003),
            // Un pago grande: el agente lo pide y el usuario lo aprueba con su huella.
            { contract: "AgentPermit", event: "SpendRequested", block: at(1004), params: { requestId: 1n, permitId: 1n, owner: USER, to: SERVICE, amount: 75_000_000n, ref: "0x00", challenge: "0x00" } } as Item,
            spent(1n, USER_AGENT, USER, 75_000_000n, 1n, 1005),
            // El agente reseña al servicio: el dueño y su agente son la misma persona.
            feedback(USER_AGENT, 90n, 0n, 1006),
          ],
        },
      },
    });

    const account = await indexer.Account.getOrThrow(USER);
    t.expect(account).toMatchObject({ hasPasskey: true, firstFundedBy: ZERO });

    const permit1 = await indexer.Permit.getOrThrow("1");
    t.expect(permit1).toMatchObject({ owner: USER, agent: USER_AGENT, spent: 100_000_000n, status: "Active" });

    const request = await indexer.SpendRequest.getOrThrow("1");
    t.expect(request).toMatchObject({ status: "Executed", amount: 75_000_000n });

    const payments = await indexer.Payment.getAll();
    t.expect(payments).toHaveLength(2);
    t.expect(payments.filter((p) => p.approvedByUser)).toHaveLength(1);

    // El dueño y su agente quedan como pagadores, con el mismo acumulado.
    t.expect(await indexer.PaidRelation.getOrThrow(`${SERVICE}_${USER}`)).toMatchObject({ totalPaid: 100_000_000n, paymentCount: 2, owner: USER, relatedToPayee: false });
    t.expect(await indexer.PaidRelation.getOrThrow(`${SERVICE}_${USER_AGENT}`)).toMatchObject({ totalPaid: 100_000_000n, owner: USER });

    // La billetera del agente sale del Identity Registry real.
    const agent = await indexer.Agent.getOrThrow(SERVICE_AGENT_ID.toString());
    t.expect(agent.wallet).toBe(SERVICE);

    const score = await indexer.AgentScore.getOrThrow(SERVICE_AGENT_ID.toString());
    t.expect(score).toMatchObject({ status: "Insufficient", verifiedHumans: 1, verifiedAverage: 90, totalFeedbackCount: 1, excludedNotPaid: 0, payingHumans: 1, totalPaid: 100_000_000n });
  }, 60_000);

  it("descarta al cliente que el propio servicio fondeó, y cuenta al que reseña antes de pagar cuando por fin paga", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        10143: {
          simulate: [
            mint(USER, ZERO, 2000),
            permit(1n, USER, USER_AGENT, 2001),
            spent(1n, USER_AGENT, USER, 20_000_000n, 0n, 2002),
            feedback(USER_AGENT, 80n, 0n, 2003),

            // Autopago: el servicio le manda tUSD a una cuenta suya, que le "paga" y se reseña con 100.
            mint(SYBIL, SERVICE, 2004),
            permit(2n, SYBIL, SYBIL_AGENT, 2005),
            spent(2n, SYBIL_AGENT, SYBIL, 20_000_000n, 0n, 2006),
            feedback(SYBIL_AGENT, 100n, 0n, 2007),

            // Reseña antes de pagar: al principio no cuenta; en cuanto paga, sí.
            mint(LATE, ZERO, 2008),
            feedback(LATE_AGENT, 60n, 0n, 2009),
          ],
        },
      },
    });

    let score = await indexer.AgentScore.getOrThrow(SERVICE_AGENT_ID.toString());
    // Cuenta solo el usuario real (80). El autopago está relacionado y la reseña sin pago no cuenta.
    t.expect(score).toMatchObject({ verifiedHumans: 1, verifiedAverage: 80, totalFeedbackCount: 3, excludedRelated: 1, excludedNotPaid: 1 });
    t.expect(score.rawAverage).toBeCloseTo((80 + 100 + 60) / 3, 10);

    t.expect(await indexer.PaidRelation.getOrThrow(`${SERVICE}_${SYBIL}`)).toMatchObject({ relatedToPayee: true });
    t.expect(await indexer.PaidRelation.getOrThrow(`${SERVICE}_${SYBIL_AGENT}`)).toMatchObject({ relatedToPayee: true });

    // Ahora el cliente que reseñó antes de pagar, paga: su reseña pasa a contar sin que nadie la reenvíe.
    await indexer.process({
      chains: {
        10143: {
          simulate: [permit(3n, LATE, LATE_AGENT, 2010), spent(3n, LATE_AGENT, LATE, 20_000_000n, 0n, 2011)],
        },
      },
    });

    score = await indexer.AgentScore.getOrThrow(SERVICE_AGENT_ID.toString());
    t.expect(score).toMatchObject({ verifiedHumans: 2, excludedNotPaid: 0, excludedRelated: 1 });
    t.expect(score.verifiedAverage).toBeCloseTo((80 + 60) / 2, 10);
  }, 60_000);

  it("revocar un permiso lo marca como revocado", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            permit(7n, USER, USER_AGENT, 3000),
            { contract: "AgentPermit", event: "PermitRevoked", block: at(3001), params: { permitId: 7n } } as Item,
          ],
        },
      },
    });
    t.expect(await indexer.Permit.getOrThrow("7")).toMatchObject({ status: "Revoked", revokedAt: 3001n });
  });
});
