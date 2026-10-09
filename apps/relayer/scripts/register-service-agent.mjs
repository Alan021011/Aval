// Registra el servicio de la demo en ERC-8004 (una sola vez) y guarda su ID en .env.
// Uso: node --env-file=.env scripts/register-service-agent.mjs
import { agentCardUri, createAval, monadTestnet } from '@aval/sdk';
import { appendFileSync, readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const rpc = process.env.RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const chain = defineChain({
  id: monadTestnet.chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});

if (/^SERVICE_AGENT_ID=/m.test(readFileSync('.env', 'utf8'))) {
  console.log('SERVICE_AGENT_ID ya está en .env: no se registra otra vez.');
  process.exit(0);
}

const account = privateKeyToAccount(process.env.SERVICE_PRIVATE_KEY);
const aval = createAval({
  publicClient: createPublicClient({ chain, transport: http(rpc) }),
  walletClient: createWalletClient({ account, chain, transport: http(rpc) }),
});

const { agentId, hash } = await aval.agents.register({
  uri: agentCardUri({
    name: 'Servicio de traducción (demo de Aval)',
    description: 'Agente de prueba que recibe pagos de otros agentes. Su reputación solo cuenta a quienes le pagaron.',
  }),
});
console.log('Servicio registrado en ERC-8004:', account.address, `(agente #${agentId})`, hash);
console.log('Billetera registrada:', await aval.agents.walletOf(agentId));
appendFileSync('.env', `SERVICE_AGENT_ID=${agentId}\n`);
