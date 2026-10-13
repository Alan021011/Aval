import { bytesToHex, hexToBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_PRF_SALT,
  agentMemorySlot,
  deriveMemoryKeys,
  openMemory,
  privateMemorySlot,
  sealMemory,
  sealedVersion,
} from '../src/index.js';

const root = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + seed) & 0xff);
const AGENT = '0xc20AA331Dfc089aF212626757F649FaE2284BE2F';
const OTHER = '0x0000000000000000000000000000000000000abc';

describe('memoria cifrada: claves', () => {
  it('la misma raíz da las mismas claves (otro dispositivo con la misma passkey)', async () => {
    const a = deriveMemoryKeys(root(1));
    const b = deriveMemoryKeys(root(1));
    expect(bytesToHex(await a.privateKey())).toBe(bytesToHex(await b.privateKey()));
    expect(bytesToHex(await a.agentKey(AGENT, 1))).toBe(bytesToHex(await b.agentKey(AGENT, 1)));
  });

  it('cada namespace tiene su propia clave: privada, por agente y por versión', async () => {
    const keys = deriveMemoryKeys(root(1));
    const all = [
      await keys.privateKey(),
      await keys.agentKey(AGENT, 1),
      await keys.agentKey(AGENT, 2),
      await keys.agentKey(OTHER, 1),
      await deriveMemoryKeys(root(2)).privateKey(),
    ].map((k) => bytesToHex(k));
    expect(new Set(all).size).toBe(all.length);
  });

  it('la dirección del agente no distingue mayúsculas', async () => {
    const keys = deriveMemoryKeys(root(1));
    expect(bytesToHex(await keys.agentKey(AGENT, 1))).toBe(bytesToHex(await keys.agentKey(AGENT.toLowerCase() as `0x${string}`, 1)));
    expect(agentMemorySlot(AGENT)).toBe(agentMemorySlot(AGENT.toLowerCase() as `0x${string}`));
  });

  it('salt del namespace y casilleros fijos', () => {
    expect(MEMORY_PRF_SALT.length).toBe(32);
    expect(privateMemorySlot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(agentMemorySlot(AGENT)).not.toBe(privateMemorySlot);
  });

  it('rechaza una raíz demasiado corta', () => {
    expect(() => deriveMemoryKeys(new Uint8Array(16))).toThrow('al menos 32 bytes');
  });
});

describe('memoria cifrada: cifrar, compartir y revocar', () => {
  it('cifra y descifra; lo guardado no contiene el texto', async () => {
    const key = await deriveMemoryKeys(root(1)).privateKey();
    const sealed = await sealMemory(key, 0, 'Prefiero vuelos de mañana');
    expect(sealed).not.toContain(bytesToHex(new TextEncoder().encode('vuelos')).slice(2));
    expect(await openMemory(key, sealed)).toBe('Prefiero vuelos de mañana');
    expect(sealedVersion(sealed)).toBe(0);
  });

  it('cifrar dos veces lo mismo da resultados distintos (iv aleatorio)', async () => {
    const key = await deriveMemoryKeys(root(1)).privateKey();
    expect(await sealMemory(key, 0, 'x')).not.toBe(await sealMemory(key, 0, 'x'));
  });

  it('el agente abre su parte con su clave; tras revocar, su clave vieja ya no sirve', async () => {
    const keys = deriveMemoryKeys(root(1));
    const v1 = await keys.agentKey(AGENT, 1);
    const shared = await sealMemory(v1, 1, 'Presupuesto de viaje: 300 USD');
    expect(await openMemory(v1, shared)).toBe('Presupuesto de viaje: 300 USD');

    // Revocar: se vuelve a cifrar con la versión 2. La clave que tenía el agente (v1) no la abre.
    const v2 = await keys.agentKey(AGENT, 2);
    const reshared = await sealMemory(v2, 2, 'Presupuesto de viaje: 300 USD');
    expect(sealedVersion(reshared)).toBe(2);
    await expect(openMemory(v1, reshared)).rejects.toThrow('no corresponde o fue revocada');
    expect(await openMemory(v2, reshared)).toBe('Presupuesto de viaje: 300 USD');
  });

  it('otro agente o la clave privada no abren la parte de un agente', async () => {
    const keys = deriveMemoryKeys(root(1));
    const shared = await sealMemory(await keys.agentKey(AGENT, 1), 1, 'solo para este agente');
    await expect(openMemory(await keys.agentKey(OTHER, 1), shared)).rejects.toThrow('no corresponde');
    await expect(openMemory(await keys.privateKey(), shared)).rejects.toThrow('no corresponde');
  });

  it('alterar la versión en claro o un byte del cifrado rompe el descifrado', async () => {
    const key = await deriveMemoryKeys(root(1)).agentKey(AGENT, 3);
    const sealed = hexToBytes(await sealMemory(key, 3, 'intacto'));
    const bumped = sealed.slice();
    bumped[4] = 9; // versión 3 → 9
    await expect(openMemory(key, bytesToHex(bumped))).rejects.toThrow('no corresponde');
    const flipped = sealed.slice();
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 1;
    await expect(openMemory(key, bytesToHex(flipped))).rejects.toThrow('no corresponde');
  });

  it('rechaza datos que no son memoria de Aval', async () => {
    const key = await deriveMemoryKeys(root(1)).privateKey();
    await expect(openMemory(key, '0x1234')).rejects.toThrow('No es memoria cifrada de Aval');
  });
});
