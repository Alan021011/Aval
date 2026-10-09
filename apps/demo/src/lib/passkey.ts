import type { WebAuthnClient } from '@category-labs/mera';
import { type AssertionProvider, type PasskeyPublicKey, browserAssertion, toBase64Url } from '@aval/sdk';
import { bytesToHex } from 'viem';

/**
 * Una "passkey" para la app: lo que Mera necesita para crear la cuenta, lo que el SDK necesita para pedir aprobaciones y
 * la clave pública P256 que se capturó al crearla. Hay dos formas:
 *
 * - `real`: la passkey del dispositivo (huella, rostro o PIN) con la extensión PRF.
 * - `simulated`: una clave de software guardada en este navegador, para dispositivos que no soportan PRF y para probar
 *   la interfaz sin un autenticador. NO es una passkey real y no cumple la prueba sin estado: la app lo avisa.
 */
export type Backend = {
  mode: 'real' | 'simulated';
  webAuthnClient: WebAuthnClient;
  assertionProvider: AssertionProvider;
  /** Clave P256 de la passkey recién creada (solo existe tras `createCredential`). */
  capturedKey(): PasskeyPublicKey | null;
  /** Cuántas veces se le pidió la huella al usuario desde que se creó este objeto. */
  prompts(): number;
};

const ES256 = -7;
const rpId = () => window.location.hostname;

const bytes = (source: BufferSource): Uint8Array<ArrayBuffer> =>
  source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: BufferSource } } };

