import { createPasskeyWithPrfOutput, createSecp256k1SigningSession, getEvmAddress, getPasskeyPrfOutput } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { type ClaveP256, clienteConCaptura, rpId } from './p256';

// Misma derivación que Garante: el PRF de la passkey es la entropía de una cuenta BIP-44.
function abrirSesion(prfOutput: Uint8Array) {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist);
  const nodo = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive("m/44'/60'/0'/0/0");
  if (!nodo.privateKey) throw new Error('No se pudo derivar la clave');
  const sesion = createSecp256k1SigningSession({ privateKey: nodo.privateKey });
  return { sesion, direccion: getEvmAddress(sesion.publicKey), cuenta: toViemAccount(sesion) };
}

export type Cuenta = ReturnType<typeof abrirSesion> & {
  credentialId: string;
  clave: ClaveP256 | null;
  ceremonias: number;
};

export async function crearCuenta(nombre: string): Promise<Cuenta> {
  const captura = clienteConCaptura();
  const creada = await createPasskeyWithPrfOutput({
    rp: { id: rpId(), name: 'Aval' },
    user: { name: nombre, displayName: nombre },
    webAuthnClient: captura.cliente,
  });
  return {
    ...abrirSesion(creada.prfOutput),
    credentialId: creada.credentialId,
    clave: captura.clave(),
    ceremonias: captura.ceremonias(),
  };
}

// Al entrar no hay creación, así que la clave P256 no vuelve: tendrá que leerse de la cadena.
export async function entrar(): Promise<Cuenta> {
  const captura = clienteConCaptura();
  const { credentialId, prfOutput } = await getPasskeyPrfOutput({ rpId: rpId(), webAuthnClient: captura.cliente });
  return { ...abrirSesion(prfOutput), credentialId, clave: null, ceremonias: captura.ceremonias() };
}
