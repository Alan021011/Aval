import { serve } from '@hono/node-server';
import { formatEther } from 'viem';
import { createFromEnv } from './bootstrap.js';

const { app, config, account, publicClient } = createFromEnv();

serve({ fetch: app.fetch, port: config.port }, async () => {
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Relayer de Aval escuchando en http://localhost:${config.port}`);
  console.log(`  cuenta:  ${account.address}`);
  console.log(`  saldo:   ${formatEther(balance)} MON`);
  console.log(`  mínimo:  ${formatEther(config.limits.minBalanceWei)} MON (por debajo deja de enviar)`);
  console.log(`  orígenes permitidos: ${config.allowedOrigins.join(', ')}`);
  if (balance < config.limits.minBalanceWei) console.warn('  AVISO: el saldo está por debajo del mínimo; no enviará nada.');
});
