import { describe, expect, it } from 'vitest';
import { type IndexerFetch, computeVerifiedScore, createIndexerClient } from '../src/index.js';
// Los mismos casos que prueban la función del indexador: si las dos dan lo mismo aquí, el SDK puede comprobar al indexador.
import vectors from '../../../indexer/test/vectors.json';

const params = { minPaid: BigInt(vectors.params.minPaid), minHumans: vectors.params.minHumans };
type Case = (typeof vectors.cases)[number];

const feedbacks = (c: Case) =>
  c.feedbacks.map((f) => ({ client: f.client, feedbackIndex: BigInt(f.feedbackIndex), value: BigInt(f.value), decimals: f.decimals, createdAt: BigInt(f.createdAt) }));
const relations = (c: Case) =>
  c.relations.map((r) => ({ client: r.client, owner: r.owner, totalPaid: BigInt(r.totalPaid), relatedToPayee: r.relatedToPayee }));

describe('puntaje verificado: los casos del indexador', () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      const result = computeVerifiedScore(feedbacks(c), relations(c), params);
      const { totalPaid, verifiedAverage, rawAverage, topClientShare, ...rest } = c.expected;
      expect(result).toMatchObject(rest);
      expect(result.totalPaid).toBe(BigInt(totalPaid));
      for (const [name, got, want] of [
        ['verifiedAverage', result.verifiedAverage, verifiedAverage],
        ['rawAverage', result.rawAverage, rawAverage],
        ['topClientShare', result.topClientShare, topClientShare],
      ] as const) {
        if (want === null) expect(got, name).toBeNull();
        else expect(got, name).toBeCloseTo(want, 10);
      }
    });
  }
});

/** Un indexador de mentira que responde las tres consultas de `verifyAgentScore` con los datos de un caso. */
function fakeIndexer(c: Case, tamper?: (row: Record<string, unknown>) => void): IndexerFetch {
  const wallet = '0x' + 'd'.repeat(40);
  const expected = c.expected;
  const stored: Record<string, unknown> = {
    agentId: '2090',
    wallet,
    status: expected.status,
    verifiedAverage: expected.verifiedAverage,
    verifiedHumans: expected.verifiedHumans,
    totalFeedbackCount: expected.totalFeedbackCount,
    rawAverage: expected.rawAverage,
    excludedNotPaid: expected.excludedNotPaid,
    excludedBelowMinPaid: expected.excludedBelowMinPaid,
    excludedRelated: expected.excludedRelated,
    topClientShare: expected.topClientShare,
    payingHumans: expected.payingHumans,
    totalPaid: expected.totalPaid,
    minPaid: vectors.params.minPaid,
    minHumans: vectors.params.minHumans,
    updatedAt: '1',
  };
  tamper?.(stored);
  return async (_url, init) => {
    const q = (JSON.parse(init.body) as { query: string }).query;
    const data = q.includes('AgentScore_by_pk')
      ? { AgentScore_by_pk: stored }
      : q.includes('Feedback(')
        ? { Feedback: c.feedbacks }
        : { PaidRelation: c.relations };
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
}

describe('createIndexerClient.verifyAgentScore', () => {
  const sample = vectors.cases[2]!;

  it('confirma un puntaje honesto', async () => {
    const client = createIndexerClient({ url: 'http://indexer.test', fetch: fakeIndexer(sample) });
    const check = await client.verifyAgentScore(2090n);
    expect(check?.matches).toBe(true);
    expect(check?.differences).toEqual([]);
    expect(check?.recomputed.verifiedHumans).toBe(3);
  });

  it('detecta un indexador que infla el puntaje', async () => {
    const lying = fakeIndexer(sample, (row) => {
      row.verifiedAverage = 99;
      row.verifiedHumans = 9;
    });
    const check = await createIndexerClient({ url: 'http://indexer.test', fetch: lying }).verifyAgentScore(2090n);
    expect(check?.matches).toBe(false);
    expect(check?.differences).toEqual(expect.arrayContaining(['verifiedAverage', 'verifiedHumans']));
  });

  it('devuelve null si el agente no tiene puntaje', async () => {
    const empty: IndexerFetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { AgentScore_by_pk: null } }) });
    expect(await createIndexerClient({ url: 'http://indexer.test', fetch: empty }).verifyAgentScore(1n)).toBeNull();
  });

  it('rechaza una dirección inválida antes de armar la consulta', async () => {
    const never: IndexerFetch = async () => {
      throw new Error('no debería consultar');
    };
    await expect(createIndexerClient({ url: 'http://indexer.test', fetch: never }).payments('0x1" } ) { x')).rejects.toThrow('no es una dirección válida');
  });

  it('explica los errores del indexador', async () => {
    const failing: IndexerFetch = async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'field not found' }] }) });
    await expect(createIndexerClient({ url: 'http://indexer.test', fetch: failing }).agentScore(1n)).rejects.toThrow('field not found');
  });
});
