import { monadTestnet } from '@aval/sdk';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createDemoAgent } from './agent.js';
import { createApp } from './app.js';
import { type ServerConfig, loadConfig } from './config.js';
import { createRelayer } from './relayer.js';

/** Construye el relayer y su app web a partir de variables de entorno. Lo comparten el servidor local y Vercel. */
export function createFromEnv(source: Record<string, string | undefined> = process.env, config: ServerConfig = loadConfig(source)) {
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
  const demoAgent = config.demoAgent
    ? createDemoAgent({
        publicClient,
        walletClient: createWalletClient({
          account: privateKeyToAccount(config.demoAgent.privateKey),
          chain,
          transport: http(config.rpcUrl),
        }),
        addresses: monadTestnet,
        limits: config.limits,
        service: config.demoAgent.service,
      })
    : undefined;

  const app = createApp({
    relayer,
    agent: demoAgent,
    limits: config.limits,
    allowedOrigins: config.allowedOrigins,
    trustProxy: config.trustProxy,
  });

  return { app, relayer, demoAgent, config, account, publicClient };
}
