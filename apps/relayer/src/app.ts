import { deserialize, serialize } from '@aval/sdk';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { type Limits, RelayerError } from './limits.js';
import { type Relayer, briefly } from './relayer.js';
import { faucetSchema, isRelayKind, schemas } from './schemas.js';

export type AppOptions = {
  relayer: Relayer;
  limits: Limits;
  /** Orígenes del navegador que pueden llamar al relayer. */
  allowedOrigins: string[];
  /** Solo activarlo detrás de un proxy de confianza: si no, cualquiera podría falsear su IP y saltarse los límites. */
  trustProxy?: boolean;
};

const json = (c: Context, data: unknown, status: 200 | 400 | 404 | 413 | 422 | 429 | 500 | 503 = 200, headers: Record<string, string> = {}) =>
  c.body(serialize(data), status, { 'content-type': 'application/json', ...headers });

const fail = (c: Context, error: RelayerError) =>
  json(
    c,
    { error: { code: error.code, message: error.message } },
    error.status as 400 | 404 | 422 | 429 | 500 | 503,
    error.retryAfterSeconds ? { 'retry-after': String(error.retryAfterSeconds) } : {},
  );

/** IP del cliente. Sin `trustProxy` se ignoran las cabeceras `x-forwarded-for`, que el cliente puede falsear. */
function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
}

export function createApp({ relayer, limits, allowedOrigins, trustProxy = false }: AppOptions) {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['content-type'],
      maxAge: 600,
    }),
  );

  app.get('/health', async (c) => json(c, await relayer.health()));

  app.post(
    '/relay/:kind',
    bodyLimit({
      maxSize: limits.maxBodyBytes,
      onError: (c) => fail(c, new RelayerError(413, 'BodyTooLarge', 'La solicitud es demasiado grande.')),
    }),
    async (c) => {
      const kind = c.req.param('kind');
      if (!isRelayKind(kind)) return fail(c, new RelayerError(404, 'UnknownOperation', 'Operación desconocida.'));

      let payload: unknown;
      try {
        payload = schemas[kind].parse(deserialize(await c.req.text()));
      } catch (error) {
        return fail(c, badRequest(error));
      }

      try {
        // El tipo del payload depende de `kind`, que ya se validó contra su esquema.
        const result = await relayer.relay(kind, payload as never, { ip: clientIp(c, trustProxy) });
        return json(c, result);
      } catch (error) {
        return fail(c, asRelayerError(error));
      }
    },
  );

  app.post(
    '/faucet',
    bodyLimit({
      maxSize: limits.maxBodyBytes,
      onError: (c) => fail(c, new RelayerError(413, 'BodyTooLarge', 'La solicitud es demasiado grande.')),
    }),
    async (c) => {
      let to;
      try {
        to = faucetSchema.parse(deserialize(await c.req.text())).to;
      } catch (error) {
        return fail(c, badRequest(error));
      }
      try {
        return json(c, await relayer.faucet(to, { ip: clientIp(c, trustProxy) }));
      } catch (error) {
        return fail(c, asRelayerError(error));
      }
    },
  );

  app.notFound((c) => fail(c, new RelayerError(404, 'NotFound', 'Ruta desconocida.')));
  app.onError((error, c) => {
    console.error('[relayer] error no controlado:', briefly(error));
    return fail(c, new RelayerError(500, 'Internal', 'Error interno del relayer.'));
  });

  return app;
}

function badRequest(error: unknown): RelayerError {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const where = first?.path.join('.') || 'solicitud';
    return new RelayerError(400, 'InvalidRequest', `Solicitud inválida en "${where}".`);
  }
  return new RelayerError(400, 'InvalidRequest', 'La solicitud no es un JSON válido.');
}

function asRelayerError(error: unknown): RelayerError {
  if (error instanceof RelayerError) return error;
  console.error('[relayer] error inesperado:', briefly(error));
  return new RelayerError(500, 'Internal', 'Error interno del relayer.');
}
