import {
  type AvalAddresses,
  AvalError,
  type SignedGrant,
  type SignedRegister,
  type SignedRevoke,
  type SignedTokenPermit,
  type WebAuthnAuth,
  createAval,
} from '@aval/sdk';
import { type Address, type Hash, type PublicClient, type WalletClient, formatEther } from 'viem';
import { DailyCounter, type Limits, RelayerError, SlidingWindow } from './limits.js';
import type { RelayKind } from './schemas.js';

export type RelayerOptions = {
  publicClient: PublicClient;
  /** Cuenta del relayer: la única que paga el gas. Nunca se usa para nada más. */
  walletClient: WalletClient;
  addresses: AvalAddresses;
  limits: Limits;
  /** Reloj inyectable para las pruebas. */
  now?: () => number;
};

type Payloads = {
  register: SignedRegister;
  grant: SignedGrant;
  revoke: SignedRevoke;
  'token-permit': SignedTokenPermit;
  approve: { requestId: bigint; auth: WebAuthnAuth };
};

type Context = { ip: string };

/**
 * Relayer de Aval. Recibe lo que el usuario firmó y lo envía pagando el gas. Nunca recibe claves privadas, y solo
 * puede hacer las cinco operaciones de abajo con los contratos de Aval: no envía datos arbitrarios.
 */
export function createRelayer(options: RelayerOptions) {
  const { publicClient, walletClient, addresses, limits } = options;
  const now = options.now ?? Date.now;
  const account = walletClient.account;
  if (!account) throw new Error('El relayer necesita un walletClient con cuenta');

  const aval = createAval({ publicClient, walletClient, addresses });
  const allowedTokens = limits.allowedTokens.map((t) => t.toLowerCase());

  const perIp = new SlidingWindow(60_000);
  const perOwner = new SlidingWindow(60_000);
  const faucetByAddress = new SlidingWindow(limits.faucetCooldownSeconds * 1000);
  const faucetByIp = new SlidingWindow(limits.faucetCooldownSeconds * 1000);
  const daily = new DailyCounter();

  // Una sola transacción a la vez: así el nonce del relayer nunca se pisa.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(() => task());
    tail = run.catch(() => undefined);
    return run;
  };

  const limited = (result: { ok: true } | { ok: false; retryAfterSeconds: number }, what: string) => {
    if (!result.ok) {
      throw new RelayerError(429, 'RateLimited', `Demasiadas solicitudes (${what}).`, result.retryAfterSeconds);
    }
  };

  /** Comprobaciones que protegen los fondos del relayer, antes de gastar nada. */
  async function guard(ctx: Context, ownerKey: string) {
    limited(perIp.hit(ctx.ip, limits.perIpPerMinute, now()), 'desde esta IP');
    limited(perOwner.hit(ownerKey.toLowerCase(), limits.perOwnerPerMinute, now()), 'para este usuario');

    if (daily.count(now()) >= limits.maxTransactionsPerDay) {
      throw new RelayerError(503, 'DailyLimitReached', 'El relayer alcanzó su límite diario. Inténtalo más tarde.');
    }
    const balance = await publicClient.getBalance({ address: account!.address });
    if (balance < limits.minBalanceWei) {
      throw new RelayerError(503, 'RelayerLowBalance', 'El relayer se quedó sin fondos para el gas.');
    }
  }

  const requireFutureDeadline = (deadline: bigint) => {
    if (deadline <= BigInt(Math.floor(now() / 1000))) {
      throw new RelayerError(400, 'ExpiredSignature', 'La firma venció: genera otra con una fecha límite más lejana.');
    }
  };

  const requireAllowedToken = (token: Address) => {
    if (!allowedTokens.includes(token.toLowerCase())) {
      throw new RelayerError(400, 'TokenNotAllowed', 'Este relayer no trabaja con ese token.');
    }
  };

  /** Ejecuta una operación en la cadena y traduce los errores a respuestas seguras. */
  async function execute<T>(task: () => Promise<T>): Promise<T> {
    try {
      const result = await serial(task);
      daily.add(now());
      return result;
    } catch (error) {
      if (error instanceof RelayerError) throw error;
      // Un error de contrato (firma inválida, límite superado…) es culpa de la solicitud, no del servidor.
      if (error instanceof AvalError) throw new RelayerError(422, error.code, error.message);
      console.error('[relayer] error inesperado:', error instanceof Error ? error.message : error);
      throw new RelayerError(500, 'Internal', 'Error interno del relayer.');
    }
  }

  return {
    address: account.address,

    async relay<K extends RelayKind>(kind: K, payload: Payloads[K], ctx: Context): Promise<{ hash: Hash; permitId?: bigint }> {
      switch (kind) {
        case 'register': {
          const p = payload as Payloads['register'];
          await guard(ctx, p.owner);
          requireFutureDeadline(p.deadline);
          return execute(async () => ({ hash: (await aval.passkeys.relayRegister(p)).hash }));
        }
        case 'grant': {
          const p = payload as Payloads['grant'];
          await guard(ctx, p.owner);
          requireFutureDeadline(p.deadline);
          requireAllowedToken(p.input.token);
          return execute(async () => {
            const { hash, permitId } = await aval.permits.relayGrant(p);
            return { hash, permitId };
          });
        }
        case 'revoke': {
          const p = payload as Payloads['revoke'];
          // La firma de revocar no dice quién es el dueño: lo leemos del permiso para limitar por usuario.
          const owner = await aval.permits.get(p.permitId).then((permit) => permit.owner).catch(() => ctx.ip);
          await guard(ctx, owner);
          requireFutureDeadline(p.deadline);
          return execute(async () => ({ hash: (await aval.permits.relayRevoke(p)).hash }));
        }
        case 'token-permit': {
          const p = payload as Payloads['token-permit'];
          await guard(ctx, p.owner);
          requireFutureDeadline(p.deadline);
          requireAllowedToken(p.token);
          return execute(async () => ({ hash: (await aval.tokens.relayPermit(p)).hash }));
        }
        case 'approve': {
          const p = payload as Payloads['approve'];
          await guard(ctx, `approve:${p.requestId}`);
          return execute(async () => ({ hash: (await aval.permits.submitApproval(p.requestId, p.auth)).hash }));
        }
        default:
          throw new RelayerError(404, 'UnknownOperation', 'Operación desconocida.');
      }
    },

    /** Entrega tUSD de prueba. Una vez por dirección y por IP en cada ventana de espera. */
    async faucet(to: Address, ctx: Context): Promise<{ hash: Hash; amount: bigint }> {
      limited(faucetByIp.hit(ctx.ip, 1, now()), 'el faucet ya te entregó fondos desde esta IP');
      limited(faucetByAddress.hit(to.toLowerCase(), 1, now()), 'el faucet ya entregó fondos a esta dirección');
      await guard(ctx, `faucet:${to}`);
      return execute(async () => ({
        hash: (await aval.tokens.faucet({ to, amount: limits.faucetAmount })).hash,
        amount: limits.faucetAmount,
      }));
    },

    async health() {
      const balance = await publicClient.getBalance({ address: account.address });
      return {
        ok: balance >= limits.minBalanceWei,
        relayer: account.address,
        chainId: addresses.chainId,
        balance: formatEther(balance),
        transactionsToday: daily.count(now()),
      };
    },
  };
}

export type Relayer = ReturnType<typeof createRelayer>;
