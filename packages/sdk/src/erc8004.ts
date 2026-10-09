import { type Address, type Hex, parseAbi, parseEventLogs } from 'viem';
import { type Ctx, type Sent, read, send } from './context.js';
import { AvalError } from './errors.js';

/** Partes de ERC-8004 (agentes sin confianza previa) que usa Aval. Los registros oficiales ya están desplegados. */
export const identityRegistryAbi = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function register() returns (uint256 agentId)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

export const reputationRegistryAbi = parseAbi([
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
]);

const ZERO_HASH: Hex = `0x${'00'.repeat(32)}`;

export type AgentCard = { name: string; description: string; [key: string]: unknown };

/** Convierte una "tarjeta de agente" (JSON) en un `data:` URI, para registrar un agente sin alojar ningún archivo. */
export function agentCardUri(card: AgentCard): string {
  const json = JSON.stringify({ type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', ...card });
  return `data:application/json;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(json)))}`;
}

/** Registro de agentes y reseñas en ERC-8004. */
export function createAgents(ctx: Ctx) {
  const identity = () => {
    const address = ctx.addresses.identityRegistry;
    if (!address) throw new AvalError('NoRegistry', 'Esta red no tiene un Identity Registry de ERC-8004 configurado.');
    return address;
  };
  const reputation = () => {
    const address = ctx.addresses.reputationRegistry;
    if (!address) throw new AvalError('NoRegistry', 'Esta red no tiene un Reputation Registry de ERC-8004 configurado.');
    return address;
  };

  return {
    /**
     * Registra un agente en ERC-8004: la cuenta que envía queda como su dueño y su billetera. Los pagos que reciba
     * esa billetera son los que cuentan para su reputación verificada. Devuelve el ID del agente.
     */
    async register(options: { uri?: string } = {}): Promise<{ agentId: bigint } & Sent> {
      const sent = await send(ctx, {
        address: identity(),
        abi: identityRegistryAbi,
        functionName: 'register',
        args: options.uri === undefined ? [] : [options.uri],
      });
      // El ID del agente es el tokenId del NFT que se acuña.
      const [log] = parseEventLogs({ abi: identityRegistryAbi, logs: sent.receipt.logs, eventName: 'Transfer' });
      if (!log) throw new AvalError('NoEvent', 'No se encontró el registro del agente en el recibo.');
      return { agentId: log.args.tokenId, ...sent };
    },

    /** Billetera registrada de un agente (a la que deben llegar los pagos). */
    async walletOf(agentId: bigint): Promise<Address> {
      return read<Address>(ctx, { address: identity(), abi: identityRegistryAbi, functionName: 'getAgentWallet', args: [agentId] });
    },

    /**
     * Deja una reseña de un agente. Quien reseña es la cuenta que envía. Solo cuenta en la reputación verificada si
     * esa cuenta (o su dueño) le pagó al agente a través de AgentPermit. ERC-8004 no permite que el dueño del agente
     * se reseñe a sí mismo.
     * Conviene usar una escala de 0 a 100: el promedio que calcula ERC-8004 se trunca a enteros.
     */
    async review(agentId: bigint, input: { value: number | bigint; tag1?: string; tag2?: string; uri?: string }): Promise<Sent> {
      return send(ctx, {
        address: reputation(),
        abi: reputationRegistryAbi,
        functionName: 'giveFeedback',
        args: [agentId, BigInt(input.value), 0, input.tag1 ?? '', input.tag2 ?? '', '', input.uri ?? '', ZERO_HASH],
      });
    },
  };
}

export type Agents = ReturnType<typeof createAgents>;
