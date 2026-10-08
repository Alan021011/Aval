import { monadTestnet } from '@aval/sdk';
import { serve } from '@hono/node-server';
import { createPublicClient, createWalletClient, defineChain, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createRelayer } from './relayer.js';

const config = loadConfig();

const chain = defineChain({
  id: monadTestnet.chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const account = privateKeyToAccount(config.privateKey);
const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

const relayer = createRelayer({ publicClient, walletClient, addresses: monadTestnet, limits: config.limits });
const app = createApp({
  relayer,
  limits: config.limits,
  allowedOrigins: config.allowedOrigins,
  trustProxy: config.trustProxy,
});

serve({ fetch: app.fetch, port: config.port }, async () => {
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Relayer de Aval escuchando en http://localhost:${config.port}`);
  console.log(`  cuenta:  ${account.address}`);
  console.log(`  saldo:   ${formatEther(balance)} MON`);
  console.log(`  mínimo:  ${formatEther(config.limits.minBalanceWei)} MON (por debajo deja de enviar)`);
  console.log(`  orígenes permitidos: ${config.allowedOrigins.join(', ')}`);
  if (balance < config.limits.minBalanceWei) console.warn('  AVISO: el saldo está por debajo del mínimo; no enviará nada.');
});
