// Crea en Monad testnet el caso que vigila el workflow de Chainlink CRE: un agente que DIVIDE un pago para esquivar el
// máximo por pago (60 + 60 = 120 con un máximo de 100). Un usuario nuevo sin MON da el permiso por el relayer y el agente
// de demostración paga dos veces seguidas al mismo servicio. Imprime el hash del segundo pago para simular el workflow.
// Uso: node scripts/split-payments.mjs [url]
import { createAval, createRelayerClient, monadTestnet } from '@aval/sdk';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const url = process.argv[2] ?? 'https://aval-relayer.vercel.app';
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

const info = await relayer.agent.info();
console.log('Agente:', info.address, '· servicio:', info.service.address);
console.log('Usuario nuevo:', user.address);

await relayer.faucet(user.address);
await relayer.tokenPermit(await aval.tokens.signPermit({ value: 300_000_000n }));
// Umbral de aprobación igual al máximo: los pagos de 60 pasan solos, sin huella.
const { permitId } = await relayer.grant(
  await aval.permits.signGrant({
    agent: info.address,
    maxPerSpend: 100_000_000n,
    maxTotal: 300_000_000n,
    approvalThreshold: 100_000_000n,
    expiresIn: 3600,
    recipients: [info.service.address],
  }),
);
console.log(`Permiso #${permitId}: máximo 100 tUSD por pago`);

const first = await relayer.agent.spend({ permitId, amount: 60_000_000n, ref: 'parte-1' });
console.log('Pago 1 (60 tUSD):', first.hash);
const second = await relayer.agent.spend({ permitId, amount: 60_000_000n, ref: 'parte-2' });
console.log('Pago 2 (60 tUSD):', second.hash);

// Índice del evento Spent dentro de la transacción (lo pide `cre workflow simulate --evm-event-index`).
const receipt = await publicClient.waitForTransactionReceipt({ hash: second.hash });
const topic = keccak256(toBytes('Spent(uint256,address,address,address,address,uint256,bytes32,uint256)'));
const index = receipt.logs.findIndex((l) => l.topics[0] === topic);
console.log(`\nPara simular el vigilante:\n  --evm-tx-hash ${second.hash} --evm-event-index ${index}`);
