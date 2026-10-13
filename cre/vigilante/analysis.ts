/**
 * Detección determinista de patrones riesgosos en los pagos de un agente de Aval. Es pura (sin red) para que todos los
 * nodos de Chainlink lleguen al mismo resultado y para probarla aparte. Qwen solo redacta la explicación.
 */

/** Un recibo de AgentPermit (lo que devuelve `receiptsOf`). */
export type Receipt = { to: string; permitId: bigint; amount: bigint; requestId: bigint; timestamp: bigint };

export type Finding = {
  /** 0 = nada, 1 = vigilar (ráfaga de pagos), 2 = bloquear (pagos divididos para esquivar el máximo). */
  level: 0 | 1 | 2;
  /** Explicación corta y determinista (Qwen la puede reescribir más clara). */
  reason: string;
  /** Cuándo se observó: la fecha del último recibo de la ventana (sirve para descartar reportes viejos). */
  observedAt: bigint;
  /** Pagos y monto que entran en el patrón. */
  count: number;
  total: bigint;
};

const usd = (units: bigint) => (Number(units) / 1_000_000).toString();

/**
 * Mira los recibos del dueño del permiso alrededor del último pago:
 * - **Pagos divididos:** dos o más pagos del mismo permiso al mismo destinatario dentro de la ventana que, juntos,
 *   superan el máximo por pago. Es lo que hizo un agente real (Qwen) al toparse con el límite: partir 150 en 50 + 100.
 * - **Ráfaga:** tres o más pagos del mismo permiso dentro de la ventana, aunque no superen el máximo.
 */
export function analyzePayments(input: {
  receipts: Receipt[];
  permitId: bigint;
  to: string;
  maxPerSpend: bigint;
  windowSeconds: bigint;
}): Finding {
  const samePermit = input.receipts.filter((r) => r.permitId === input.permitId);
  if (samePermit.length === 0) return { level: 0, reason: 'Sin pagos de este permiso.', observedAt: 0n, count: 0, total: 0n };

  const latest = samePermit.reduce((a, b) => (b.timestamp > a ? b.timestamp : a), 0n);
  const inWindow = samePermit.filter((r) => latest - r.timestamp <= input.windowSeconds);
  const sameRecipient = inWindow.filter((r) => r.to.toLowerCase() === input.to.toLowerCase());
  const total = sameRecipient.reduce((sum, r) => sum + r.amount, 0n);
  const minutes = (Number(input.windowSeconds) / 60).toString();

  if (sameRecipient.length >= 2 && total > input.maxPerSpend) {
    return {
      level: 2,
      reason: `Posibles pagos divididos: ${sameRecipient.length} pagos al mismo destinatario en ${minutes} min suman ${usd(total)} tUSD y superan el máximo por pago (${usd(input.maxPerSpend)} tUSD).`,
      observedAt: latest,
      count: sameRecipient.length,
      total,
    };
  }
  if (inWindow.length >= 3) {
    const burstTotal = inWindow.reduce((sum, r) => sum + r.amount, 0n);
    return {
      level: 1,
      reason: `Ráfaga de pagos: ${inWindow.length} pagos del mismo permiso en ${minutes} min (${usd(burstTotal)} tUSD).`,
      observedAt: latest,
      count: inWindow.length,
      total: burstTotal,
    };
  }
  return { level: 0, reason: 'Sin patrones de riesgo.', observedAt: latest, count: inWindow.length, total };
}
