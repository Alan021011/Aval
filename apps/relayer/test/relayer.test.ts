import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AvalError, createAval, createRelayerClient, monadTestnet, serialize } from '@aval/sdk';
import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  BaseError,
  NonceTooLowError,
  parseEther,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { simulatedPasskey, startAnvil } from '../../../packages/sdk/test/helpers.js';
import { createDemoAgent } from '../src/agent.js';
import { createApp } from '../src/app.js';
import { type Limits, defaultLimits } from '../src/limits.js';
import { createRelayer } from '../src/relayer.js';

/**
 * Pruebas del relayer contra los contratos desplegados, sobre una copia local de Monad testnet (anvil).
 * Se saltan si anvil no está instalado. Las claves son nuevas en cada corrida: las cuentas públicas de anvil tienen
 * delegaciones EIP-7702 en Monad testnet y no sirven como EOAs.
 */
const PORT = 8549;
const RPC = `http://127.0.0.1:${PORT}`;
const chain = defineChain({
  id: 10143,
  name: 'Monad Testnet (copia local)',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const relayerKey = generatePrivateKey();
const agentKey = generatePrivateKey();
const serviceKey = generatePrivateKey();
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const wallet = (key: `0x${string}`) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(RPC) });
const newUser = () => wallet(generatePrivateKey());

const TUSD = monadTestnet.testUsd as Address;
const SHOP: Address = '0x00000000000000000000000000000000000000A1';
let anvil: ChildProcess | null = null;

const generous: Limits = {
  ...defaultLimits([TUSD]),
  perIpPerMinute: 1000,
  perOwnerPerMinute: 1000,
  faucetCooldownSeconds: 3600,
};

/** Un relayer nuevo con los límites que se pidan, y un cliente del SDK conectado a él sin pasar por la red. */
function setup(overrides: Partial<Limits> = {}, ip = '10.0.0.1') {
  const limits = { ...generous, ...overrides };
  const relayer = createRelayer({
    publicClient,
    walletClient: wallet(relayerKey),
    addresses: monadTestnet,
    limits,
  });
  const app = createApp({ relayer, limits, allowedOrigins: ['http://localhost:5173'], trustProxy: true });
  const fetchAs = (clientIp: string) => (url: string, init: RequestInit) =>
    app.request(url, { ...init, headers: { ...(init.headers as Record<string, string>), 'x-forwarded-for': clientIp } });
  const client = createRelayerClient({ url: 'http://relayer.test', fetch: fetchAs(ip) as never });
  return { app, relayer, limits, client, clientFrom: (clientIp: string) => createRelayerClient({ url: 'http://relayer.test', fetch: fetchAs(clientIp) as never }) };
}

beforeAll(async () => {
  anvil = await startAnvil(PORT, 'https://testnet-rpc.monad.xyz');
  if (anvil) {
    const test = createTestClient({ chain, mode: 'anvil', transport: http(RPC) });
    await test.setBalance({ address: privateKeyToAccount(relayerKey).address, value: parseEther('100') });
    await test.setBalance({ address: privateKeyToAccount(agentKey).address, value: parseEther('100') });
    await test.setBalance({ address: privateKeyToAccount(serviceKey).address, value: parseEther('100') });
  }
}, 120_000);

afterAll(() => {
  anvil?.kill();
});

const needAnvil = (ctx: { skip: (note?: string) => never }) => {
  if (!anvil) ctx.skip('anvil no está disponible');
};

const errorOf = (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => e as AvalError);

