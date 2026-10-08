import type { Address, Hex } from 'viem';
import { isAddress, isHex } from 'viem';
import { z } from 'zod';

/** Validación estricta de todo lo que llega al relayer. Cualquier campo extra o fuera de rango se rechaza. */

const address = z.custom<Address>((v) => typeof v === 'string' && isAddress(v, { strict: false }), 'Dirección inválida');
const hex = (maxBytes: number) =>
  z.custom<Hex>((v) => typeof v === 'string' && isHex(v) && v.length <= 2 + maxBytes * 2, 'Hex inválido');
const hex32 = z.custom<Hex>((v) => typeof v === 'string' && isHex(v) && v.length === 66, 'Se esperaban 32 bytes');
const uint = (bits: number) => z.bigint().min(0n).max((1n << BigInt(bits)) - 1n);
const signature = hex(1024);

export const registerSchema = z.strictObject({
  owner: address,
  key: z.strictObject({ x: hex32, y: hex32 }),
  deadline: uint(64),
  signature,
});

export const grantSchema = z.strictObject({
  owner: address,
  input: z.strictObject({
    agent: address,
    agentId: uint(64),
    token: address,
    maxPerSpend: uint(128),
    maxTotal: uint(128),
    approvalThreshold: uint(128),
    expiresAt: uint(64),
    recipients: z.array(address).max(50),
  }),
  deadline: uint(64),
  signature,
});

export const revokeSchema = z.strictObject({
  permitId: uint(64),
  deadline: uint(64),
  signature,
});

export const tokenPermitSchema = z.strictObject({
  token: address,
  owner: address,
  value: uint(256),
  deadline: uint(64),
  signature,
});

export const approveSchema = z.strictObject({
  requestId: uint(64),
  auth: z.strictObject({
    r: hex32,
    s: hex32,
    challengeIndex: uint(32),
    typeIndex: uint(32),
    authenticatorData: hex(512),
    clientDataJSON: z.string().max(2048),
  }),
});

export const faucetSchema = z.strictObject({ to: address });

export const schemas = {
  register: registerSchema,
  grant: grantSchema,
  revoke: revokeSchema,
  'token-permit': tokenPermitSchema,
  approve: approveSchema,
} as const;

export type RelayKind = keyof typeof schemas;
export const isRelayKind = (value: string): value is RelayKind => value in schemas;
