import { describe, expect, test } from 'bun:test';
import { analyzePayments, type Receipt } from './analysis';

const SERVICE = '0xDf7868e29d39ADDAD5B6E1162738657432f53A19';
const OTHER = '0x0000000000000000000000000000000000000abc';
const usd = (n: number) => BigInt(n * 1_000_000);
const r = (amount: number, timestamp: number, permitId = 1n, to = SERVICE): Receipt => ({ to, permitId, amount: usd(amount), requestId: 0n, timestamp: BigInt(timestamp) });
const base = { permitId: 1n, to: SERVICE, maxPerSpend: usd(100), windowSeconds: 600n };

describe('detección del vigilante', () => {
  test('pagos divididos: dos pagos al mismo servicio que juntos superan el máximo → bloquear', () => {
    const f = analyzePayments({ ...base, receipts: [r(60, 1000), r(60, 1100)] });
    expect(f.level).toBe(2);
    expect(f.count).toBe(2);
    expect(f.total).toBe(usd(120));
    expect(f.observedAt).toBe(1100n);
    expect(f.reason).toContain('pagos divididos');
  });

  test('el caso real de Qwen: 50 + 100 con máximo de 100 → bloquear', () => {
    expect(analyzePayments({ ...base, receipts: [r(50, 1000), r(100, 1200)] }).level).toBe(2);
  });

  test('dos pagos que no superan el máximo → sin alerta', () => {
    expect(analyzePayments({ ...base, receipts: [r(30, 1000), r(40, 1100)] }).level).toBe(0);
  });

  test('pagos fuera de la ventana no se suman', () => {
    expect(analyzePayments({ ...base, receipts: [r(60, 0), r(60, 1000)] }).level).toBe(0);
  });

  test('otro destinatario u otro permiso no cuentan para la división', () => {
    expect(analyzePayments({ ...base, receipts: [r(60, 1000, 1n, OTHER), r(60, 1100)] }).level).toBe(0);
    expect(analyzePayments({ ...base, receipts: [r(60, 1000, 2n), r(60, 1100)] }).level).toBe(0);
  });

  test('ráfaga: tres pagos pequeños del mismo permiso → vigilar', () => {
    const f = analyzePayments({ ...base, receipts: [r(10, 1000, 1n, OTHER), r(10, 1100), r(10, 1200, 1n, OTHER)] });
    expect(f.level).toBe(1);
    expect(f.reason).toContain('Ráfaga');
  });

  test('sin pagos del permiso → sin alerta', () => {
    expect(analyzePayments({ ...base, receipts: [r(60, 1000, 9n)] }).level).toBe(0);
  });
});
