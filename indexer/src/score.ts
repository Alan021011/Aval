/**
 * Puntaje verificado de un agente. Función pura (sin red, sin base de datos): el indexador la usa para guardar el
 * puntaje y el SDK de Aval tiene la misma para que cualquiera pueda comprobar el resultado con los mismos datos.
 * Los dos se prueban con los mismos casos (`test/vectors.json`), así no pueden separarse.
 *
 * Reglas, de la más a la menos estricta con quien reseña:
 *  1. Solo cuenta quien le pagó al servicio a través de Aval, al menos `minPaid` en total.
 *  2. No cuenta quien está relacionado con el servicio: lo fondeó el propio servicio o es el servicio mismo.
 *  3. Cada persona cuenta una sola vez, con su reseña más reciente (el dueño del permiso y su agente son la misma persona).
 *  4. El puntaje es "Verified" solo con al menos `minHumans` personas distintas; antes es provisional.
 */

export type ScoreParams = {
  /** Pago acumulado mínimo, en unidades del token, para que un cliente cuente. */
  minPaid: bigint;
  /** Personas distintas necesarias para que el puntaje deje de ser provisional. */
  minHumans: number;
};

export type FeedbackInput = {
  client: string;
  feedbackIndex: bigint;
  value: bigint;
  decimals: number;
  createdAt: bigint;
};

/** Cuánto le pagó `client` al servicio. Viene de los eventos `Spent` de AgentPermit. */
export type RelationInput = {
  client: string;
  /** La persona detrás del pago: el dueño del permiso. */
  owner: string;
  totalPaid: bigint;
  relatedToPayee: boolean;
};

export type ScoreResult = {
  status: "Verified" | "Insufficient";
  verifiedAverage: number | null;
  verifiedHumans: number;
  totalFeedbackCount: number;
  rawAverage: number | null;
  excludedNotPaid: number;
  excludedBelowMinPaid: number;
  excludedRelated: number;
  topClientShare: number | null;
  payingHumans: number;
  totalPaid: bigint;
};

const scaled = (value: bigint, decimals: number) => Number(value) / 10 ** decimals;

/** Promedio sumando en un orden fijo, para que dos implementaciones den exactamente el mismo número. */
const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

/** Es `a` una reseña más reciente que `b`? Se desempata siempre igual para que el resultado no dependa del orden. */
function isNewer(a: FeedbackInput, b: FeedbackInput): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  if (a.feedbackIndex !== b.feedbackIndex) return a.feedbackIndex > b.feedbackIndex;
  return a.client > b.client;
}

export function computeScore(input: FeedbackInput[], relations: RelationInput[], params: ScoreParams): ScoreResult {
  // La base de datos no garantiza un orden: se fija aquí para que el resultado sea siempre el mismo.
  const feedbacks = [...input].sort((a, b) => (isNewer(a, b) ? 1 : -1));
  const byClient = new Map(relations.map((r) => [r.client.toLowerCase(), r]));

  // Volumen por persona: el dueño y su agente quedan con el mismo acumulado, así que se toma el mayor, no la suma.
  const volumeByHuman = new Map<string, bigint>();
  const relatedHumans = new Set<string>();
  for (const r of relations) {
    const human = r.owner.toLowerCase();
    const current = volumeByHuman.get(human) ?? 0n;
    if (r.totalPaid > current) volumeByHuman.set(human, r.totalPaid);
    if (r.relatedToPayee) relatedHumans.add(human);
  }

  let excludedNotPaid = 0;
  let excludedBelowMinPaid = 0;
  let excludedRelated = 0;
  const latestByHuman = new Map<string, FeedbackInput>();
  for (const f of feedbacks) {
    const relation = byClient.get(f.client.toLowerCase());
    if (!relation) {
      excludedNotPaid++;
    } else if (relation.totalPaid < params.minPaid) {
      excludedBelowMinPaid++;
    } else if (relation.relatedToPayee) {
      excludedRelated++;
    } else {
      const human = relation.owner.toLowerCase();
      const previous = latestByHuman.get(human);
      if (!previous || isNewer(f, previous)) latestByHuman.set(human, f);
    }
  }

  // Se promedia en orden de persona, siempre el mismo.
  const humans = [...latestByHuman.keys()].sort();
  const verifiedAverage = mean(humans.map((h) => scaled(latestByHuman.get(h)!.value, latestByHuman.get(h)!.decimals)));

  // Concentración: qué parte del dinero viene de la persona que más pagó, sin contar a las relacionadas con el servicio.
  const independent = [...volumeByHuman].filter(([human]) => !relatedHumans.has(human));
  const independentTotal = independent.reduce((sum, [, v]) => sum + v, 0n);
  const top = independent.reduce((max, [, v]) => (v > max ? v : max), 0n);
  // Con montos de hasta 2^53 la división en Number es exacta para lo que se muestra (porcentaje).
  const topClientShare = independentTotal === 0n ? null : Number(top) / Number(independentTotal);

  return {
    status: humans.length >= params.minHumans ? "Verified" : "Insufficient",
    verifiedAverage,
    verifiedHumans: humans.length,
    totalFeedbackCount: feedbacks.length,
    rawAverage: mean(feedbacks.map((f) => scaled(f.value, f.decimals))),
    excludedNotPaid,
    excludedBelowMinPaid,
    excludedRelated,
    topClientShare,
    payingHumans: volumeByHuman.size,
    totalPaid: [...volumeByHuman.values()].reduce((a, b) => a + b, 0n),
  };
}
