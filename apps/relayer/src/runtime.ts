import { AvalError } from '@aval/sdk';
import { BaseError, NonceTooHighError, NonceTooLowError, type PublicClient } from 'viem';
import { DailyCounter, type Limits, RelayerError, SlidingWindow } from './limits.js';

export type Context = { ip: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resumen corto de un error para el registro: viem incluye la transacción completa en `message`. */
export function briefly(error: unknown): string {
  if (error instanceof BaseError) {
    return `${error.shortMessage}${error.details ? ` — ${error.details}` : ''}`.slice(0, 300);
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/** ¿El envío falló porque otra transacción de la misma cuenta ya usó ese nonce? */
export function isNonceCollision(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  const found = error.walk(
    (e) =>
      e instanceof NonceTooLowError ||
      e instanceof NonceTooHighError ||
      // El RPC de Monad no dice "nonce too low" cuando dos envíos chocan: responde "An existing transaction had
      // higher priority" (visto en Monad testnet). Los demás mensajes son los habituales de Ethereum.
      /nonce too low|nonce too high|replacement transaction underpriced|already known|existing transaction had higher priority/i.test(
        e instanceof Error ? e.message : '',
      ),
  );
  return found !== null;
}

export const limited = (result: { ok: true } | { ok: false; retryAfterSeconds: number }, what: string) => {
  if (!result.ok) {
    throw new RelayerError(429, 'RateLimited', `Demasiadas solicitudes (${what}).`, result.retryAfterSeconds);
  }
};

export type RuntimeOptions = {
  publicClient: PublicClient;
  /** Cuenta que paga el gas de lo que se envíe por este runtime. */
  account: { address: `0x${string}` };
  limits: Limits;
  now?: () => number;
  /** Nombre para los mensajes de error y los registros. */
  label: string;
};

/**
 * Lo que protege a una cuenta que paga gas: límites por IP y por usuario, tope diario, saldo mínimo, una sola
 * transacción a la vez y reintento ante choques de nonce. Cada cuenta tiene su propio runtime, con su propia cola.
 */
export function createRuntime(options: RuntimeOptions) {
  const { publicClient, account, limits, label } = options;
  const now = options.now ?? Date.now;

  const perIp = new SlidingWindow(60_000);
  const perOwner = new SlidingWindow(60_000);
  const daily = new DailyCounter();

  // Una sola transacción a la vez: así el nonce de la cuenta nunca se pisa dentro de una instancia.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(() => task());
    tail = run.catch(() => undefined);
    return run;
  };

  return {
    now,
    daily,

    /** Comprobaciones que protegen los fondos de la cuenta, antes de gastar nada. */
    async guard(ctx: Context, ownerKey: string) {
      limited(perIp.hit(ctx.ip, limits.perIpPerMinute, now()), 'desde esta IP');
      limited(perOwner.hit(ownerKey.toLowerCase(), limits.perOwnerPerMinute, now()), 'para este usuario');

      if (daily.count(now()) >= limits.maxTransactionsPerDay) {
        throw new RelayerError(503, 'DailyLimitReached', `${label} alcanzó su límite diario. Inténtalo más tarde.`);
      }
      const balance = await publicClient.getBalance({ address: account.address });
      if (balance < limits.minBalanceWei) {
        throw new RelayerError(503, 'RelayerLowBalance', `${label} se quedó sin fondos para el gas.`);
      }
    },

    /**
     * Ejecuta una operación en la cadena y traduce los errores a respuestas seguras.
     *
     * Si el servicio corre en varias instancias a la vez (funciones serverless), la cola de arriba solo ordena los
     * envíos de una instancia: dos instancias pueden elegir el mismo nonce. Cuando eso pasa la transacción no llegó a
     * enviarse, así que repetirla es seguro.
     */
    async execute<T>(task: () => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await serial(task);
          daily.add(now());
          return result;
        } catch (error) {
          if (attempt < limits.maxNonceRetries && isNonceCollision(error)) {
            await sleep(150 * (attempt + 1) + Math.random() * 400);
            continue;
          }
          if (error instanceof RelayerError) throw error;
          // Un error de contrato (firma inválida, límite superado…) es culpa de la solicitud, no del servidor.
          if (error instanceof AvalError) throw new RelayerError(422, error.code, error.message);
          console.error(`[${label}] error inesperado:`, briefly(error));
          throw new RelayerError(500, 'Internal', 'Error interno del relayer.');
        }
      }
    },
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
