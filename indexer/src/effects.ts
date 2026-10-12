import { S, createEffect } from "envio";
import { ContractFunctionRevertedError, createPublicClient, http, parseAbi } from "viem";
import { ZERO_ADDRESS } from "./constants";

/** Identity Registry oficial de ERC-8004 en Monad testnet. */
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const client = createPublicClient({
  // `batch: true`: las lecturas de varias reseñas salen en pocas llamadas en vez de una por cada una.
  transport: http(process.env.ENVIO_RPC_URL ?? "https://testnet-rpc.monad.xyz", { batch: true }),
});

/**
 * Billetera que cobra por un agente de ERC-8004, en minúsculas. Devuelve la dirección cero si el agente no existe o
 * no tiene billetera. Sin caché a propósito: el agente puede registrar su billetera después de su primera reseña.
 * Los errores de red se dejan pasar para que el indexador reintente en vez de guardar un cero falso.
 */
export const getAgentWallet = createEffect(
  { name: "getAgentWallet", input: S.bigint, output: S.string, cache: false, rateLimit: false },
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
