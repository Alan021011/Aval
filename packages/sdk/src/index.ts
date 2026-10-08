import type { PublicClient, WalletClient } from 'viem';
import { type AvalAddresses, monadTestnet } from './addresses.js';
import type { Ctx } from './context.js';
import { createPasskeys } from './passkeys.js';
import { createPermits } from './permits.js';
import { createReputation } from './reputation.js';
import { createTokens } from './tokens.js';
import { type AssertionProvider, browserAssertion } from './webauthn.js';

export type CreateAvalOptions = {
  /** Cliente de lectura de viem conectado a la red de Aval. */
  publicClient: PublicClient;
  /** Cliente con la cuenta que firma y envía. Hace falta para escribir. */
  walletClient?: WalletClient;
  /** Direcciones de los contratos. Por defecto, el despliegue en Monad testnet. */
  addresses?: AvalAddresses;
  /** Cómo se pide la huella al usuario. Por defecto, WebAuthn del navegador. */
  assertionProvider?: AssertionProvider;
};

/**
 * Punto de entrada del SDK.
 *
 * ```ts
 * const aval = createAval({ publicClient, walletClient });
 * const { permitId } = await aval.permits.grant({
 *   agent, maxPerSpend: 50_000000n, maxTotal: 300_000000n,
 *   approvalThreshold: 20_000000n, expiresIn: 86400,
 * });
 * ```
 */
export function createAval(options: CreateAvalOptions) {
  const addresses = options.addresses ?? monadTestnet;
  const ctx: Ctx = {
    publicClient: options.publicClient,
    walletClient: options.walletClient,
    addresses,
    assertionProvider: options.assertionProvider ?? browserAssertion,
  };

  return {
    addresses,
    passkeys: createPasskeys(ctx),
    permits: createPermits(ctx),
    reputation: createReputation(ctx),
    tokens: createTokens(ctx),
  };
}

export type Aval = ReturnType<typeof createAval>;

export { monadTestnet, erc8004MonadTestnet, P256_PRECOMPILE } from './addresses.js';
export type { AvalAddresses } from './addresses.js';
export { AvalError, explainError } from './errors.js';
export type { GrantInput, Permit, SpendRequest, SignedGrant, SignedRevoke } from './permits.js';
export { recipientsHash, toRef } from './permits.js';
export type { SignedRegister } from './passkeys.js';
export type { SignedTokenPermit } from './tokens.js';
export type { SummaryOptions, VerifiedSummary } from './reputation.js';
export {
  browserAssertion,
  buildAuth,
  derToRS,
  fromBase64Url,
  publicKeyFromSpki,
  toBase64Url,
  P256_N,
} from './webauthn.js';
export type { AssertionProvider, PasskeyPublicKey, RawAssertion, WebAuthnAuth } from './webauthn.js';
