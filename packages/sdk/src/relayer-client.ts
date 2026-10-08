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

    const error = (data as { error?: { code?: string; message?: string } }).error;
    const retry = response.headers.get('retry-after');
    const extra = retry ? ` Reintenta en ${retry} s.` : '';
    throw new AvalError(
      error?.code ?? `Http${response.status}`,
      `${error?.message ?? 'El relayer rechazó la solicitud.'}${extra}`,
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
    /** Pide dólares de prueba (tUSD) para una dirección. Tiene tiempo de espera por dirección. */
    faucet: (to: Address) => call<{ hash: Hash; amount: bigint }>('POST', '/faucet', { to }),
  };
}

export type RelayerClient = ReturnType<typeof createRelayerClient>;