describe('flujo completo sin que el usuario tenga MON', () => {
  it('registrar passkey, recibir tUSD, crear permiso, aprobar con huella y revocar: todo lo envía el relayer', async (ctx) => {
    needAnvil(ctx);
    const { client, relayer } = setup();
    const user = newUser();
    const userAddress = user.account.address;
    const passkey = simulatedPasskey();
    const asUser = createAval({ publicClient, walletClient: user, assertionProvider: passkey.provider });
    const asAgent = createAval({ publicClient, walletClient: wallet(agentKey) });
    const agentAddress = privateKeyToAccount(agentKey).address;
    const relayerBalanceBefore = await publicClient.getBalance({ address: relayer.address });

    // El usuario no tiene MON.
    expect(await publicClient.getBalance({ address: userAddress })).toBe(0n);

    // 1. Recibe dólares de prueba del faucet del relayer.
    const faucet = await client.faucet(userAddress);
    expect(faucet.amount).toBe(500_000_000n);
    expect(await asUser.tokens.balanceOf(userAddress)).toBe(500_000_000n);

    // 2. Registra su passkey con una firma.
    await client.register(await asUser.passkeys.signRegister(passkey.key));
    expect(await asUser.passkeys.keyOf(userAddress)).toEqual(passkey.key);

    // 3. Autoriza a AgentPermit a mover tUSD con una firma ERC-2612.
    await client.tokenPermit(await asUser.tokens.signPermit({ value: 300_000_000n }));

    // 4. Crea el permiso con una firma.
    const { permitId } = await client.grant(
      await asUser.permits.signGrant({
        agent: agentAddress,
        maxPerSpend: 100_000_000n,
        maxTotal: 300_000_000n,
        approvalThreshold: 50_000_000n,
        expiresIn: 3600,
        recipients: [SHOP],
      }),
    );
    expect((await asAgent.permits.get(permitId)).owner).toBe(userAddress);

    // 5. El agente gasta dentro del límite y pide un gasto grande.
    await asAgent.permits.spend({ permitId, to: SHOP, amount: 10_000_000n, ref: 'pedido-1' });
    const { requestId } = await asAgent.permits.requestSpend({ permitId, to: SHOP, amount: 80_000_000n, ref: 'grande' });

    // 6. El usuario aprueba con su huella y el relayer envía la aprobación.
    const auth = await asUser.permits.signApproval(requestId);
    await client.approve(requestId, auth);
    expect(await asUser.tokens.balanceOf(SHOP)).toBe(90_000_000n);

    // 7. El usuario revoca con una firma.
    await client.revoke(await asUser.permits.signRevoke(permitId));
    expect(await asAgent.permits.remaining(permitId)).toBe(0n);

    // El usuario nunca gastó ni un MON; el gas lo pagó el relayer.
    expect(await publicClient.getBalance({ address: userAddress })).toBe(0n);
    expect(await publicClient.getBalance({ address: relayer.address })).toBeLessThan(relayerBalanceBefore);
  });

  it('envía varias operaciones a la vez sin pisar el nonce', async (ctx) => {
    needAnvil(ctx);
    const { clientFrom } = setup();
    const users = Array.from({ length: 5 }, () => newUser());
    const results = await Promise.all(users.map((u, i) => clientFrom(`10.1.0.${i}`).faucet(u.account.address)));

    expect(new Set(results.map((r) => r.hash)).size).toBe(5);
    for (const u of users) {
      const balance = await createAval({ publicClient }).tokens.balanceOf(u.account.address);
      expect(balance).toBe(500_000_000n);
    }
  });
});

