import type { ScoreParams } from "./score";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Reglas del puntaje verificado. Se guardan también en cada AgentScore para que quien lea el puntaje sepa con qué
 * reglas se calculó y pueda repetir el cálculo.
 *  - minPaid: pago mínimo acumulado para que un cliente cuente (1 tUSD, con 6 decimales).
 *  - minHumans: personas distintas necesarias para que el puntaje deje de ser provisional.
 */
export const SCORE_PARAMS: ScoreParams = {
  minPaid: 1_000_000n,
  minHumans: 3,
};
