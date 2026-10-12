import { AvalError } from './errors.js';
import { type FeedbackInput, type RelationInput, type ScoreParams, type VerifiedScoreResult, computeVerifiedScore } from './score.js';

/** Lo mínimo que se usa de `fetch`; así se puede probar sin red. */
export type IndexerFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type AgentScoreRecord = {
  agentId: bigint;
  wallet: string | null;
  status: 'Verified' | 'Insufficient';
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
  minPaid: bigint;
  minHumans: number;
  updatedAt: bigint;
};

export type PaymentRecord = {
  id: string;
  permitId: bigint;
  payee: string;
  amount: bigint;
  approvedByUser: boolean;
  timestamp: bigint;
};

export type ScoreCheck = {
  stored: AgentScoreRecord;
  recomputed: VerifiedScoreResult;
  /** Verdadero si el indexador y el recálculo con los mismos datos dan lo mismo. */
  matches: boolean;
  /** Campos en los que no coinciden (vacío si `matches`). */
  differences: string[];
};

type Row = Record<string, unknown>;

// Los BigInt de la base llegan como número o como texto según la configuración: se aceptan los dos.
const big = (v: unknown): bigint => BigInt(String(v ?? 0));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const HEX = /^0x[0-9a-fA-F]{40}$/;
const assertAddress = (value: string): string => {
  if (!HEX.test(value)) throw new AvalError('InvalidAddress', `"${value}" no es una dirección válida.`);
  return value.toLowerCase();
};

function toScoreRecord(row: Row): AgentScoreRecord {
  return {
    agentId: big(row.agentId),
    wallet: text(row.wallet),
    status: row.status === 'Verified' ? 'Verified' : 'Insufficient',
    verifiedAverage: num(row.verifiedAverage),
    verifiedHumans: Number(row.verifiedHumans ?? 0),
    totalFeedbackCount: Number(row.totalFeedbackCount ?? 0),
    rawAverage: num(row.rawAverage),
    excludedNotPaid: Number(row.excludedNotPaid ?? 0),
    excludedBelowMinPaid: Number(row.excludedBelowMinPaid ?? 0),
    excludedRelated: Number(row.excludedRelated ?? 0),
    topClientShare: num(row.topClientShare),
    payingHumans: Number(row.payingHumans ?? 0),
    totalPaid: big(row.totalPaid),
    minPaid: big(row.minPaid),
    minHumans: Number(row.minHumans ?? 0),
    updatedAt: big(row.updatedAt),
  };
}

const SCORE_FIELDS =
  'agentId wallet status verifiedAverage verifiedHumans totalFeedbackCount rawAverage excludedNotPaid excludedBelowMinPaid excludedRelated topClientShare payingHumans totalPaid minPaid minHumans updatedAt';

const close = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);

/**
 * Cliente del indexador de Aval (Envio HyperIndex, GraphQL). Lee el puntaje verificado de un agente, los pagos de un
 * usuario y, sobre todo, puede **comprobar** el puntaje: lo recalcula con las reseñas y los pagos en bruto, así no
 * hay que creerle al indexador.
 */
