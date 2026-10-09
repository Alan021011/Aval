import { type AvalAddresses, createAval } from '@aval/sdk';
import { type Address, type Hash, type PublicClient, type WalletClient, formatEther } from 'viem';
import { type Limits, SlidingWindow } from './limits.js';
import { type Context, createRuntime, limited } from './runtime.js';

export type DemoAgentOptions = {
  publicClient: PublicClient;
  /** Cuenta del agente de demostración: la que firma `spend`, `requestSpend` y las reseñas. Con su propio saldo de gas. */
  walletClient: WalletClient;
  addresses: AvalAddresses;
  limits: Limits;
  /** Servicio al que el agente le paga: un agente registrado en ERC-8004 cuya billetera recibe los pagos. */
  service: { address: Address; agentId: bigint };
  now?: () => number;
};

/**
 * Agente de demostración: hace de agente de IA de un usuario para poder mostrar el flujo completo (pagar dentro del
 * límite, intentar pasarse, pedir una aprobación y reseñar al servicio). Es el "cuerpo" del agente: las acciones que
 * puede hacer son las mismas que luego usa el agente con Qwen para decidir.
 *
 * Seguridad: solo paga a un servicio fijo y solo con permisos que un usuario le dio a esta cuenta; el contrato
 * rechaza cualquier otra cosa. Sus gastos de gas están limitados como los del relayer.
 */
export function createDemoAgent(options: DemoAgentOptions) {
  const { publicClient, walletClient, addresses, limits, service } = options;
  const account = walletClient.account;
  if (!account) throw new Error('El agente de demostración necesita un walletClient con cuenta');

  // El agente tiene su propio saldo mínimo: gasta mucho menos gas que el relayer y tiene menos fondos.
  const runtime = createRuntime({
    publicClient,
    account,
    limits: { ...limits, minBalanceWei: limits.agentMinBalanceWei },
    now: options.now,
    label: 'El agente de demostración',
  });
  const { guard, execute, now } = runtime;
  const aval = createAval({ publicClient, walletClient, addresses });

  // Un usuario puede reseñar a lo sumo una vez por ventana: es una demostración, no un buzón de reseñas.
  const reviewsByIp = new SlidingWindow(60 * 60_000);

  return {
    address: account.address,
    service,

    async info() {
      const balance = await publicClient.getBalance({ address: account.address });
      return {
        address: account.address,
        service,
        token: addresses.testUsd,
        balance: formatEther(balance),
        ready: balance >= limits.agentMinBalanceWei,
      };
    },

    /** El agente le paga al servicio dentro de lo que su permiso permite. Si supera el umbral, el contrato lo rechaza. */
    async spend(input: { permitId: bigint; amount: bigint; ref?: string }, ctx: Context): Promise<{ hash: Hash }> {
      await guard(ctx, `agent-spend:${input.permitId}`);
      return execute(async () => ({
        hash: (await aval.permits.spend({ permitId: input.permitId, to: service.address, amount: input.amount, ref: input.ref })).hash,
      }));
    },

    /** El agente pide un pago que supera el umbral: queda pendiente hasta que el usuario lo apruebe con su huella. */
    async request(input: { permitId: bigint; amount: bigint; ref?: string }, ctx: Context): Promise<{ hash: Hash; requestId: bigint }> {
      await guard(ctx, `agent-request:${input.permitId}`);
      return execute(async () => {
        const { hash, requestId } = await aval.permits.requestSpend({
          permitId: input.permitId,
          to: service.address,
          amount: input.amount,
          ref: input.ref,
        });
        return { hash, requestId };
      });
    },

    /** El agente reseña al servicio. Solo cuenta en la reputación verificada si ya le pagó, con su dueño verificado. */
    async review(input: { value: number; tag?: string }, ctx: Context): Promise<{ hash: Hash }> {
      limited(reviewsByIp.hit(ctx.ip, 20, now()), 'demasiadas reseñas desde esta IP');
      await guard(ctx, 'agent-review');
      return execute(async () => ({
        hash: (await aval.agents.review(service.agentId, { value: input.value, tag1: input.tag ?? 'calidad' })).hash,
      }));
    },
  };
}

export type DemoAgent = ReturnType<typeof createDemoAgent>;
