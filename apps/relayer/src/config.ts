import { monadTestnet } from '@aval/sdk';
import type { Address } from 'viem';
import { z } from 'zod';
import { type Limits, defaultLimits } from './limits.js';

const env = z.object({
  /** Clave de la cuenta que paga el gas. Solo para testnet, nunca una cuenta con fondos reales. */
  RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'RELAYER_PRIVATE_KEY debe ser 0x + 64 hex'),
  RPC_URL: z.string().url().default('https://testnet-rpc.monad.xyz'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5180'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  ALLOWED_TOKENS: z.string().optional(),
  MIN_BALANCE_MON: z.coerce.number().min(0).default(0.5),
  AGENT_MIN_BALANCE_MON: z.coerce.number().min(0).default(0.05),
  PER_IP_PER_MINUTE: z.coerce.number().int().min(1).optional(),
  PER_OWNER_PER_MINUTE: z.coerce.number().int().min(1).optional(),
  MAX_TX_PER_DAY: z.coerce.number().int().min(1).optional(),
  FAUCET_AMOUNT_TUSD: z.coerce.number().min(0).max(1000).optional(),
  FAUCET_COOLDOWN_SECONDS: z.coerce.number().int().min(0).optional(),
  MAX_NONCE_RETRIES: z.coerce.number().int().min(0).max(10).optional(),
  /** Agente de demostración (opcional). Si se pone la clave, hacen falta también la billetera y el ID del servicio. */
  AGENT_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'AGENT_PRIVATE_KEY debe ser 0x + 64 hex').optional(),
  SERVICE_AGENT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  SERVICE_AGENT_ID: z.string().regex(/^\d+$/).optional(),
});

export type ServerConfig = {
  privateKey: `0x${string}`;
  rpcUrl: string;
  port: number;
  allowedOrigins: string[];
  trustProxy: boolean;
  limits: Limits;
  demoAgent?: { privateKey: `0x${string}`; service: { address: Address; agentId: bigint } };
};

export function loadConfig(source: Record<string, string | undefined> = process.env): ServerConfig {
  const parsed = env.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${problems}\nRevisa apps/relayer/.env.example`);
  }
  const e = parsed.data;

  const tokens = (e.ALLOWED_TOKENS?.split(',').map((t) => t.trim()).filter(Boolean) ?? [monadTestnet.testUsd]) as Address[];
  const base = defaultLimits(tokens.filter((t): t is Address => Boolean(t)));

  // El agente de demostración es todo o nada: con la clave hacen falta también la billetera y el ID del servicio.
  const hasAgentKey = e.AGENT_PRIVATE_KEY !== undefined;
  if (hasAgentKey && (!e.SERVICE_AGENT_ADDRESS || !e.SERVICE_AGENT_ID)) {
    throw new Error(
      'Configuración inválida:\n  - Con AGENT_PRIVATE_KEY hacen falta también SERVICE_AGENT_ADDRESS y SERVICE_AGENT_ID',
    );
  }

  return {
    privateKey: e.RELAYER_PRIVATE_KEY as `0x${string}`,
    rpcUrl: e.RPC_URL,
    port: e.PORT,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    trustProxy: e.TRUST_PROXY === 'true',
    ...(hasAgentKey
      ? {
          demoAgent: {
            privateKey: e.AGENT_PRIVATE_KEY as `0x${string}`,
            service: { address: e.SERVICE_AGENT_ADDRESS as Address, agentId: BigInt(e.SERVICE_AGENT_ID as string) },
          },
        }
      : {}),
    limits: {
      ...base,
      minBalanceWei: BigInt(Math.round(e.MIN_BALANCE_MON * 1e18)),
      agentMinBalanceWei: BigInt(Math.round(e.AGENT_MIN_BALANCE_MON * 1e18)),
      ...(e.PER_IP_PER_MINUTE ? { perIpPerMinute: e.PER_IP_PER_MINUTE } : {}),
      ...(e.PER_OWNER_PER_MINUTE ? { perOwnerPerMinute: e.PER_OWNER_PER_MINUTE } : {}),
      ...(e.MAX_TX_PER_DAY ? { maxTransactionsPerDay: e.MAX_TX_PER_DAY } : {}),
      ...(e.FAUCET_AMOUNT_TUSD !== undefined ? { faucetAmount: BigInt(Math.round(e.FAUCET_AMOUNT_TUSD * 1e6)) } : {}),
      ...(e.FAUCET_COOLDOWN_SECONDS !== undefined ? { faucetCooldownSeconds: e.FAUCET_COOLDOWN_SECONDS } : {}),
      ...(e.MAX_NONCE_RETRIES !== undefined ? { maxNonceRetries: e.MAX_NONCE_RETRIES } : {}),
    },
  };
}
