import { describe, expect, it } from "vitest";
import vectors from "./vectors.json";
import { computeScore, type FeedbackInput, type RelationInput } from "../src/score";

const params = { minPaid: BigInt(vectors.params.minPaid), minHumans: vectors.params.minHumans };

const feedbacks = (list: (typeof vectors.cases)[number]["feedbacks"]): FeedbackInput[] =>
  list.map((f) => ({ client: f.client, feedbackIndex: BigInt(f.feedbackIndex), value: BigInt(f.value), decimals: f.decimals, createdAt: BigInt(f.createdAt) }));

const relations = (list: (typeof vectors.cases)[number]["relations"]): RelationInput[] =>
  list.map((r) => ({ client: r.client, owner: r.owner, totalPaid: BigInt(r.totalPaid), relatedToPayee: r.relatedToPayee }));

describe("puntaje verificado: casos compartidos con el SDK", () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      const result = computeScore(feedbacks(c.feedbacks), relations(c.relations), params);
      const { totalPaid, verifiedAverage, rawAverage, topClientShare, ...rest } = c.expected;
      expect(result).toMatchObject(rest);
      expect(result.totalPaid).toBe(BigInt(totalPaid));
      for (const [name, got, want] of [
        ["verifiedAverage", result.verifiedAverage, verifiedAverage],
        ["rawAverage", result.rawAverage, rawAverage],
        ["topClientShare", result.topClientShare, topClientShare],
      ] as const) {
        if (want === null) expect(got, name).toBeNull();
        else expect(got, name).toBeCloseTo(want, 10);
      }
    });
  }
});

describe("puntaje verificado: propiedades", () => {
  it("el resultado no depende del orden en que llegan las reseñas ni los pagos", () => {
    const c = vectors.cases[2]!;
    const forward = computeScore(feedbacks(c.feedbacks), relations(c.relations), params);
    const reversed = computeScore(feedbacks(c.feedbacks).reverse(), relations(c.relations).reverse(), params);
    expect(reversed).toEqual(forward);
  });

  it("agregar reseñas falsas de cuentas que no pagaron no mueve el puntaje verificado", () => {
    const c = vectors.cases[2]!;
    const base = computeScore(feedbacks(c.feedbacks), relations(c.relations), params);
    const fakes: FeedbackInput[] = Array.from({ length: 50 }, (_, i) => ({ client: `0xfake${i}`, feedbackIndex: 0n, value: 100n, decimals: 0, createdAt: 99n }));
    const attacked = computeScore([...feedbacks(c.feedbacks), ...fakes], relations(c.relations), params);
    expect(attacked.verifiedAverage).toBe(base.verifiedAverage);
    expect(attacked.verifiedHumans).toBe(base.verifiedHumans);
    expect(attacked.excludedNotPaid).toBe(50);
    // Sin el filtro, las 50 reseñas falsas sí empujarían el promedio hacia arriba.
    expect(attacked.rawAverage!).toBeGreaterThan(base.rawAverage!);
  });
});
