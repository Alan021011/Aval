import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  parseEther,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { type Aval, AvalError, createAval, erc8004MonadTestnet } from '../src/index.js';
import { simulatedPasskey, startAnvil } from './helpers.js';

/**
 * Prueba de punta a punta: levanta una copia local de Monad testnet con anvil y recorre el flujo completo contra los
 * contratos ya desplegados, con una passkey simulada. Se salta si anvil no está instalado o no hay red.
 */
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const chain = defineChain({
  id: 10143,
  name: 'Monad Testnet (copia local)',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const roles = ['relayer', 'owner', 'agent', 'service', 'sybil'] as const;
// Claves nuevas en cada corrida. Las cuentas públicas de anvil NO sirven aquí: en Monad testnet tienen delegaciones
// EIP-7702 puestas por bots (su código empieza por 0xef0100), así que actuarían como contratos y no como EOAs.
const keys = Object.fromEntries(roles.map((r) => [r, generatePrivateKey()])) as Record<
  (typeof roles)[number],
  `0x${string}`
>;

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const identityAbi = parseAbi(['function register() returns (uint256 agentId)']);
const reputationAbi = parseAbi([
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
]);

let anvil: ChildProcess | null = null;
const publicClient = createPublicClient({ chain, transport: http(RPC) });

const as = (key: keyof typeof keys, provider?: Parameters<typeof createAval>[0]['assertionProvider']): Aval =>
  createAval({
    publicClient,
    walletClient: createWalletClient({ account: privateKeyToAccount(keys[key]), chain, transport: http(RPC) }),
    ...(provider ? { assertionProvider: provider } : {}),
  });
const addressOf = (key: keyof typeof keys): Address => privateKeyToAccount(keys[key]).address;

beforeAll(async () => {
  anvil = await startAnvil(PORT, 'https://testnet-rpc.monad.xyz');
  if (anvil) {
    const test = createTestClient({ chain, mode: 'anvil', transport: http(RPC) });
    for (const role of roles) await test.setBalance({ address: privateKeyToAccount(keys[role]).address, value: parseEther('100') });
  }
}, 120_000);

afterAll(() => {
  anvil?.kill();
});

describe('flujo completo contra los contratos desplegados en Monad testnet', () => {
  const passkey = simulatedPasskey();
  let permitId = 0n;
  const shop = '0x00000000000000000000000000000000000000A1' as Address;

  const needAnvil = (ctx: { skip: (note?: string) => never }) => {
    if (!anvil) ctx.skip('anvil no está disponible');
  };

  it('el usuario registra su passkey sin gastar gas (firma él, envía el relayer)', async (ctx) => {
    needAnvil(ctx);
    const owner = as('owner');
    const signed = await owner.passkeys.signRegister(passkey.key);
    await as('relayer').passkeys.relayRegister(signed);

    expect(await owner.passkeys.keyOf(addressOf('owner'))).toEqual(passkey.key);
    expect(await owner.passkeys.has(addressOf('service'))).toBe(false);
  });

  it('el usuario recibe tUSD y autoriza a AgentPermit con una firma (ERC-2612)', async (ctx) => {
    needAnvil(ctx);
    const relayer = as('relayer');
    await relayer.tokens.faucet({ to: addressOf('owner'), amount: 500_000_000n });
    const permit = await as('owner').tokens.signPermit({ value: 500_000_000n });
    await relayer.tokens.relayPermit(permit);

    expect(await relayer.tokens.balanceOf(addressOf('owner'))).toBe(500_000_000n);
  });

  it('el usuario crea un permiso firmado y un relayer lo envía', async (ctx) => {
    needAnvil(ctx);
    const signed = await as('owner').permits.signGrant({
      agent: addressOf('agent'),
      agentId: 7n,
      maxPerSpend: 100_000_000n,
      maxTotal: 300_000_000n,
      approvalThreshold: 50_000_000n,
      expiresIn: 86_400,
      recipients: [shop],
    });
    const result = await as('relayer').permits.relayGrant(signed);
    permitId = result.permitId;

    const permit = await as('agent').permits.get(permitId);
    expect(permit.owner).toBe(addressOf('owner'));
    expect(permit.terms.agent).toBe(addressOf('agent'));
    expect(await as('agent').permits.remaining(permitId)).toBe(300_000_000n);
    expect(await as('agent').permits.isAllowedRecipient(permitId, shop)).toBe(true);
  });

  it('el agente gasta dentro del límite y queda el recibo', async (ctx) => {
    needAnvil(ctx);
    const agent = as('agent');
    await agent.permits.spend({ permitId, to: shop, amount: 10_000_000n, ref: 'pedido-1' });

    expect(await agent.tokens.balanceOf(shop)).toBe(10_000_000n);
    expect(await agent.permits.paidAmount(shop, addressOf('owner'))).toBe(10_000_000n);
    expect(await agent.permits.paidAmount(shop, addressOf('agent'))).toBe(10_000_000n);
  });

  it('un gasto sobre el umbral sin aprobación se rechaza con un mensaje claro', async (ctx) => {
    needAnvil(ctx);
    const error = await as('agent')
      .permits.spend({ permitId, to: shop, amount: 80_000_000n })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AvalError);
    expect((error as AvalError).code).toBe('NeedsApproval');
    expect((error as AvalError).message).toContain('requestSpend');
  });

  it('un gasto sobre el máximo por gasto se rechaza', async (ctx) => {
    needAnvil(ctx);
    const error = await as('agent')
      .permits.requestSpend({ permitId, to: shop, amount: 101_000_000n })
      .catch((e: unknown) => e);

    expect((error as AvalError).code).toBe('ExceedsPerSpendLimit');
  });

  it('un destinatario fuera de la lista se rechaza', async (ctx) => {
    needAnvil(ctx);
    const error = await as('agent')
      .permits.spend({ permitId, to: addressOf('sybil'), amount: 1_000_000n })
      .catch((e: unknown) => e);

    expect((error as AvalError).code).toBe('RecipientNotAllowed');
  });

  it('un gasto grande espera la huella del usuario y se ejecuta al aprobarlo', async (ctx) => {
    needAnvil(ctx);
    const agent = as('agent');
    const { requestId } = await agent.permits.requestSpend({
      permitId,
      to: shop,
      amount: 80_000_000n,
      ref: 'pedido-grande',
    });
    expect((await agent.permits.getRequest(requestId)).status).toBe(1);
    expect(await agent.tokens.balanceOf(shop)).toBe(10_000_000n);

    // La huella la pide el SDK; un relayer envía la aprobación.
    const approver = as('relayer', passkey.provider);
    await approver.permits.approve(requestId);

    expect((await agent.permits.getRequest(requestId)).status).toBe(2);
    expect(await agent.tokens.balanceOf(shop)).toBe(90_000_000n);
  });

  it('la aprobación de otra passkey no sirve', async (ctx) => {
    needAnvil(ctx);
    const { requestId } = await as('agent').permits.requestSpend({ permitId, to: shop, amount: 60_000_000n });
    const impostor = simulatedPasskey();

    const error = await as('relayer', impostor.provider)
      .permits.approve(requestId)
      .catch((e: unknown) => e);
    expect((error as AvalError).code).toBe('InvalidApproval');
    expect((await as('agent').permits.getRequest(requestId)).status).toBe(1);
  });

  it('reputación verificada: solo cuenta quien pagó, aunque otros reseñen', async (ctx) => {
    needAnvil(ctx);
    const wallet = (key: keyof typeof keys) =>
      createWalletClient({ account: privateKeyToAccount(keys[key]), chain, transport: http(RPC) });

    // El servicio (la tienda real) se registra como agente en el Identity Registry oficial.
    const service = wallet('service');
    // Para que los pagos lleguen a su billetera, repetimos el flujo pagando a la cuenta del servicio.
    const owner2 = as('owner');
    const signed = await owner2.permits.signGrant({
      agent: addressOf('agent'),
      maxPerSpend: 20_000_000n,
      maxTotal: 20_000_000n,
      approvalThreshold: null,
      expiresIn: 3600,
    });
    const { permitId: paidPermit } = await as('relayer').permits.relayGrant(signed);
    await as('agent').permits.spend({ permitId: paidPermit, to: addressOf('service'), amount: 20_000_000n });

    const registerHash = await service.writeContract({
      address: erc8004MonadTestnet.identityRegistry,
      abi: identityAbi,
      functionName: 'register',
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
    // El ID del agente es el tokenId del NFT que se acuñó (tercer topic del evento Transfer).
    const transfer = receipt.logs.find((l) => l.topics[0] === TRANSFER_TOPIC && l.topics.length === 4);
    const agentId = BigInt(transfer!.topics[3]!);

    // El agente del cliente (que sí pagó) reseña 95; una cuenta falsa que nunca pagó reseña 0.
    const feedback = (account: ReturnType<typeof wallet>, value: bigint) =>
      account.writeContract({
        address: erc8004MonadTestnet.reputationRegistry,
        abi: reputationAbi,
        functionName: 'giveFeedback',
        args: [agentId, value, 0, 'calidad', '', '', '', `0x${'00'.repeat(32)}`],
      });
    await publicClient.waitForTransactionReceipt({ hash: await feedback(wallet('agent'), 95n) });
    await publicClient.waitForTransactionReceipt({ hash: await feedback(wallet('sybil'), 0n) });

    const summary = await as('agent').reputation.summary(agentId, { tag1: 'calidad' });
    expect(summary.count).toBe(1n);
    expect(summary.value).toBe(95n);
    expect(summary.verifiedClients).toBe(2n);
    expect(await as('agent').reputation.clients(agentId)).toContain(addressOf('agent'));
  });

  it('prueba sin estado: un cliente nuevo, sin datos locales, reconstruye todo desde la cadena', async (ctx) => {
    needAnvil(ctx);
    // Un cliente recién creado: no recibe ningún dato de los pasos anteriores, solo la dirección del usuario.
    const fresh = createAval({ publicClient });
    const ownerAddress = addressOf('owner');

    expect(await fresh.passkeys.keyOf(ownerAddress)).toEqual(passkey.key);
    expect(await fresh.tokens.balanceOf(ownerAddress)).toBeGreaterThan(0n);

    const permitsOfOwner = await fresh.permits.listByOwner(ownerAddress);
    expect(permitsOfOwner.map((p) => p.permitId)).toContain(permitId);
    const found = permitsOfOwner.find((p) => p.permitId === permitId)!;
    expect(found.permit.terms.agent).toBe(addressOf('agent'));
    expect(found.permit.spent).toBe(90_000_000n);

    // El agente ve los mismos permisos desde su lado.
    expect((await fresh.permits.listByAgent(addressOf('agent'))).map((p) => p.permitId)).toContain(permitId);

    // Los pedidos: el grande quedó ejecutado, el de otra passkey sigue pendiente.
    const requests = await fresh.permits.requestsOf(ownerAddress);
    expect(requests.map((r) => r.request.status).sort()).toEqual([1, 2]);

    // El historial de pagos, con cada recibo.
    const receipts = await fresh.permits.receiptsOf(ownerAddress);
    expect(receipts.map((r) => r.amount)).toEqual([10_000_000n, 80_000_000n, 20_000_000n]);
    expect(receipts[0]).toMatchObject({ to: shop, permitId, requestId: 0n });
    expect(receipts[1]!.requestId).toBeGreaterThan(0n);

    // Un usuario sin nada no devuelve nada ni falla.
    const nobody = addressOf('sybil');
    expect(await fresh.permits.listByOwner(nobody)).toEqual([]);
    expect(await fresh.permits.receiptsOf(nobody)).toEqual([]);
  });

  it('el usuario revoca con una firma y el permiso deja de funcionar', async (ctx) => {
    needAnvil(ctx);
    const signed = await as('owner').permits.signRevoke(permitId);
    await as('relayer').permits.relayRevoke(signed);

    expect(await as('agent').permits.remaining(permitId)).toBe(0n);
    const error = await as('agent')
      .permits.spend({ permitId, to: shop, amount: 1_000_000n })
      .catch((e: unknown) => e);
    expect((error as AvalError).code).toBe('PermitInactive');
  });
});
