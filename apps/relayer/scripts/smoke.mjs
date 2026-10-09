// Prueba real contra un relayer en marcha: un usuario nuevo, sin MON, recibe tUSD y registra su passkey.
// Uso: node scripts/smoke.mjs [url]   (por defecto http://localhost:8787)
import { createAval, createRelayerClient, monadTestnet } from '@aval/sdk';
import { generateKeyPairSync } from 'node:crypto';
import { createPublicClient, createWalletClient, defineChain, http, bytesToHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const url = process.argv[2] ?? 'http://localhost:8787';
const rpc = 'https://testnet-rpc.monad.xyz';
const chain = defineChain({
  id: monadTestnet.chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});

const publicClient = createPublicClient({ chain, transport: http(rpc) });
const user = privateKeyToAccount(generatePrivateKey());
const aval = createAval({ publicClient, walletClient: createWalletClient({ account: user, chain, transport: http(rpc) }) });
const relayer = createRelayerClient({ url });

const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const dec = (v) => bytesToHex(new Uint8Array(Buffer.from(v, 'base64url')));
const key = { x: dec(jwk.x), y: dec(jwk.y) };

console.log('Usuario nuevo:', user.address);
console.log('MON del usuario:', await publicClient.getBalance({ address: user.address }));

const faucet = await relayer.faucet(user.address);
console.log('Faucet ->', faucet.hash, `(${faucet.amount} unidades de tUSD)`);
console.log('tUSD del usuario:', await aval.tokens.balanceOf(user.address));

const registro = await relayer.register(await aval.passkeys.signRegister(key));
console.log('Registro de passkey ->', registro.hash);
const guardada = await aval.passkeys.keyOf(user.address);
console.log('Clave P256 guardada onchain:', guardada?.x === key.x && guardada?.y === key.y ? 'sí, coincide' : 'NO coincide');
console.log('MON del usuario al final:', await publicClient.getBalance({ address: user.address }));

// Autoriza el token y crea un permiso (el usuario sigue sin MON), y lo lee de vuelta con el listado por usuario.
await relayer.tokenPermit(await aval.tokens.signPermit({ value: 100_000_000n }));
const agente = privateKeyToAccount(generatePrivateKey()).address;
const { permitId, hash: hashPermiso } = await relayer.grant(
  await aval.permits.signGrant({ agent: agente, maxPerSpend: 50_000_000n, maxTotal: 100_000_000n, approvalThreshold: 20_000_000n, expiresIn: 3600 }),
);
console.log('Permiso creado ->', hashPermiso, `(id ${permitId})`);
const lista = await aval.permits.listByOwner(user.address);
console.log('Listado por usuario desde la cadena:', lista.length === 1 && lista[0].permitId === permitId ? 'sí, aparece el permiso' : 'NO coincide');
console.log('MON del usuario tras crear el permiso:', await publicClient.getBalance({ address: user.address }));

const otra = await relayer.faucet(user.address).then(() => 'entregó otra vez (mal)', (e) => `rechazado: ${e.code}`);
console.log('Segundo pedido al faucet:', otra);
console.log('Salud:', JSON.stringify(await relayer.health()));
