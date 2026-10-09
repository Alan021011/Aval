import { createPublicClient, defineChain, fallback, http } from 'viem';
import { monadTestnet } from '@aval/sdk';

/** URL del relayer que paga el gas. Se puede cambiar con `VITE_RELAYER_URL`, por ejemplo para usar uno local. */
export const RELAYER_URL: string = import.meta.env.VITE_RELAYER_URL ?? 'https://aval-relayer.vercel.app';
/**
 * RPC públicos de Monad testnet, en orden de preferencia. Si uno no responde (el público principal ha tenido caídas
 * cortas), la app pasa solo al siguiente. Los tres permiten llamadas desde el navegador (CORS).
 */
export const RPC_URLS = ['https://testnet-rpc.monad.xyz', 'https://rpc-testnet.monadinfra.com', 'https://monad-testnet.drpc.org'];
export const RPC_URL = RPC_URLS[0] as string;
export const transport = fallback(RPC_URLS.map((url) => http(url, { timeout: 8_000, retryCount: 1 })));
export const EXPLORER_URL = 'https://testnet.monadvision.com';

/** Minutos sin actividad tras los cuales la sesión se bloquea y hay que volver a usar la huella. */
export const SESSION_MINUTES = 10;

/** Unidad del dólar de prueba (6 decimales). */
export const USD = 1_000_000n;

export const monad = defineChain({
  id: monadTestnet.chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS } },
  blockExplorers: { default: { name: 'MonVision', url: EXPLORER_URL } },
});

export const publicClient = createPublicClient({ chain: monad, transport });

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER_URL}/address/${address}`;
