import { createPasskeyWithPrfOutput, createSecp256k1SigningSession, getEvmAddress, getPasskeyPrfOutput } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import type { PasskeyPublicKey } from '@aval/sdk';
import type { Address, LocalAccount } from 'viem';
import type { Backend } from './passkey';

/**
 * Sesión de la cuenta del usuario. La cuenta sale de la passkey con Mera (PRF → BIP-39 → BIP-44), así que la misma
 * passkey da siempre la misma cuenta, en cualquier dispositivo, sin guardar nada. Mientras la sesión está abierta se
 * firma sin pedir la huella; al cerrarla (`end`) la clave desaparece de la memoria.
 */
export type Session = {
  address: Address;
  account: LocalAccount;
  credentialId: string;
  end(): void;
};

const rpId = () => window.location.hostname;

function openSession(prfOutput: Uint8Array, credentialId: string): Session {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist);
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive("m/44'/60'/0'/0/0");
  if (!node.privateKey) throw new Error('No se pudo derivar la cuenta');
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  return {
    address: getEvmAddress(session.publicKey),
    account: toViemAccount(session) as LocalAccount,
    credentialId,
    end: () => session.end(),
  };
}

/** Crea una cuenta nueva con UNA sola ceremonia de passkey. Devuelve también la clave P256 de esa passkey. */
export async function createAccount(backend: Backend, name: string): Promise<{ session: Session; publicKey: PasskeyPublicKey }> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: rpId(), name: 'Aval' },
    user: { name, displayName: name },
    webAuthnClient: backend.webAuthnClient,
  });
  const publicKey = backend.capturedKey();
  if (!publicKey) throw new Error('No se pudo leer la clave de la passkey');
  return { session: openSession(created.prfOutput, created.credentialId), publicKey };
}

/** Entra con una passkey existente: una ceremonia, y la cuenta (y todo su estado) se reconstruye desde la cadena. */
export async function signIn(backend: Backend): Promise<Session> {
  const { credentialId, prfOutput } = await getPasskeyPrfOutput({ rpId: rpId(), webAuthnClient: backend.webAuthnClient });
  return openSession(prfOutput, credentialId);
}