/** Passkey real. Hace lo mismo que el cliente del navegador de Mera y además guarda la clave pública P256. */
export function realBackend(): Backend {
  let key: PasskeyPublicKey | null = null;
  let prompts = 0;

  const webAuthnClient: WebAuthnClient = {
    async createCredential(req) {
      prompts++;
      const cred = (await navigator.credentials.create({
        publicKey: {
          rp: req.rp,
          user: req.user,
          challenge: req.challenge,
          // Solo ES256: el precompile de Monad verifica P256, no RSA.
          pubKeyCredParams: [{ type: 'public-key', alg: ES256 }],
          ...(req.timeout !== undefined ? { timeout: req.timeout } : {}),
          attestation: req.attestation,
          authenticatorSelection: {
            residentKey: req.residentKey,
            requireResidentKey: true,
            userVerification: req.userVerification,
          },
          extensions: { prf: { eval: { first: req.prfSalt } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error('La passkey no se creó');

      const response = cred.response as AuthenticatorAttestationResponse;
      if (typeof response.getPublicKey !== 'function') throw new Error('Este navegador no expone la clave de la passkey');
      if (response.getPublicKeyAlgorithm() !== ES256) throw new Error('La passkey no usa P256 (ES256)');
      const spki = response.getPublicKey();
      if (!spki) throw new Error('La passkey no devolvió clave pública');
      const imported = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', imported));
      key = { x: bytesToHex(raw.slice(1, 33)), y: bytesToHex(raw.slice(33, 65)) };

      const prf = (cred.getClientExtensionResults() as PrfResults).prf;
      const first = prf?.results?.first;
      const transports = response.getTransports?.() as WebAuthnClient.CreateCredentialResult['transports'];
      return {
        credentialId: new Uint8Array(cred.rawId),
        ...(transports ? { transports } : {}),
        prfEnabled: prf?.enabled === true,
        ...(first ? { prfOutput: bytes(first) } : {}),
      };
    },

    async getCredential(req) {
      prompts++;
      const allowed = req.allowCredential;
      const cred = (await navigator.credentials.get({
        publicKey: {
          rpId: req.rpId,
          challenge: req.challenge,
          ...(req.timeout !== undefined ? { timeout: req.timeout } : {}),
          userVerification: req.userVerification,
          extensions: { prf: { eval: { first: req.prfSalt } } } as AuthenticationExtensionsClientInputs,
          ...(allowed
            ? {
                allowCredentials: [
                  {
                    type: 'public-key' as const,
                    id: allowed.credentialId,
                    ...(allowed.transports ? { transports: allowed.transports as AuthenticatorTransport[] } : {}),
                  },
                ],
              }
            : {}),
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error('La passkey no respondió');
      const first = (cred.getClientExtensionResults() as PrfResults).prf?.results?.first;
      return { credentialId: new Uint8Array(cred.rawId), ...(first ? { prfOutput: bytes(first) } : {}) };
    },
  };

  const assertionProvider: AssertionProvider = (request) => {
    prompts++;
    return browserAssertion({ ...request, rpId: rpId() });
  };

  return { mode: 'real', webAuthnClient, assertionProvider, capturedKey: () => key, prompts: () => prompts };
}

// ---------------------------------------------------------------------------------------------------------------------

const STORAGE_KEY = 'aval.simulated-passkey.v1';

type Stored = { secret: string; privateKey: JsonWebKey; credentialId: string };

const toHex = (data: Uint8Array) => bytesToHex(data).slice(2);
const fromHex = (text: string) => Uint8Array.from(text.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

/** ¿Hay una cuenta de prueba guardada en este navegador? */
export const hasSimulatedAccount = () => load() !== null;
export const forgetSimulatedAccount = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // sin almacenamiento disponible: no hay nada que borrar
  }
};

/** Firma ECDSA de WebCrypto (r ‖ s, 64 bytes) → formato DER, que es lo que entrega un autenticador real. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const integer = (part: Uint8Array) => {
    let start = 0;
    while (start < part.length - 1 && part[start] === 0) start++;
    const value = part.slice(start);
    const padded = (value[0] ?? 0) & 0x80 ? Uint8Array.from([0, ...value]) : value;
    return Uint8Array.from([0x02, padded.length, ...padded]);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32, 64));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

async function publicKeyOf(privateKey: JsonWebKey): Promise<PasskeyPublicKey> {
  const decode = (v: string) => bytesToHex(Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
  return { x: decode(privateKey.x as string) as `0x${string}`, y: decode(privateKey.y as string) as `0x${string}` };
}

/** Passkey simulada: una clave P-256 y un secreto para el PRF, guardados en este navegador. */
export function simulatedBackend(): Backend {
  let key: PasskeyPublicKey | null = null;
  let prompts = 0;

  const prf = async (secret: string, salt: Uint8Array<ArrayBuffer>) => {
    const hmac = await crypto.subtle.importKey('raw', fromHex(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', hmac, salt));
  };

  const webAuthnClient: WebAuthnClient = {
    async createCredential(req) {
      prompts++;
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
      const credentialId = crypto.getRandomValues(new Uint8Array(32));
      const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ secret, privateKey, credentialId: toBase64Url(credentialId) } satisfies Stored),
      );
      key = await publicKeyOf(privateKey);
      return { credentialId, prfEnabled: true, prfOutput: await prf(secret, req.prfSalt) };
    },

    async getCredential(req) {
      prompts++;
      const stored = load();
      if (!stored) throw new Error('No hay una cuenta de prueba en este navegador.');
      const credentialId = Uint8Array.from(atob(stored.credentialId.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      return { credentialId, prfOutput: await prf(stored.secret, req.prfSalt) };
    },
  };

  const assertionProvider: AssertionProvider = async ({ challenge }) => {
    prompts++;
    const stored = load();
    if (!stored) throw new Error('No hay una cuenta de prueba en este navegador.');
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({ type: 'webauthn.get', challenge: toBase64Url(challenge), origin: window.location.origin, crossOrigin: false }),
    );
    const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId())));
    // sha256(rpId) ‖ banderas (usuario presente + verificado) ‖ contador
    const authenticatorData = Uint8Array.from([...rpHash, 0x05, 0, 0, 0, 0]);
    const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
    const signingKey = await crypto.subtle.importKey('jwk', stored.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    // WebAuthn firma authenticatorData ‖ sha256(clientDataJSON); ECDSA aplica el sha256 final.
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, Uint8Array.from([...authenticatorData, ...clientHash])),
    );
    return { authenticatorData, clientDataJSON, signature: rawToDer(raw) };
  };

  return { mode: 'simulated', webAuthnClient, assertionProvider, capturedKey: () => key, prompts: () => prompts };
}
