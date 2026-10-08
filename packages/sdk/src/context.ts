import type { Abi, Address, Hash, PublicClient, TransactionReceipt, WalletClient } from 'viem';
import type { AvalAddresses } from './addresses.js';
import { AvalError, explainError } from './errors.js';
import type { AssertionProvider } from './webauthn.js';

/** Contexto compartido por todos los módulos del SDK. */
export type Ctx = {
  publicClient: PublicClient;
  walletClient: WalletClient | undefined;
  addresses: AvalAddresses;
  assertionProvider: AssertionProvider;
};

export type Sent = { hash: Hash; receipt: TransactionReceipt };

type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

export function requireWallet(ctx: Ctx): WalletClient & { account: NonNullable<WalletClient['account']> } {
  const wallet = ctx.walletClient;
  if (!wallet?.account) {
    throw new AvalError('NoWallet', 'Esta operación necesita un `walletClient` con cuenta.');
  }
  return wallet as WalletClient & { account: NonNullable<WalletClient['account']> };
}

export async function read<T>(ctx: Ctx, call: Call): Promise<T> {
  try {
    return (await ctx.publicClient.readContract(call as never)) as T;
  } catch (error) {
    throw explainError(error);
  }
}

/** Simula primero (para que un revert llegue explicado y sin gastar gas), luego envía y espera el recibo. */
export async function send(ctx: Ctx, call: Call): Promise<Sent> {
  const wallet = requireWallet(ctx);
  try {
    const { request } = await ctx.publicClient.simulateContract({ ...call, account: wallet.account } as never);
    const hash = await wallet.writeContract(request as never);
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new AvalError('Reverted', 'La transacción se revirtió en la cadena.');
    return { hash, receipt };
  } catch (error) {
    throw explainError(error);
  }
}
