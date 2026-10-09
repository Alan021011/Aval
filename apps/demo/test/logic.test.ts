import { AvalError, type Permit } from '@aval/sdk';
import { describe, expect, it } from 'vitest';
import { ago, parseUsd, remainingTime, usd } from '../src/lib/format';
import { blockedMessage, isActive, isNever, scenarios } from '../src/state/useAval';

const U = 1_000_000n;
const NEVER = (1n << 128n) - 1n;
const NOW = 1_800_000_000_000;

function permit(over: Partial<Permit['terms']> = {}, extra: Partial<Permit> = {}): Permit {
  return {
    owner: '0x0000000000000000000000000000000000000001',
    revoked: false,
    anyRecipient: false,
    spent: 0n,
    terms: {
      agent: '0x0000000000000000000000000000000000000002',
      agentId: 0n,
      token: '0x0000000000000000000000000000000000000003',
      maxPerSpend: 100n * U,
      maxTotal: 300n * U,
      approvalThreshold: 50n * U,
      expiresAt: BigInt(NOW / 1000 + 3600),
      ...over,
    },
    ...extra,
  };
}

describe('usd', () => {
  it('muestra enteros sin decimales y fracciones sin ceros sobrantes', () => {
    expect(usd(20n * U)).toBe('20');
    expect(usd(1_500_000n)).toBe('1,5');
    expect(usd(1_050_000n)).toBe('1,05');
    expect(usd(0n)).toBe('0');
    expect(usd(1_234n * U)).toMatch(/^1[.\s ]?234$/);
  });
});

describe('parseUsd', () => {
  it('acepta coma o punto y devuelve unidades del token', () => {
    expect(parseUsd('100')).toBe(100n * U);
    expect(parseUsd('1,5')).toBe(1_500_000n);
    expect(parseUsd('1.5')).toBe(1_500_000n);
    expect(parseUsd(' 20 ')).toBe(20n * U);
    expect(parseUsd('0,000001')).toBe(1n);
  });

  it('rechaza lo que no es un monto positivo válido', () => {
    for (const bad of ['', 'abc', '0', '0,0', '-5', '1.1234567', '1,2,3', '1e3', '$5']) {
      expect(parseUsd(bad), bad).toBeNull();
    }
  });

  it('lo que usd() muestra, parseUsd() lo entiende de vuelta (montos de hasta dos decimales y menores de 1.000)', () => {
    for (const n of [1_500_000n, 75_250_000n, 20n * U, 999_990_000n, 10_000n]) {
      expect(parseUsd(usd(n)), usd(n)).toBe(n);
    }
  });
});

describe('tiempo', () => {
  it('ago', () => {
    expect(ago(BigInt(NOW / 1000), NOW)).toBe('ahora mismo');
    expect(ago(NOW / 1000 - 30, NOW)).toBe('hace 30 s');
    expect(ago(NOW / 1000 - 180, NOW)).toBe('hace 3 min');
    expect(ago(NOW / 1000 - 7200, NOW)).toBe('hace 2 h');
    expect(ago(NOW / 1000 - 200000, NOW)).toBe('hace 2 d');
    expect(ago(NOW / 1000 + 50, NOW)).toBe('ahora mismo');
  });

  it('remainingTime', () => {
    expect(remainingTime(BigInt(NOW / 1000 - 1), NOW)).toBe('vencido');
    expect(remainingTime(BigInt(NOW / 1000 + 30), NOW)).toBe('1 min');
    expect(remainingTime(BigInt(NOW / 1000 + 4 * 60), NOW)).toBe('4 min');
    expect(remainingTime(BigInt(NOW / 1000 + 23 * 3600 + 58 * 60), NOW)).toBe('23 h 58 min');
    expect(remainingTime(BigInt(NOW / 1000 + 3 * 86400 + 5 * 3600), NOW)).toBe('3 d 5 h');
  });
});

describe('isActive / isNever', () => {
  it('un permiso está activo solo si no está revocado, no venció y le queda saldo', () => {
    expect(isActive(permit(), NOW)).toBe(true);
    expect(isActive(permit({}, { revoked: true }), NOW)).toBe(false);
    expect(isActive(permit({ expiresAt: BigInt(NOW / 1000 - 1) }), NOW)).toBe(false);
    expect(isActive(permit({}, { spent: 300n * U }), NOW)).toBe(false);
    expect(isActive(permit({}, { spent: 299n * U }), NOW)).toBe(true);
  });

  it('el umbral máximo significa "nunca pedir aprobación"', () => {
    expect(isNever(NEVER)).toBe(true);
    expect(isNever(50n * U)).toBe(false);
  });
});

describe('scenarios (montos de las acciones de ejemplo)', () => {
  it('con los límites por defecto: pago pequeño, pasarse del máximo y un pago grande', () => {
    expect(scenarios(permit())).toEqual({ small: 25n * U, over: 150n * U, big: 75n * U });
  });

  it('sin umbral de aprobación no hay pago grande que pedir', () => {
    const s = scenarios(permit({ approvalThreshold: NEVER }));
    expect(s.big).toBeNull();
    expect(s.small).toBe(50n * U);
  });

  it('el pago pequeño siempre queda bajo el umbral, el de pasarse sobre el máximo y el grande entre los dos', () => {
    for (const [perSpend, threshold] of [[100n, 50n], [10n, 3n], [1000n, 1n], [5n, 4n]] as const) {
      const p = permit({ maxPerSpend: perSpend * U, approvalThreshold: threshold * U, maxTotal: 10_000n * U });
      const { small, over, big } = scenarios(p);
      expect(small, 'pequeño bajo el umbral').toBeLessThanOrEqual(threshold * U);
      expect(small).toBeGreaterThan(0n);
      expect(over, 'se pasa del máximo').toBeGreaterThan(perSpend * U);
      if (big !== null) {
        expect(big, 'grande sobre el umbral').toBeGreaterThan(threshold * U);
        expect(big, 'grande dentro del máximo').toBeLessThanOrEqual(perSpend * U);
      }
    }
  });
});

describe('blockedMessage', () => {
  const error = (code: string, args: unknown[]) => new AvalError(code, 'mensaje técnico', args);

  it('explica los bloqueos con los montos en tUSD, no en unidades crudas', () => {
    expect(blockedMessage(error('ExceedsPerSpendLimit', [150n * U, 100n * U]))).toBe(
      'El pago de 150 tUSD supera tu máximo por pago (100 tUSD).',
    );
    expect(blockedMessage(error('ExceedsTotalLimit', [80n * U, 20n * U]))).toContain('lo que queda de tu permiso (20 tUSD)');
    expect(blockedMessage(error('NeedsApproval', [75n * U, 50n * U]))).toContain('pedirte aprobación');
    expect(blockedMessage(error('NeedsApproval', [75n * U, 50n * U]))).not.toMatch(/\d{7,}/);
  });

  it('los demás códigos tienen un texto claro, y los desconocidos conservan el del contrato', () => {
    expect(blockedMessage(error('RecipientNotAllowed', []))).toContain('lista de tu permiso');
    expect(blockedMessage(error('PermitInactive', []))).toContain('revocado');
    expect(blockedMessage(error('OtroError', []))).toBe('mensaje técnico');
  });
});
