// Prueba real del flujo completo con el agente de demostración, contra un relayer en marcha (por defecto, el publicado).
// Un usuario nuevo SIN MON: recibe tUSD, registra su passkey, da un permiso al agente, el agente paga, se topa con los
// límites, pide una aprobación, el usuario aprueba con (una simulación de) su huella y el agente reseña al servicio.
// Uso: node scripts/smoke-agent.mjs [url]
import { createAval, createRelayerClient, monadTestnet } from '@aval/sdk';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { bytesToHex, createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const url = process.argv[2] ?? 'https://aval-relayer.vercel.app';
const rpc = 'https://testnet-rpc.monad.xyz';
const chain = defineChain({
  id: monadTestnet.chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});

// Passkey simulada: firma como un autenticador real, con una clave P-256 de Node.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const dec = (v) => bytesToHex(new Uint8Array(Buffer.from(v, 'base64url')));
const key = { x: dec(jwk.x), y: dec(jwk.y) };
const assertionProvider = async ({ challenge }) => {
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({ type: 'webauthn.get', challenge: Buffer.from(challenge).toString('base64url'), origin: 'https://demo', crossOrigin: false }),
  );
  const authenticatorData = Buffer.concat([createHash('sha256').update('demo').digest(), Buffer.from([0x05]), Buffer.alloc(4)]);
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
  return {
    authenticatorData: new Uint8Array(authenticatorData),
    clientDataJSON,
    signature: new Uint8Array(sign('sha256', signed, { key: privateKey, dsaEncoding: 'der' })),
  };
};

const publicClient = createPublicClient({ chain, transport: http(rpc) });
const user = privateKeyToAccount(generatePrivateKey());
const aval = createAval({
  publicClient,
  walletClient: createWalletClient({ account: user, chain, transport: http(rpc) }),
  assertionProvider,
});
const relayer = createRelayerClient({ url });

const paso = (texto) => console.log(`\n▸ ${texto}`);
// Comprueba que la acción se rechace con ESE código de error: cualquier otro fallo (gas, red...) no cuenta como éxito.
const intenta = async (texto, esperado, accion) => {
  try {
    await accion();
    console.log(`  ✗ ${texto}: NO fue rechazado (mal)`);
    process.exitCode = 1;
  } catch (e) {
    const bien = e.code === esperado;
    console.log(`  ${bien ? '✓' : '✗'} ${texto}: rechazado con ${e.code}${bien ? '' : ` (se esperaba ${esperado})`} — ${e.message}`);
    if (!bien) process.exitCode = 1;
  }
};
const t0 = Date.now();

const info = await relayer.agent.info();
console.log('Agente de demostración:', info.address, `(${info.balance} MON, listo: ${info.ready})`);
console.log('Servicio al que paga:  ', info.service.address, `(agente #${info.service.agentId})`);
console.log('Usuario nuevo:         ', user.address, '· MON:', await publicClient.getBalance({ address: user.address }));

paso('El usuario se prepara (todo lo envía el relayer)');
await relayer.faucet(user.address);
await relayer.register(await aval.passkeys.signRegister(key));
await relayer.tokenPermit(await aval.tokens.signPermit({ value: 300_000_000n }));
const { permitId } = await relayer.grant(
  await aval.permits.signGrant({
    agent: info.address,
    maxPerSpend: 100_000_000n,
    maxTotal: 300_000_000n,
    approvalThreshold: 50_000_000n,
    expiresIn: 3600,
    recipients: [info.service.address],
  }),
);
console.log(`  permiso #${permitId} creado · listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

paso('El agente actúa');
await relayer.agent.spend({ permitId, amount: 20_000_000n, ref: 'traduccion-1' });
console.log('  ✓ pagó 20 tUSD dentro del límite');
await intenta('pagar 150 tUSD (supera el máximo por pago)', 'ExceedsPerSpendLimit', () => relayer.agent.spend({ permitId, amount: 150_000_000n }));
await intenta('pagar 80 tUSD directo (supera el umbral de aprobación)', 'NeedsApproval', () => relayer.agent.spend({ permitId, amount: 80_000_000n }));
const { requestId } = await relayer.agent.request({ permitId, amount: 80_000_000n, ref: 'traduccion-grande' });
console.log(`  ✓ pidió aprobación para 80 tUSD (pedido #${requestId})`);

paso('El usuario aprueba con su huella');
const antes = await aval.tokens.balanceOf(info.service.address);
await relayer.approve(requestId, await aval.permits.signApproval(requestId));
const despues = await aval.tokens.balanceOf(info.service.address);
console.log(`  ✓ aprobado: el servicio recibió ${despues - antes} unidades (80 tUSD = 80000000)`);

paso('El agente reseña al servicio y se calcula la reputación verificada');
await relayer.agent.review({ value: 90 });
const reputacion = await aval.reputation.summary(info.service.agentId, { tag1: 'calidad' });
console.log(`  reseñas que cuentan: ${reputacion.count} · promedio: ${reputacion.value} · clientes verificados: ${reputacion.verifiedClients}`);

paso('Estado reconstruido solo desde la cadena (como lo haría la app en otro dispositivo)');
const fresco = createAval({ publicClient });
const recibos = await fresco.permits.receiptsOf(user.address);
console.log('  recibos:', recibos.map((r) => `${r.amount / 1_000_000n} tUSD${r.requestId ? ' (aprobado)' : ''}`).join(', '));
console.log('  permisos:', (await fresco.permits.listByOwner(user.address)).map((p) => `#${p.permitId} gastado ${p.permit.spent / 1_000_000n} de ${p.permit.terms.maxTotal / 1_000_000n}`).join(', '));
console.log('  clave P256 guardada:', (await fresco.passkeys.keyOf(user.address))?.x === key.x ? 'sí' : 'NO');
console.log('\nMON del usuario al final:', await publicClient.getBalance({ address: user.address }), '· tiempo total', `${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log('Salud del relayer:', JSON.stringify(await relayer.health()));
