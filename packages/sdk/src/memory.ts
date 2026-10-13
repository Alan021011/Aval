import { type Address, type Hex, bytesToHex, hexToBytes, keccak256, sha256, stringToBytes } from 'viem';
import { memoryVaultAbi } from './abi.js';
import { type Ctx, type Sent, read, requireWallet, send } from './context.js';
import { AvalError } from './errors.js';

/**
 * Memoria cifrada con la passkey ("one passkey, many keys").
 *
 * La passkey da, además de la cuenta, un segundo secreto con su propio salt de PRF (`MEMORY_PRF_SALT`): la **raíz de la
 * memoria**. De esa raíz salen, con HKDF, claves separadas:
 *  - una clave para la memoria privada del usuario;
 *  - una clave **por agente y por versión** para la parte que el usuario comparte con ese agente.
 * Compartir es darle al agente su clave de esa versión. Revocar es subir la versión y volver a cifrar: la clave vieja
 * deja de servir para lo nuevo. Todo se cifra con AES-GCM en el dispositivo y se guarda en `MemoryVault`, un
 * almacenamiento remoto no confiable: la cadena solo ve bytes cifrados, y la misma passkey en otro dispositivo
 * reproduce la raíz y descifra lo mismo.
 */

/** Salt de PRF del namespace de la memoria. Distinto del de la cuenta: otra clave de la misma passkey. */
export const MEMORY_PRF_SALT: Uint8Array<ArrayBuffer> = hexToBytes(sha256(stringToBytes('aval/memory/v1'))).slice();

/** Casillero de la memoria privada del usuario. */
export const privateMemorySlot: Hex = keccak256(stringToBytes('aval/memory/private'));

/** Casillero de la parte de la memoria compartida con un agente. */
export const agentMemorySlot = (agent: Address): Hex => keccak256(stringToBytes(`aval/memory/agent/${agent.toLowerCase()}`));

const FORMAT = 1;
const HEADER = 5; // formato (1 byte) + versión (4 bytes)
const IV = 12;
const subtle = () => globalThis.crypto.subtle;
const utf8 = (text: string) => new TextEncoder().encode(text);

async function hkdf(root: Uint8Array<ArrayBuffer>, info: string): Promise<Uint8Array<ArrayBuffer>> {
  const base = await subtle().importKey('raw', root, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: utf8('aval/memory'), info: utf8(info) }, base, 256);
  return new Uint8Array(bits);
}

/** Claves de la memoria derivadas de la raíz (el segundo secreto PRF de la passkey). Nunca salen del dispositivo, salvo
 * la clave de un agente cuando el usuario decide compartir con él. */
export function deriveMemoryKeys(root: Uint8Array) {
  if (root.length < 32) throw new AvalError('InvalidMemoryRoot', 'La raíz de la memoria debe tener al menos 32 bytes.');
  const secret = root.slice();
  return {
    /** Clave de la memoria privada del usuario. */
    privateKey: () => hkdf(secret, 'aval/memory/private/v1'),
    /** Clave de la parte compartida con `agent` en la versión `version` (cada revocación sube la versión). */
    agentKey: (agent: Address, version: number) => hkdf(secret, `aval/memory/agent/${agent.toLowerCase()}/v${version}`),
  };
}

export type MemoryKeys = ReturnType<typeof deriveMemoryKeys>;

function header(version: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(version) || version < 0 || version > 0xffffffff) {
    throw new AvalError('InvalidMemoryVersion', 'La versión de la memoria debe ser un entero de 0 a 2^32-1.');
  }
  const out = new Uint8Array(HEADER);
  out[0] = FORMAT;
  new DataView(out.buffer).setUint32(1, version);
  return out;
}

async function aesKey(key: Uint8Array, usage: 'encrypt' | 'decrypt') {
  if (key.length !== 32) throw new AvalError('InvalidMemoryKey', 'La clave de la memoria debe tener 32 bytes.');
  return subtle().importKey('raw', key.slice(), 'AES-GCM', false, [usage]);
}

