import type { Address, Hash } from 'viem';
import { AvalError } from './errors.js';
import type { SignedRegister } from './passkeys.js';
import type { SignedGrant, SignedRevoke } from './permits.js';
import type { SignedTokenPermit } from './tokens.js';
import { deserialize, serialize } from './wire.js';
import type { WebAuthnAuth } from './webauthn.js';

export type RelayerFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type RelayerHealth = {
  ok: boolean;
  relayer: Address;
  chainId: number;
  balance: string;
  transactionsToday: number;
};

/** Datos del agente de demostración de un relayer. `ready` es falso si se quedó sin gas. */
export type DemoAgentInfo = {
  address: Address;
  /** Servicio al que el agente le paga: un agente de ERC-8004 cuya billetera recibe los pagos. */
  service: { address: Address; agentId: bigint };
  token?: Address;
  balance: string;
  ready: boolean;
};

/**
 * Cliente de un relayer de Aval: le envías lo que el usuario firmó y él paga el gas, así el usuario no necesita MON.
 * El relayer nunca recibe claves privadas, solo firmas que no sirven para nada distinto a lo firmado.
 */
export function createRelayerClient(options: { url: string; fetch?: RelayerFetch }) {
  const base = options.url.replace(/\/+$/, '');
  const doFetch: RelayerFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: serialize(body) }),
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = deserialize(text);
    } catch {
      throw new AvalError('RelayerBadResponse', `El relayer respondió algo inesperado (HTTP ${response.status}).`);
    }
    if (response.status >= 200 && response.status < 300) return data as T;

    const error = (data as { error?: { code?: string; message?: string; args?: unknown } }).error;
    const retry = response.headers.get('retry-after');
    const extra = retry ? ` Reintenta en ${retry} s.` : '';
    throw new AvalError(
      error?.code ?? `Http${response.status}`,
      `${error?.message ?? 'El relayer rechazó la solicitud.'}${extra}`,
      Array.isArray(error?.args) ? error.args : [],
    );
  }

  return {
    health: () => call<RelayerHealth>('GET', '/health'),
    /** Registra la clave P256 del usuario con su firma. */
    register: (signed: SignedRegister) => call<{ hash: Hash }>('POST', '/relay/register', signed),
    /** Crea un permiso con la firma del usuario. */
    grant: (signed: SignedGrant) => call<{ hash: Hash; permitId: bigint }>('POST', '/relay/grant', signed),
    /** Revoca un permiso con la firma del usuario. */
    revoke: (signed: SignedRevoke) => call<{ hash: Hash }>('POST', '/relay/revoke', signed),
    /** Autoriza a AgentPermit a mover un token con la firma ERC-2612 del usuario. */
    tokenPermit: (signed: SignedTokenPermit) => call<{ hash: Hash }>('POST', '/relay/token-permit', signed),
    /** Envía la aprobación con passkey de un gasto pendiente. */
    approve: (requestId: bigint, auth: WebAuthnAuth) => call<{ hash: Hash }>('POST', '/relay/approve', { requestId, auth }),
    /**
     * Agente de demostración del relayer: hace de agente de IA del usuario. El usuario le da un permiso (con su
     * dirección `info().address` como agente) y estas acciones muestran qué hace el contrato en cada caso.
     * Solo paga al servicio fijo que indica `info().service`.
     */
    agent: {
      info: () => call<DemoAgentInfo>('GET', '/agent/info'),
      /** Paga dentro del permiso. Si el monto supera el umbral o los límites, el contrato lo rechaza y el error lo explica. */
      spend: (input: { permitId: bigint; amount: bigint; ref?: string }) => call<{ hash: Hash }>('POST', '/agent/spend', input),
      /** Pide un pago que supera el umbral: queda pendiente hasta que el usuario lo apruebe con su huella. */
      request: (input: { permitId: bigint; amount: bigint; ref?: string }) =>
        call<{ hash: Hash; requestId: bigint }>('POST', '/agent/request', input),
      /** Reseña al servicio (de 0 a 100). Solo cuenta en la reputación verificada si el agente ya le pagó. */
      review: (input: { value: number; tag?: string }) => call<{ hash: Hash }>('POST', '/agent/review', input),
    },
    /** Pide dólares de prueba (tUSD) para una dirección. Tiene tiempo de espera por dirección. */
    faucet: (to: Address) => call<{ hash: Hash; amount: bigint }>('POST', '/faucet', { to }),
  };
}

export type RelayerClient = ReturnType<typeof createRelayerClient>;
