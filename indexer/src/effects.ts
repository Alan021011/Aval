import { S, createEffect } from "envio";
import { ContractFunctionRevertedError, createPublicClient, fallback, http, parseAbi } from "viem";
import { ZERO_ADDRESS } from "./constants";

/** Identity Registry oficial de ERC-8004 en Monad testnet. */
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

/**
 * RPC de Monad testnet, en orden de preferencia. Si uno no responde (el público principal ha tenido caídas cortas y
 * puede limitar a servidores en la nube), se pasa al siguiente. `ENVIO_RPC_URL` permite poner uno propio delante.
 */
const RPC_URLS = [
  ...(process.env.ENVIO_RPC_URL ? [process.env.ENVIO_RPC_URL] : []),
  "https://testnet-rpc.monad.xyz",
  // Probados con lotes de eth_call. No sirven: dRPC (rechaza el eth_call por límite de gas) y monadinfra (403 en lotes).
  "https://rpc.ankr.com/monad_testnet",
  "https://10143.rpc.thirdweb.com",
];

const client = createPublicClient({
  // `batch: true`: las lecturas de varias reseñas salen en pocas llamadas en vez de una por cada una.
  transport: fallback(RPC_URLS.map((url) => http(url, { batch: true, timeout: 8_000, retryCount: 1 }))),
});

/**
 * Billetera que cobra por un agente de ERC-8004, en minúsculas. Devuelve la dirección cero si el agente no existe o
 * no tiene billetera.
 *
 * Con caché: se consulta una vez por agente. El registro de ERC-8004 tiene reseñas de cientos de agentes; sin caché
 * cada pasada repetía cientos de llamadas y el RPC público las frenaba. El costo: si un agente cambia de billetera
 * después de indexado, el indexador sigue usando la primera (está en las limitaciones del README).
 * Los errores de red se dejan pasar para que el indexador reintente en vez de guardar un cero falso.
 */
export const getAgentWallet = createEffect(
  { name: "getAgentWallet", input: S.bigint, output: S.string, cache: true, rateLimit: { calls: 10, per: "second" } },
  async ({ input: agentId }) => {
    try {
      const wallet = await client.readContract({
        address: IDENTITY_REGISTRY,
        abi: parseAbi(["function getAgentWallet(uint256 agentId) view returns (address)"]),
        functionName: "getAgentWallet",
        args: [agentId],
      });
      return wallet.toLowerCase();
    } catch (error) {
      if (error instanceof Error && "walk" in error) {
        const revert = (error as { walk: (f: (e: unknown) => boolean) => unknown }).walk((e) => e instanceof ContractFunctionRevertedError);
        if (revert) return ZERO_ADDRESS;
      }
      throw error;
    }
  },
);