/**
 * Cifra `plaintext` con AES-GCM. Resultado: formato ‖ versión ‖ iv ‖ cifrado. La versión va en claro (para saber con
 * qué clave abrirlo) pero autenticada: cambiarla rompe el descifrado.
 */
export async function sealMemory(key: Uint8Array, version: number, plaintext: string): Promise<Hex> {
  const head = header(version);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV));
  const ciphertext = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: head }, await aesKey(key, 'encrypt'), utf8(plaintext)),
  );
  return bytesToHex(Uint8Array.from([...head, ...iv, ...ciphertext]));
}

/** Versión con la que se cifró un dato guardado. */
export function sealedVersion(sealed: Hex): number {
  const data = hexToBytes(sealed);
  if (data.length < HEADER + IV + 16 || data[0] !== FORMAT) throw new AvalError('InvalidMemoryData', 'No es memoria cifrada de Aval.');
  return new DataView(data.buffer, data.byteOffset).getUint32(1);
}

/** Descifra. Falla con `MemoryKeyMismatch` si la clave no corresponde (por ejemplo, una clave de agente revocada). */
export async function openMemory(key: Uint8Array, sealed: Hex): Promise<string> {
  sealedVersion(sealed);
  const data = hexToBytes(sealed);
  const head = data.slice(0, HEADER);
  const iv = data.slice(HEADER, HEADER + IV);
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: head }, await aesKey(key, 'decrypt'), data.slice(HEADER + IV));
    return new TextDecoder().decode(plain);
  } catch {
    throw new AvalError('MemoryKeyMismatch', 'Esta clave no abre esa memoria: no corresponde o fue revocada.');
  }
}

// ---- Almacenamiento en la cadena (MemoryVault) ----

export type SignedStore = { owner: Address; slot: Hex; data: Hex; deadline: bigint; signature: Hex };

const storeTypes = {
  Store: [
    { name: 'owner', type: 'address' },
    { name: 'slot', type: 'bytes32' },
    { name: 'dataHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function createMemory(ctx: Ctx) {
  const vault = (): Address => {
    const address = ctx.addresses.memoryVault;
    if (!address) throw new AvalError('NoMemoryVault', 'Esta red no tiene un MemoryVault configurado.');
    return address;
  };
  const now = () => BigInt(Math.floor(Date.now() / 1000));

  return {
    /** Bytes cifrados de un casillero (`0x` si está vacío). Cualquiera los puede leer: solo son útiles con la clave. */
    read: (owner: Address, slot: Hex): Promise<Hex> =>
      read<Hex>(ctx, { address: vault(), abi: memoryVaultAbi, functionName: 'get', args: [owner, slot] }),

    /** Guarda un casillero propio (la cuenta paga el gas). */
    store: (slot: Hex, data: Hex): Promise<Sent> =>
      send(ctx, { address: vault(), abi: memoryVaultAbi, functionName: 'store', args: [slot, data] }),

    /** El usuario firma la escritura sin gastar gas; un relayer la envía con `relayStore`. */
    async signStore(slot: Hex, data: Hex, options: { deadline?: bigint } = {}): Promise<SignedStore> {
      const wallet = requireWallet(ctx);
      const owner = wallet.account.address;
      const deadline = options.deadline ?? now() + 3600n;
      const nonce = await read<bigint>(ctx, { address: vault(), abi: memoryVaultAbi, functionName: 'nonces', args: [owner] });
      const signature = await wallet.signTypedData({
        account: wallet.account,
        domain: { name: 'Aval MemoryVault', version: '1', chainId: ctx.addresses.chainId, verifyingContract: vault() },
        types: storeTypes,
        primaryType: 'Store',
        message: { owner, slot, dataHash: keccak256(data), nonce, deadline },
      });
      return { owner, slot, data, deadline, signature };
    },

    relayStore: (signed: SignedStore): Promise<Sent> =>
      send(ctx, {
        address: vault(),
        abi: memoryVaultAbi,
        functionName: 'storeFor',
        args: [signed.owner, signed.slot, signed.data, signed.deadline, signed.signature],
      }),
  };
}

export type Memory = ReturnType<typeof createMemory>;
