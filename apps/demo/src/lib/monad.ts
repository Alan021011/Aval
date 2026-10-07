import { createPublicClient, defineChain, http } from 'viem';

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonVision', url: 'https://testnet.monadexplorer.com' } },
});

export const clientePublico = createPublicClient({ chain: monadTestnet, transport: http() });

// Precompile de verificación P256 (EIP-7951). Entrada de 160 bytes: hash, r, s, x, y.
export const PRECOMPILE_P256 = '0x0000000000000000000000000000000000000100';
