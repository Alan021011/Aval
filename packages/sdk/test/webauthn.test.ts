import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesToHex, concat, keccak256, pad } from 'viem';
import { monadTestnet } from '../src/addresses.js';
import { recipientsHash, toRef } from '../src/permits.js';
import { P256_N, buildAuth, derToRS, fromBase64Url, toBase64Url } from '../src/webauthn.js';
import { simulatedPasskey } from './helpers.js';

const HALF_N = P256_N / 2n;

/** Firma DER construida a mano para controlar r y s. */
function der(r: bigint, s: bigint): Uint8Array {
  const entero = (v: bigint) => {
    let hex = v.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    let bytes = Buffer.from(hex, 'hex');
    if (bytes[0]! & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
    return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
  };
  const cuerpo = Buffer.concat([entero(r), entero(s)]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x30, cuerpo.length]), cuerpo]));
}

describe('derToRS', () => {
  it('deja intacta una firma con s bajo', () => {
    const { r, s } = derToRS(der(12345n, 678n));
    expect(BigInt(r)).toBe(12345n);
    expect(BigInt(s)).toBe(678n);
  });

  it('convierte s alto en su forma baja (n - s)', () => {
    const sAlto = HALF_N + 1000n;
    const { s } = derToRS(der(777n, sAlto));
    expect(BigInt(s)).toBe(P256_N - sAlto);
    expect(BigInt(s)).toBeLessThanOrEqual(HALF_N);
  });

  it('devuelve r y s de 32 bytes aunque el DER los traiga más cortos o con un cero delante', () => {
    const { r, s } = derToRS(der(1n, (1n << 255n) - 1n));
    expect(r).toHaveLength(66);
    expect(s).toHaveLength(66);
  });

  it('rechaza firmas mal formadas o fuera de rango', () => {
    expect(() => derToRS(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => derToRS(der(0n, 5n))).toThrow();
    expect(() => derToRS(der(5n, P256_N))).toThrow();
  });

  it('con firmas reales de Node siempre da s bajo, sea cual sea la forma que salga', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    let vistoAlto = false;
    for (let i = 0; i < 60; i++) {
      const firma = new Uint8Array(sign('sha256', Buffer.from(`mensaje ${i}`), { key: privateKey, dsaEncoding: 'der' }));
      const crudo = BigInt(bytesToHex(firma.slice(-32)));
      if (crudo > HALF_N) vistoAlto = true;
      expect(BigInt(derToRS(firma).s)).toBeLessThanOrEqual(HALF_N);
    }
    // En 60 firmas es prácticamente imposible que ninguna salga alta: así el caso sí se ejercitó.
    expect(vistoAlto).toBe(true);
  });
});

describe('buildAuth', () => {
  it('ubica challenge y type dentro del clientDataJSON', async () => {
    const { provider } = simulatedPasskey();
    const challenge = new Uint8Array(32).fill(7);
    const auth = buildAuth(await provider({ challenge }));

    expect(auth.clientDataJSON.slice(Number(auth.challengeIndex)).startsWith('"challenge":"')).toBe(true);
    expect(auth.clientDataJSON.slice(Number(auth.typeIndex)).startsWith('"type":"webauthn.get"')).toBe(true);
    expect(auth.clientDataJSON).toContain(toBase64Url(challenge));
    expect(BigInt(auth.s)).toBeLessThanOrEqual(HALF_N);
  });

  it('rechaza un clientDataJSON que no es una aserción webauthn.get', () => {
    const raw = {
      authenticatorData: new Uint8Array(37),
      clientDataJSON: new TextEncoder().encode('{"type":"webauthn.create","challenge":"abc"}'),
      signature: der(1n, 2n),
    };
    expect(() => buildAuth(raw)).toThrow(/webauthn\.get/);
  });
});

describe('base64url', () => {
  it('va y vuelve sin relleno', () => {
    for (const largo of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length: largo }, (_, i) => (i * 37 + 11) % 256);
      const texto = toBase64Url(bytes);
      expect(texto).not.toMatch(/[+/=]/);
      expect(fromBase64Url(texto)).toEqual(bytes);
    }
  });
});

describe('referencias y destinatarios', () => {
  it('toRef acepta texto corto, hex de 32 bytes y vacío', () => {
    expect(toRef('pedido-1')).toHaveLength(66);
    const hex = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
    expect(toRef(hex)).toBe(hex);
    expect(toRef()).toBe('0x' + '00'.repeat(32));
  });

  it('toRef rechaza más de 32 bytes', () => {
    expect(() => toRef('x'.repeat(33))).toThrow(/32 bytes/);
  });

  it('recipientsHash replica abi.encodePacked(address[]) de Solidity (32 bytes por dirección)', () => {
    const a = '0x1111111111111111111111111111111111111111';
    const b = '0x2222222222222222222222222222222222222222';
    expect(recipientsHash([])).toBe(keccak256('0x'));
    expect(recipientsHash([a, b])).toBe(keccak256(concat([pad(a, { size: 32 }), pad(b, { size: 32 })])));
  });
});

describe('direcciones del despliegue', () => {
  it('coinciden con contracts/deployments/monad-testnet.json', () => {
    const json = JSON.parse(
      readFileSync(new URL('../../../contracts/deployments/monad-testnet.json', import.meta.url), 'utf8'),
    );
    expect(monadTestnet.chainId).toBe(json.chainId);
    expect(monadTestnet.passkeyRegistry).toBe(json.contracts.PasskeyRegistry);
    expect(monadTestnet.agentPermit).toBe(json.contracts.AgentPermit);
    expect(monadTestnet.reputationReader).toBe(json.contracts.ReputationReader);
    expect(monadTestnet.testUsd).toBe(json.contracts.TestUSD);
  });
});

