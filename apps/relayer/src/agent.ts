import { AvalError, type AvalAddresses, agentMemorySlot, createAval, openMemory, sealedVersion } from '@aval/sdk';
import { type Address, type Hash, type Hex, type PublicClient, type WalletClient, formatEther, hexToBytes, parseAbi } from 'viem';

const riskGuardAbi = parseAbi([
  'function isBlocked(address agent) view returns (bool)',
  'function alertOf(address agent) view returns ((uint8 level, uint64 observedAt, string reason))',
]);
import { type Limits, RelayerError, SlidingWindow } from './limits.js';
import { type Context, createRuntime, limited } from './runtime.js';

export type DemoAgentOptions = {
  publicClient: PublicClient;
  /** Cuenta del agente de demostración: la que firma `spend`, `requestSpend` y las reseñas. Con su propio saldo de gas. */
  walletClient: WalletClient;
  addresses: AvalAddresses;
  limits: Limits;
  /** Servicio al que el agente le paga: un agente registrado en ERC-8004 cuya billetera recibe los pagos. */
  service: { address: Address; agentId: bigint };
  /**
   * AvalRiskGuard (opcional): contrato donde el vigilante de Chainlink CRE marca agentes riesgosos. Si este agente está
   * marcado para bloquear, no paga ni pide pagos hasta que el vigilante lo desmarque.
   */
  riskGuard?: Address;
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
  // Leer la memoria no gasta gas, pero igual se limita para que nadie use al agente como lector gratuito.
  const recallsByIp = new SlidingWindow(60_000);

  /** Respeta la alerta del vigilante de Chainlink CRE: si el agente está bloqueado, no mueve dinero. */
  async function respectRiskGuard() {
    if (!options.riskGuard) return;
    const blocked = await publicClient.readContract({ address: options.riskGuard, abi: riskGuardAbi, functionName: 'isBlocked', args: [account!.address] });
    if (!blocked) return;
    const alert = await publicClient.readContract({ address: options.riskGuard, abi: riskGuardAbi, functionName: 'alertOf', args: [account!.address] });
    throw new RelayerError(403, 'AgentBlockedByGuard', 'El vigilante de Chainlink CRE bloqueó al agente: ' + alert.reason);
  }

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

    /**
     * El agente lee la parte de la memoria que `owner` compartió con él (casillero de MemoryVault con su dirección) y la
     * descifra con la clave que el usuario le dio. No ve nada más de la memoria del usuario: otras partes usan otras
     * claves. Si el usuario revocó el acceso (volvió a cifrar con una versión nueva), esta clave ya no la abre.
     */
    async recall(input: { owner: Address; key: Hex }, ctx: Context): Promise<{ text: string; version: number }> {
      limited(recallsByIp.hit(ctx.ip, 30, now()), 'para leer memoria desde esta IP');
      const sealed = await aval.memory.read(input.owner, agentMemorySlot(account.address));
      if (sealed === '0x') {
        throw new RelayerError(404, 'NoSharedMemory', 'Este usuario todavía no compartió memoria con el agente.');
      }
      try {
        return { text: await openMemory(hexToBytes(input.key), sealed), version: sealedVersion(sealed) };
      } catch (error) {
        if (error instanceof AvalError && error.code === 'MemoryKeyMismatch') {
          throw new RelayerError(403, 'MemoryAccessRevoked', 'La clave del agente ya no abre esta memoria: el usuario revocó el acceso.');
        }
        throw error;
      }
    },

    /** El agente le paga al servicio dentro de lo que su permiso permite. Si supera el umbral, el contrato lo rechaza. */
    async spend(input: { permitId: bigint; amount: bigint; ref?: string }, ctx: Context): Promise<{ hash: Hash }> {
      await guard(ctx, `agent-spend:${input.permitId}`);
      await respectRiskGuard();
      return execute(async () => ({
        hash: (await aval.permits.spend({ permitId: input.permitId, to: service.address, amount: input.amount, ref: input.ref })).hash,
      }));
    },

    /** El agente pide un pago que supera el umbral: queda pendiente hasta que el usuario lo apruebe con su huella. */
    async request(input: { permitId: bigint; amount: bigint; ref?: string }, ctx: Context): Promise<{ hash: Hash; requestId: bigint }> {
      await guard(ctx, `agent-request:${input.permitId}`);
      await respectRiskGuard();
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
