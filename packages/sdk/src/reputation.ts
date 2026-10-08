import type { Address } from 'viem';
import { reputationReaderAbi } from './abi.js';
import { type Ctx, read } from './context.js';

export type VerifiedSummary = {
  /** Reseñas que cuentan. */
  count: bigint;
  /** Promedio que calcula ERC-8004, con `decimals` decimales (truncado: conviene reseñar en escala 0-100). */
  value: bigint;
  decimals: number;
  /** Clientes que pasaron los filtros y entraron en la consulta. */
  verifiedClients: bigint;
};

export type SummaryOptions = {
  /** Filtros de etiqueta de ERC-8004. Vacío = todas. */
  tag1?: string;
  tag2?: string;
  /** Solo cuentan clientes que pagaron al menos esto al agente. */
  minPaid?: bigint;
  /** Contrato que decide quién es una persona verificada. Si se omite, no se exige verificación. */
  verifier?: Address;
};

const ZERO: Address = '0x0000000000000000000000000000000000000000';

export function createReputation(ctx: Ctx) {
  const address = ctx.addresses.reputationReader;

  return {
    /**
     * Reputación del agente contando solo a quienes le pagaron a través de AgentPermit. Cualquiera puede escribir
     * una reseña en ERC-8004; las que no vienen de un cliente con recibo no entran en el resultado.
     */
    async summary(agentId: bigint, options: SummaryOptions = {}): Promise<VerifiedSummary> {
      const result = await read<{ count: bigint; value: bigint; decimals: number; verifiedClients: bigint }>(ctx, {
        address,
        abi: reputationReaderAbi,
        functionName: 'verifiedSummary',
        args: [agentId, options.tag1 ?? '', options.tag2 ?? '', options.minPaid ?? 0n, options.verifier ?? ZERO],
      });
      return {
        count: BigInt(result.count),
        value: BigInt(result.value),
        decimals: Number(result.decimals),
        verifiedClients: BigInt(result.verifiedClients),
      };
    },

    /** Cuentas que cuentan para la reputación del agente. */
    async clients(agentId: bigint, options: Pick<SummaryOptions, 'minPaid' | 'verifier'> = {}): Promise<Address[]> {
      return read<Address[]>(ctx, {
        address,
        abi: reputationReaderAbi,
        functionName: 'verifiedClients',
        args: [agentId, options.minPaid ?? 0n, options.verifier ?? ZERO],
      });
    },
  };
}

export type Reputation = ReturnType<typeof createReputation>;