describe('rechaza lo que no debe enviar', () => {
  it('una firma de otra cuenta no gasta gas ni envía nada', async (ctx) => {
    needAnvil(ctx);
    const { client, relayer } = setup();
    const victim = newUser();
    const attacker = createAval({ publicClient, walletClient: newUser() });
    const signedByAttacker = await attacker.passkeys.signRegister(simulatedPasskey().key);
    const forged = { ...signedByAttacker, owner: victim.account.address };

    const nonceBefore = await publicClient.getTransactionCount({ address: relayer.address });
    const error = await errorOf(client.register(forged));

    expect(error?.code).toBe('InvalidSignature');
    expect(await publicClient.getTransactionCount({ address: relayer.address })).toBe(nonceBefore);
  });

  it('una firma vencida se rechaza antes de tocar la cadena', async (ctx) => {
    needAnvil(ctx);
    const { client } = setup();
    const user = createAval({ publicClient, walletClient: newUser() });
    const old = BigInt(Math.floor(Date.now() / 1000) - 60);
    const error = await errorOf(client.register(await user.passkeys.signRegister(simulatedPasskey().key, { deadline: old })));

    expect(error?.code).toBe('ExpiredSignature');
  });

  it('no trabaja con tokens que no están en la lista permitida', async (ctx) => {
    needAnvil(ctx);
    const { client } = setup();
    const user = createAval({ publicClient, walletClient: newUser() });
    const grant = await user.permits.signGrant({
      agent: privateKeyToAccount(agentKey).address,
      token: '0x000000000000000000000000000000000000dEaD',
      maxPerSpend: 1n,
      maxTotal: 1n,
      approvalThreshold: null,
      expiresIn: 3600,
    });
    expect((await errorOf(client.grant(grant)))?.code).toBe('TokenNotAllowed');

    // Un atacante no usa el SDK: arma la solicitud a mano con un token cualquiera.
    const forged = {
      token: '0x000000000000000000000000000000000000dEaD' as Address,
      owner: privateKeyToAccount(agentKey).address,
      value: 1n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      signature: `0x${'11'.repeat(65)}` as `0x${string}`,
    };
    expect((await errorOf(client.tokenPermit(forged)))?.code).toBe('TokenNotAllowed');
  });

  it('rechaza solicitudes mal formadas, con campos de más o demasiado grandes', async (ctx) => {
    needAnvil(ctx);
    const { app } = setup();
    const post = (path: string, body: string) =>
      app.request(`http://relayer.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

    expect((await post('/relay/grant', 'esto no es json')).status).toBe(400);
    expect((await post('/relay/register', serialize({ owner: 'nope' }))).status).toBe(400);
    const extra = serialize({ owner: '0x00000000000000000000000000000000000000A1', key: { x: `0x${'1'.repeat(64)}`, y: `0x${'2'.repeat(64)}` }, deadline: 9999999999n, signature: '0x00', admin: true });
    expect((await post('/relay/register', extra)).status).toBe(400);
    expect((await post('/relay/transfer-all-funds', '{}')).status).toBe(404);
    expect((await post('/relay/grant', 'x'.repeat(40_000))).status).toBe(413);
    expect((await post('/faucet', serialize({ to: 'no-es-una-direccion' }))).status).toBe(400);
  });
});

describe('protege los fondos del relayer', () => {
  it('limita las solicitudes por IP y avisa cuánto esperar', async (ctx) => {
    needAnvil(ctx);
    const { client } = setup({ perIpPerMinute: 3 });
    const user = createAval({ publicClient, walletClient: newUser() });
    const old = BigInt(Math.floor(Date.now() / 1000) - 60);
    const signed = await user.passkeys.signRegister(simulatedPasskey().key, { deadline: old });

    for (let i = 0; i < 3; i++) expect((await errorOf(client.register(signed)))?.code).toBe('ExpiredSignature');
    const error = await errorOf(client.register(signed));
    expect(error?.code).toBe('RateLimited');
    expect(error?.message).toMatch(/Reintenta en \d+ s/);
  });

  it('otra IP no queda bloqueada por la primera', async (ctx) => {
    needAnvil(ctx);
    const { clientFrom } = setup({ perIpPerMinute: 1 });
    const user = createAval({ publicClient, walletClient: newUser() });
    const signed = await user.passkeys.signRegister(simulatedPasskey().key, { deadline: 1n });

    expect((await errorOf(clientFrom('10.2.0.1').register(signed)))?.code).toBe('ExpiredSignature');
    expect((await errorOf(clientFrom('10.2.0.1').register(signed)))?.code).toBe('RateLimited');
    expect((await errorOf(clientFrom('10.2.0.2').register(signed)))?.code).toBe('ExpiredSignature');
  });

  it('el faucet entrega una sola vez por dirección y por IP', async (ctx) => {
    needAnvil(ctx);
    const { clientFrom } = setup();
    const user = newUser().account.address;

    await clientFrom('10.3.0.1').faucet(user);
    expect((await errorOf(clientFrom('10.3.0.2').faucet(user)))?.code).toBe('RateLimited');
    expect((await errorOf(clientFrom('10.3.0.1').faucet(newUser().account.address)))?.code).toBe('RateLimited');
  });

  it('se detiene al llegar al límite diario de transacciones', async (ctx) => {
    needAnvil(ctx);
    const { clientFrom } = setup({ maxTransactionsPerDay: 1 });
    await clientFrom('10.4.0.1').faucet(newUser().account.address);
    const error = await errorOf(clientFrom('10.4.0.2').faucet(newUser().account.address));

    expect(error?.code).toBe('DailyLimitReached');
  });

  it('deja de enviar cuando el saldo baja del mínimo, en vez de vaciarse', async (ctx) => {
    needAnvil(ctx);
    const { client, app } = setup({ minBalanceWei: parseEther('1000000') });
    const error = await errorOf(client.faucet(newUser().account.address));
    const health = await (await app.request('http://relayer.test/health')).json();

    expect(error?.code).toBe('RelayerLowBalance');
    expect(health.ok).toBe(false);
  });
});

describe('superficie del servicio', () => {
  it('informa su estado sin revelar secretos', async (ctx) => {
    needAnvil(ctx);
    const { app, relayer } = setup();
    const response = await app.request('http://relayer.test/health');
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: true, relayer: relayer.address, chainId: 10143 });
    expect(text).not.toContain(relayerKey.slice(2));
  });

  it('los errores no filtran detalles internos ni la clave', async (ctx) => {
    needAnvil(ctx);
    const { app } = setup();
    const response = await app.request('http://relayer.test/relay/grant', { method: 'POST', body: 'basura' });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain(relayerKey.slice(2));
    expect(text).not.toMatch(/stack|at .*\.ts/);
  });

  it('solo permite llamadas desde los orígenes autorizados (CORS)', async (ctx) => {
    needAnvil(ctx);
    const { app } = setup();
    const allowed = await app.request('http://relayer.test/health', { headers: { origin: 'http://localhost:5173' } });
    const other = await app.request('http://relayer.test/health', { headers: { origin: 'https://sitio-malicioso.example' } });

    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('choques de nonce entre instancias (como en funciones serverless)', () => {
  /**
   * Un walletClient cuyos primeros `failures` envíos fallan con un error de choque, como si otra instancia se hubiera
   * adelantado. Por defecto es el error estándar de Ethereum; `monad` usa el que devuelve de verdad el RPC de Monad
   * testnet (visto en producción): un error genérico de parámetros con el detalle "An existing transaction had higher
   * priority", que viem no clasifica como error de nonce.
   */
  function collidingWallet(failures: number, kind: 'ethereum' | 'monad' = 'ethereum') {
    const real = wallet(relayerKey);
    let calls = 0;
    const collision = () =>
      kind === 'ethereum'
        ? new NonceTooLowError({ nonce: 1 })
        : new BaseError('Missing or invalid parameters.', { details: 'An existing transaction had higher priority' });
    const flaky = { ...real, writeContract: (...args: Parameters<typeof real.writeContract>) => {
      calls++;
      if (calls <= failures) throw collision();
      return real.writeContract(...args);
    } } as typeof real;
    return { flaky, calls: () => calls };
  }

  function setupWith(walletClient: ReturnType<typeof wallet>, limits: Partial<Limits>) {
    const full = { ...generous, ...limits };
    const relayer = createRelayer({ publicClient, walletClient, addresses: monadTestnet, limits: full });
    const app = createApp({ relayer, limits: full, allowedOrigins: [], trustProxy: true });
    return createRelayerClient({
      url: 'http://relayer.test',
      fetch: ((url: string, init: RequestInit) =>
        app.request(url, { ...init, headers: { ...(init.headers as Record<string, string>), 'x-forwarded-for': '10.7.0.1' } })) as never,
    });
  }

  it('reintenta y termina enviando cuando el nonce chocó', async (ctx) => {
    needAnvil(ctx);
    const { flaky, calls } = collidingWallet(2);
    const client = setupWith(flaky, { maxNonceRetries: 4 });
    const target = newUser().account.address;

    const result = await client.faucet(target);

    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(calls()).toBe(3); // dos intentos chocaron y el tercero entró
    expect(await createAval({ publicClient }).tokens.balanceOf(target)).toBe(500_000_000n);
  });

  it('reconoce el error real de Monad ("An existing transaction had higher priority") y reintenta', async (ctx) => {
    needAnvil(ctx);
    const { flaky, calls } = collidingWallet(2, 'monad');
    const client = setupWith(flaky, { maxNonceRetries: 4 });
    const target = newUser().account.address;

    await client.faucet(target);

    expect(calls()).toBe(3);
    expect(await createAval({ publicClient }).tokens.balanceOf(target)).toBe(500_000_000n);
  });

  it('no reintenta para siempre: tras el límite responde error', async (ctx) => {
    needAnvil(ctx);
    const { flaky, calls } = collidingWallet(10);
    const client = setupWith(flaky, { maxNonceRetries: 1 });

    const error = await errorOf(client.faucet(newUser().account.address));

    expect(error?.code).toBe('Internal');
    expect(calls()).toBe(2); // el intento original más un reintento
  });

  it('un error que no es de nonce no se reintenta', async (ctx) => {
    needAnvil(ctx);
    const { client } = setup({ maxNonceRetries: 4 });
    const user = createAval({ publicClient, walletClient: newUser() });
    const forged = { ...(await user.passkeys.signRegister(simulatedPasskey().key)), owner: newUser().account.address };

    // Firma de otro: se rechaza con InvalidSignature sin repetir nada.
    expect((await errorOf(client.register(forged)))?.code).toBe('InvalidSignature');
  });

  it('dos instancias con la misma cuenta enviando a la vez: todas las operaciones llegan', async (ctx) => {
    needAnvil(ctx);
    const a = setup({ maxNonceRetries: 6 });
    const b = setup({ maxNonceRetries: 6 });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        errorOf((i % 2 === 0 ? a : b).clientFrom(`10.6.0.${i}`).faucet(newUser().account.address)),
      ),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(0);
  });
});

describe('agente de demostración', () => {
  const serviceAddress = privateKeyToAccount(serviceKey).address;
  const agentAddress = privateKeyToAccount(agentKey).address;
  let serviceAgentId = 0n;

  /** Un relayer con agente de demostración. El servicio se registra una sola vez en ERC-8004. */
  async function setupAgent(overrides: Partial<Limits> = {}) {
    if (serviceAgentId === 0n) {
      const registered = await createAval({ publicClient, walletClient: wallet(serviceKey) }).agents.register();
      serviceAgentId = registered.agentId;
    }
    const limits = { ...generous, ...overrides };
    const relayer = createRelayer({ publicClient, walletClient: wallet(relayerKey), addresses: monadTestnet, limits });
    const agent = createDemoAgent({
      publicClient,
      walletClient: wallet(agentKey),
      addresses: monadTestnet,
      limits,
      service: { address: serviceAddress, agentId: serviceAgentId },
    });
    const app = createApp({ relayer, agent, limits, allowedOrigins: [], trustProxy: true });
    const client = createRelayerClient({
      url: 'http://relayer.test',
      fetch: ((url: string, init: RequestInit) =>
        app.request(url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), 'x-forwarded-for': '10.8.0.1' },
        })) as never,
    });
    return { app, client };
  }

  /** Un usuario sin MON con un permiso para el agente de demostración, todo creado a través del relayer. */
  async function userWithPermit(client: ReturnType<typeof createRelayerClient>) {
    const user = newUser();
    const passkey = simulatedPasskey();
    const aval = createAval({ publicClient, walletClient: user, assertionProvider: passkey.provider });
    // El faucet del relayer limita por IP; para no depender de ese límite se da saldo directo desde el contrato.
    await createAval({ publicClient, walletClient: wallet(relayerKey) }).tokens.faucet({
      to: user.account.address,
      amount: 500_000_000n,
    });
    await client.register(await aval.passkeys.signRegister(passkey.key));
    await client.tokenPermit(await aval.tokens.signPermit({ value: 300_000_000n }));
    const { permitId } = await client.grant(
      await aval.permits.signGrant({
        agent: agentAddress,
        maxPerSpend: 100_000_000n,
        maxTotal: 300_000_000n,
        approvalThreshold: 50_000_000n,
        expiresIn: 3600,
        recipients: [serviceAddress],
      }),
    );
    return { user, aval, permitId };
  }

  it('informa su dirección, su saldo y el servicio al que le paga', async (ctx) => {
    needAnvil(ctx);
    const { client } = await setupAgent();
    const info = await client.agent.info();

    expect(info.address).toBe(agentAddress);
    expect(info.service).toEqual({ address: serviceAddress, agentId: serviceAgentId });
    expect(info.ready).toBe(true);
    expect(info.token).toBe(TUSD);
  });

  it('flujo completo: paga dentro del límite, se topa con los límites, pide aprobación y recibe una reseña', async (ctx) => {
    needAnvil(ctx);
    const { client } = await setupAgent();
    const { user, aval, permitId } = await userWithPermit(client);
    const owner = user.account.address;
    const balanceOfService = () => aval.tokens.balanceOf(serviceAddress);
    const before = await balanceOfService();

    // 1. Un pago pequeño pasa sin aprobación.
    await client.agent.spend({ permitId, amount: 20_000_000n, ref: 'traduccion-1' });
    expect((await balanceOfService()) - before).toBe(20_000_000n);

    // 2. Pasarse del máximo por pago lo rechaza el contrato, con un mensaje claro y sin gastar.
    const tooMuch = await errorOf(client.agent.spend({ permitId, amount: 150_000_000n }));
    expect(tooMuch?.code).toBe('ExceedsPerSpendLimit');

    // 3. Sobre el umbral de aprobación, el pago directo se rechaza y el agente debe pedir permiso.
    const direct = await errorOf(client.agent.spend({ permitId, amount: 80_000_000n }));
    expect(direct?.code).toBe('NeedsApproval');
    const { requestId } = await client.agent.request({ permitId, amount: 80_000_000n, ref: 'traduccion-grande' });
    expect((await aval.permits.getRequest(requestId)).status).toBe(1);
    expect((await balanceOfService()) - before).toBe(20_000_000n);

    // 4. El usuario aprueba con su huella y el relayer envía la aprobación.
    await client.approve(requestId, await aval.permits.signApproval(requestId));
    expect((await balanceOfService()) - before).toBe(100_000_000n);

    // 5. El agente reseña al servicio; cuenta porque ya le pagó.
    await client.agent.review({ value: 90 });
    const summary = await aval.reputation.summary(serviceAgentId, { tag1: 'calidad' });
    expect(summary.value).toBe(90n);
    expect(summary.verifiedClients).toBeGreaterThanOrEqual(2n);

    // 6. Todo queda en el historial del usuario, reconstruido solo desde la cadena.
    const receipts = await createAval({ publicClient }).permits.receiptsOf(owner);
    expect(receipts.map((r) => r.amount)).toEqual([20_000_000n, 80_000_000n]);
    expect(receipts[1]!.requestId).toBe(requestId);
  });

  it('el agente solo gasta con permisos que el usuario le dio a su cuenta', async (ctx) => {
    needAnvil(ctx);
    const { client } = await setupAgent();
    const wallet2 = newUser();
    const user = createAval({ publicClient, walletClient: wallet2 });
    await createAval({ publicClient, walletClient: wallet(relayerKey) }).tokens.faucet({
      to: wallet2.account.address,
      amount: 10_000_000n,
    });
    await client.tokenPermit(await user.tokens.signPermit({ value: 10_000_000n }));
    // Un permiso para OTRO agente: el agente de demostración no puede usarlo.
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    const { permitId } = await client.grant(
      await user.permits.signGrant({
        agent: stranger,
        maxPerSpend: 10_000_000n,
        maxTotal: 10_000_000n,
        approvalThreshold: null,
        expiresIn: 3600,
      }),
    );

    expect((await errorOf(client.agent.spend({ permitId, amount: 1_000_000n })))?.code).toBe('NotAgent');
  });

  it('rechaza solicitudes mal formadas del agente', async (ctx) => {
    needAnvil(ctx);
    const { app } = await setupAgent();
    const post = (path: string, body: unknown) =>
      app.request(`http://relayer.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : serialize(body),
      });

    expect((await post('/agent/spend', { permitId: 1n, amount: 0n })).status).toBe(400);
    expect((await post('/agent/spend', { permitId: 1n, amount: 5n, ref: 'x'.repeat(40) })).status).toBe(400);
    // No hay forma de elegir a quién se le paga: un campo `to` se rechaza.
    expect((await post('/agent/spend', { permitId: 1n, amount: 5n, to: '0x0000000000000000000000000000000000000001' })).status).toBe(400);
    expect((await post('/agent/review', { value: 101 })).status).toBe(400);
    expect((await post('/agent/review', { value: 50, tag: 'DROP TABLE' })).status).toBe(400);
    expect((await post('/agent/spend', 'basura')).status).toBe(400);
  });

  it('sin agente configurado, sus rutas responden 404', async (ctx) => {
    needAnvil(ctx);
    const { app } = setup();
    const info = await app.request('http://relayer.test/agent/info');
    const spend = await app.request('http://relayer.test/agent/spend', { method: 'POST', body: '{}' });

    expect(info.status).toBe(404);
    expect(spend.status).toBe(404);
    expect((await info.json()).error.code).toBe('DemoAgentDisabled');
  });

  it('se detiene cuando al agente le queda poco gas', async (ctx) => {
    needAnvil(ctx);
    const { client } = await setupAgent({ agentMinBalanceWei: parseEther('1000000') });

    expect((await errorOf(client.agent.spend({ permitId: 1n, amount: 1n })))?.code).toBe('RelayerLowBalance');
    expect((await client.agent.info()).ready).toBe(false);
  });
});
