import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { type Hex, bytesToHex } from 'viem';
import { type AssertionProvider, type PasskeyPublicKey, toBase64Url } from '../src/webauthn.js';

/** Passkey simulada: hace lo mismo que un autenticador real, firmando con una clave P-256 en Node. */
export function simulatedPasskey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const decode = (v: string): Hex => bytesToHex(new Uint8Array(Buffer.from(v, 'base64url')));
  const key: PasskeyPublicKey = { x: decode(jwk.x as string), y: decode(jwk.y as string) };

  const provider: AssertionProvider = async ({ challenge }) => {
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: toBase64Url(challenge),
        origin: 'http://localhost:5173',
        crossOrigin: false,
      }),
    );
    // authenticatorData = sha256(rpId) || banderas (UP + UV) || contador
    const authenticatorData = Buffer.concat([
      createHash('sha256').update('localhost').digest(),
      Buffer.from([0x05]),
      Buffer.alloc(4),
    ]);
    // WebAuthn firma authenticatorData || sha256(clientDataJSON); `sign('sha256', ...)` aplica el sha256 final.
    const signedData = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
    const signature = sign('sha256', signedData, { key: privateKey, dsaEncoding: 'der' });
    return {
      authenticatorData: new Uint8Array(authenticatorData),
      clientDataJSON,
      signature: new Uint8Array(signature),
    };
  };

  return { key, provider };
}

async function responde(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Levanta una copia local de Monad testnet con anvil. Devuelve `null` si anvil no está instalado. */
export async function startAnvil(port: number, forkUrl: string): Promise<ChildProcess | null> {
  const url = `http://127.0.0.1:${port}`;
  // Si ya hay algo escuchando en el puerto, es un anvil viejo con estado ya usado: no se reutiliza.
  if (await responde(url)) throw new Error(`El puerto ${port} ya está en uso; cierra el anvil anterior.`);

  // Sin shell: así `kill()` mata a anvil y no solo a un intérprete intermedio.
  const child = spawn('anvil', ['--fork-url', forkUrl, '--port', String(port), '--silent'], { stdio: 'ignore' });
  let missing = false;
  child.on('error', () => {
    missing = true;
  });

  for (let i = 0; i < 80; i++) {
    if (missing) return null;
    if (await responde(url)) return child;
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  return null;
}
