import type { WebAuthnClient } from '@category-labs/mera';
import { bytesToHex, concat, type Hex, sha256 } from 'viem';
import { clientePublico, PRECOMPILE_P256 } from './monad';

export type ClaveP256 = { x: Hex; y: Hex };

export type Aprobacion = {
  hash: Hex;
  r: Hex;
  s: Hex;
  authenticatorData: Hex;
  clientDataJSON: string;
};

type ResultadosPrf = { prf?: { enabled?: boolean; results?: { first?: BufferSource } } };

const ES256 = -7;

export const rpId = () => window.location.hostname;

// Cliente WebAuthn para Mera que hace lo mismo que el cliente del navegador de Mera y,
// además, guarda la clave pública P256 de la passkey. Así la clave sale de la misma
// ceremonia de creación, sin un segundo prompt.
export function clienteConCaptura() {
  let clave: ClaveP256 | null = null;
  let ceremonias = 0;

  const cliente: WebAuthnClient = {
    async createCredential(req) {
      ceremonias++;
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

      const resp = cred.response as AuthenticatorAttestationResponse;
      clave = await claveDesdeRespuesta(resp);
      const prf = (cred.getClientExtensionResults() as ResultadosPrf).prf;
      const first = prf?.results?.first;
      const transports = resp.getTransports?.() as WebAuthnClient.CreateCredentialResult['transports'];

      return {
        credentialId: new Uint8Array(cred.rawId),
        ...(transports ? { transports } : {}),
        prfEnabled: prf?.enabled === true,
        ...(first ? { prfOutput: aBytes(first) } : {}),
      };
    },

    async getCredential(req) {
      ceremonias++;
      const permitida = req.allowCredential;
      const cred = (await navigator.credentials.get({
        publicKey: {
          rpId: req.rpId,
          challenge: req.challenge,
          ...(req.timeout !== undefined ? { timeout: req.timeout } : {}),
          userVerification: req.userVerification,
          extensions: { prf: { eval: { first: req.prfSalt } } } as AuthenticationExtensionsClientInputs,
          ...(permitida
            ? {
                allowCredentials: [{
                  type: 'public-key' as const,
                  id: permitida.credentialId,
                  ...(permitida.transports ? { transports: permitida.transports as AuthenticatorTransport[] } : {}),
                }],
              }
            : {}),
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error('La passkey no respondió');

      const first = (cred.getClientExtensionResults() as ResultadosPrf).prf?.results?.first;
      return {
        credentialId: new Uint8Array(cred.rawId),
        ...(first ? { prfOutput: aBytes(first) } : {}),
      };
    },
  };

  return { cliente, clave: () => clave, ceremonias: () => ceremonias };
}

// Ceremonia propia para aprobar una acción: el desafío es el hash de la acción, que es lo
// que el contrato comprobará. Mera no sirve aquí porque genera su propio desafío.
export async function firmarAprobacion(credentialId: string, desafio: Uint8Array<ArrayBuffer>): Promise<Aprobacion> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      rpId: rpId(),
      challenge: desafio,
      allowCredentials: [{ type: 'public-key', id: base64UrlABytes(credentialId) }],
      userVerification: 'required',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No se firmó la aprobación');

  const resp = cred.response as AuthenticatorAssertionResponse;
  const authData = new Uint8Array(resp.authenticatorData);
  const clientData = new Uint8Array(resp.clientDataJSON);
  const { r, s } = firmaDerARS(new Uint8Array(resp.signature));

  return {
    // WebAuthn firma sha256(authenticatorData ‖ sha256(clientDataJSON)).
    hash: sha256(concat([authData, sha256(clientData, 'bytes')])),
    r: bytesToHex(r),
    s: bytesToHex(s),
    authenticatorData: bytesToHex(authData),
    clientDataJSON: new TextDecoder().decode(clientData),
  };
}

// Llama al precompile de Monad testnet. Devuelve 1 si la firma es válida y vacío si no.
export async function verificarEnMonad(hash: Hex, r: Hex, s: Hex, clave: ClaveP256): Promise<boolean> {
  const { data } = await clientePublico.call({
    to: PRECOMPILE_P256,
    data: concat([hash, r, s, clave.x, clave.y]),
  });
  return data !== undefined && data !== '0x' && BigInt(data) === 1n;
}

// Lo que el contrato tendrá que revisar además de la firma.
export function revisarAprobacion(apr: Aprobacion, desafio: Uint8Array) {
  const datos = JSON.parse(apr.clientDataJSON) as { type?: string; challenge?: string; origin?: string };
  const banderas = parseInt(apr.authenticatorData.slice(2 + 64, 2 + 66), 16);
  return {
    tipoCorrecto: datos.type === 'webauthn.get',
    desafioCoincide: datos.challenge === bytesABase64Url(desafio),
    usuarioPresente: (banderas & 0x01) !== 0,
    usuarioVerificado: (banderas & 0x04) !== 0,
    origen: datos.origin ?? '',
  };
}

async function claveDesdeRespuesta(resp: AuthenticatorAttestationResponse): Promise<ClaveP256> {
  if (typeof resp.getPublicKey !== 'function') throw new Error('Este navegador no expone la clave pública de la passkey');
  if (resp.getPublicKeyAlgorithm() !== ES256) throw new Error('La passkey no usa P256 (ES256)');
  const spki = resp.getPublicKey();
  if (!spki) throw new Error('La passkey no devolvió clave pública');

  const llave = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  const cruda = new Uint8Array(await crypto.subtle.exportKey('raw', llave));
  // Formato sin comprimir: 0x04 ‖ x (32 bytes) ‖ y (32 bytes).
  return { x: bytesToHex(cruda.slice(1, 33)), y: bytesToHex(cruda.slice(33, 65)) };
}

// La firma WebAuthn viene en DER: 30 len 02 lenR R 02 lenS S.
function firmaDerARS(der: Uint8Array) {
  if (der[0] !== 0x30) throw new Error('Firma con formato inesperado');
  let i = 2;
  const leerEntero = () => {
    if (der[i] !== 0x02) throw new Error('Firma con formato inesperado');
    const largo = der[i + 1];
    const valor = der.slice(i + 2, i + 2 + largo);
    i += 2 + largo;
    return a32Bytes(valor);
  };
  const r = leerEntero();
  const s = leerEntero();
  return { r, s };
}

function a32Bytes(entero: Uint8Array) {
  let inicio = 0;
  while (inicio < entero.length - 1 && entero[inicio] === 0) inicio++;
  const sinCeros = entero.slice(inicio);
  if (sinCeros.length > 32) throw new Error('Componente de firma demasiado largo');
  const salida = new Uint8Array(32);
  salida.set(sinCeros, 32 - sinCeros.length);
  return salida;
}

function aBytes(fuente: BufferSource) {
  return fuente instanceof ArrayBuffer
    ? new Uint8Array(fuente)
    : new Uint8Array(fuente.buffer, fuente.byteOffset, fuente.byteLength).slice();
}

export function bytesABase64Url(bytes: Uint8Array) {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlABytes(texto: string) {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((texto.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