export function createIndexerClient(options: {
  url: string;
  /** Red de los datos. Cada fila del indexador se identifica por (id, chainId). Por defecto, Monad testnet. */
  chainId?: number;
  fetch?: IndexerFetch;
}) {
  const doFetch: IndexerFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const chainId = Math.floor(options.chainId ?? 10143);

  async function query<T = Row>(graphql: string): Promise<T> {
    const response = await doFetch(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: graphql }),
    });
    if (!response.ok) throw new AvalError('IndexerHttp', `El indexador respondió HTTP ${response.status}.`);
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new AvalError('IndexerQuery', `El indexador rechazó la consulta: ${body.errors[0]?.message}`);
    if (!body.data) throw new AvalError('IndexerQuery', 'El indexador no devolvió datos.');
    return body.data;
  }

  async function agentScore(agentId: bigint): Promise<AgentScoreRecord | null> {
    const data = await query<{ AgentScore_by_pk: Row | null }>(`{ AgentScore_by_pk(id: "${agentId}", chainId: ${chainId}) { ${SCORE_FIELDS} } }`);
    return data.AgentScore_by_pk ? toScoreRecord(data.AgentScore_by_pk) : null;
  }

  return {
    /** Consulta GraphQL libre. */
    query,

    /** Puntaje verificado de un agente, o `null` si todavía no tiene reseñas. */
    agentScore,

    /** Pagos hechos por (o a través de los permisos de) un usuario, del más reciente al más antiguo. */
    async payments(owner: string, limit = 50): Promise<PaymentRecord[]> {
      const data = await query<{ Payment: Row[] }>(
        `{ Payment(where: {owner: {_eq: "${assertAddress(owner)}"}, chainId: {_eq: ${chainId}}}, order_by: {timestamp: desc}, limit: ${Math.max(1, Math.floor(limit))}) { id permit_id payee amount approvedByUser timestamp } }`,
      );
      return data.Payment.map((p) => ({
        id: String(p.id),
        permitId: big(p.permit_id),
        payee: String(p.payee),
        amount: big(p.amount),
        approvedByUser: Boolean(p.approvedByUser),
        timestamp: big(p.timestamp),
      }));
    },

    /**
     * Recalcula el puntaje de un agente con las reseñas y los pagos en bruto del indexador, usando las mismas reglas
     * (`minPaid`, `minHumans`) con las que el indexador dice haberlo calculado, y lo compara con el guardado.
     * `null` si el agente no tiene puntaje.
     */
    async verifyAgentScore(agentId: bigint): Promise<ScoreCheck | null> {
      const stored = await agentScore(agentId);
      if (!stored) return null;

      const [feedbackData, relationData] = await Promise.all([
        query<{ Feedback: Row[] }>(`{ Feedback(where: {agentId: {_eq: "${agentId}"}, chainId: {_eq: ${chainId}}}) { client feedbackIndex value decimals createdAt } }`),
        stored.wallet
          ? query<{ PaidRelation: Row[] }>(
              `{ PaidRelation(where: {payee: {_eq: "${assertAddress(stored.wallet)}"}, chainId: {_eq: ${chainId}}}) { client owner totalPaid relatedToPayee } }`,
            )
          : Promise.resolve({ PaidRelation: [] as Row[] }),
      ]);

      const feedbacks: FeedbackInput[] = feedbackData.Feedback.map((f) => ({
        client: String(f.client),
        feedbackIndex: big(f.feedbackIndex),
        value: big(f.value),
        decimals: Number(f.decimals),
        createdAt: big(f.createdAt),
      }));
      const relations: RelationInput[] = relationData.PaidRelation.map((r) => ({
        client: String(r.client),
        owner: String(r.owner),
        totalPaid: big(r.totalPaid),
        relatedToPayee: Boolean(r.relatedToPayee),
      }));

      const params: ScoreParams = { minPaid: stored.minPaid, minHumans: stored.minHumans };
      const recomputed = computeVerifiedScore(feedbacks, relations, params);

      const differences: string[] = [];
      const same = (field: string, a: unknown, b: unknown) => {
        if (a !== b) differences.push(field);
      };
      same('status', stored.status, recomputed.status);
      same('verifiedHumans', stored.verifiedHumans, recomputed.verifiedHumans);
      same('totalFeedbackCount', stored.totalFeedbackCount, recomputed.totalFeedbackCount);
      same('excludedNotPaid', stored.excludedNotPaid, recomputed.excludedNotPaid);
      same('excludedBelowMinPaid', stored.excludedBelowMinPaid, recomputed.excludedBelowMinPaid);
      same('excludedRelated', stored.excludedRelated, recomputed.excludedRelated);
      same('payingHumans', stored.payingHumans, recomputed.payingHumans);
      same('totalPaid', stored.totalPaid, recomputed.totalPaid);
      if (!close(stored.verifiedAverage, recomputed.verifiedAverage)) differences.push('verifiedAverage');
      if (!close(stored.rawAverage, recomputed.rawAverage)) differences.push('rawAverage');
      if (!close(stored.topClientShare, recomputed.topClientShare)) differences.push('topClientShare');

      return { stored, recomputed, matches: differences.length === 0, differences };
    },
  };
}

export type IndexerClient = ReturnType<typeof createIndexerClient>;
