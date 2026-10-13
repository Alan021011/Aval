import {
  EVMClient,
  HTTPClient,
  LATEST_BLOCK_NUMBER,
  Runner,
  TxStatus,
  bytesToHex,
  consensusIdenticalAggregation,
  encodeCallMsg,
  getNetwork,
  handler,
  hexToBase64,
  ok,
  type EVMLog,
  type NodeRuntime,
  type Runtime,
} from '@chainlink/cre-sdk';
import {
  type Hex,
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toBytes,
  zeroAddress,
} from 'viem';
import { type Receipt, analyzePayments } from './analysis';

/**
 * Vigilante de Aval (Chainlink CRE).
 *
 * Orquesta, en cada pago de un agente en Monad testnet:
 *  1. Disparo: el evento `Spent` de AgentPermit.
 *  2. Lectura en la cadena: los recibos recientes del dueño y los límites del permiso.
 *  3. Detección determinista (todos los nodos llegan a lo mismo): pagos divididos para esquivar el máximo por pago, o
 *     ráfagas de pagos.
 *  4. LLM: Qwen 3.8 Max redacta la alerta en lenguaje claro (los nodos comparten la respuesta para llegar a consenso).
 *  5. Escritura: un reporte firmado por la red de Chainlink a AvalRiskGuard, que el agente respeta antes de pagar.
 * El vigilante solo restringe: nunca mueve fondos ni da permisos.
 */

export type Config = {
  chainSelectorName: string;
  agentPermit: string;
  riskGuard: string;
  qwenUrl: string;
  qwenModel: string;
  windowSeconds: number;
  gasLimit: string;
};

const abi = parseAbi([
  'event Spent(uint256 indexed permitId, address indexed agent, address indexed to, address owner, address token, uint256 amount, bytes32 ref, uint256 requestId)',
  'function receiptCountOf(address owner) view returns (uint256)',
  'function receiptsOf(address owner, uint256 offset, uint256 limit) view returns ((address to, uint64 permitId, uint128 amount, uint64 requestId, uint64 timestamp, bytes32 ref)[])',
  'function getPermit(uint256 permitId) view returns ((address owner, bool revoked, bool anyRecipient, uint128 spent, (address agent, uint256 agentId, address token, uint128 maxPerSpend, uint128 maxTotal, uint128 approvalThreshold, uint64 expiresAt) terms))',
]);

const SPENT_TOPIC = keccak256(toBytes('Spent(uint256,address,address,address,address,uint256,bytes32,uint256)'));
const REPORT = parseAbiParameters('address agent, uint8 level, uint64 observedAt, string reason');
const LEVELS = ['sin alerta', 'vigilar', 'bloquear'] as const;

function evmClientFor(config: Config): EVMClient {
  const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName });
  if (!network) throw new Error(`Red desconocida: ${config.chainSelectorName}`);
  return new EVMClient(network.chainSelector.selector);
}

/** Lectura de un contrato en el último bloque (incluye el pago que disparó el workflow). */
function read<T>(runtime: Runtime<Config>, evm: EVMClient, to: string, functionName: 'receiptCountOf' | 'receiptsOf' | 'getPermit', args: readonly unknown[]): T {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: to as Hex, data }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  return decodeFunctionResult({ abi, functionName, data: bytesToHex(reply.data) } as never) as T;
}

/** Qwen redacta la alerta. Si falla, queda la explicación determinista: la decisión nunca depende del LLM. */
const explainWithQwen =
  (facts: string, fallback: string, apiKey: string) =>
  (nodeRuntime: NodeRuntime<Config>): string => {
    try {
      const payload = {
        model: nodeRuntime.config.qwenModel,
        enable_thinking: false,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Eres el vigilante de riesgo de Aval. Con los hechos que te dan, escribe UNA alerta en español, de máximo 160 caracteres, para el dueño del permiso. Sin inventar datos.',
          },
          { role: 'user', content: facts },
        ],
      };
      const response = new HTTPClient()
        .sendRequest(nodeRuntime, {
          url: nodeRuntime.config.qwenUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
          // Los nodos leen la misma respuesta en caché: así coinciden y hay consenso aunque el LLM no sea determinista.
          cacheSettings: { store: true, maxAge: '120s' },
        })
        .result();
      if (!ok(response)) return fallback;
      const body = JSON.parse(new TextDecoder().decode(response.body)) as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content?.trim();
      return text ? text.slice(0, 200) : fallback;
    } catch {
      return fallback;
    }
  };

export const onPayment = (runtime: Runtime<Config>, log: EVMLog): string => {
  const config = runtime.config;
  const evm = evmClientFor(config);

  // 1. El pago que disparó el workflow.
  const event = decodeEventLog({ abi, data: bytesToHex(log.data), topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]] });
  if (event.eventName !== 'Spent') return 'Evento ignorado';
  const { permitId, agent, to, owner, amount } = event.args;
  runtime.log(`Pago observado: permiso #${permitId}, agente ${agent}, ${Number(amount) / 1e6} tUSD`);

  // 2. Lo que dice la cadena: recibos recientes del dueño y el máximo por pago del permiso.
  const count = read<bigint>(runtime, evm, config.agentPermit, 'receiptCountOf', [owner]);
  const offset = count > 10n ? count - 10n : 0n;
  const raw = read<readonly { to: string; permitId: bigint; amount: bigint; requestId: bigint; timestamp: bigint }[]>(runtime, evm, config.agentPermit, 'receiptsOf', [owner, offset, 10n]);
  const permit = read<{ terms: { maxPerSpend: bigint } }>(runtime, evm, config.agentPermit, 'getPermit', [permitId]);
  const receipts: Receipt[] = raw.map((r) => ({ to: r.to, permitId: BigInt(r.permitId), amount: BigInt(r.amount), requestId: BigInt(r.requestId), timestamp: BigInt(r.timestamp) }));

  // 3. Detección determinista.
  const finding = analyzePayments({ receipts, permitId, to, maxPerSpend: BigInt(permit.terms.maxPerSpend), windowSeconds: BigInt(config.windowSeconds) });
  runtime.log(`Análisis: nivel ${finding.level} (${LEVELS[finding.level]}). ${finding.reason}`);
  if (finding.level === 0) return `Sin riesgo: ${finding.reason}`;

  // 4. Qwen redacta la alerta (con consenso entre nodos).
  const facts = `Agente ${agent}. ${finding.reason} Nivel: ${LEVELS[finding.level]}.`;
  // El secreto se lee en el runtime principal (Vault DON en producción, .env en simulación).
  const apiKey = runtime.getSecret({ id: 'QWEN_API_KEY' }).result().value;
  const reason = runtime.runInNodeMode(explainWithQwen(facts, finding.reason, apiKey), consensusIdenticalAggregation<string>())().result();
  runtime.log(`Alerta: ${reason}`);

  // 5. Reporte firmado a AvalRiskGuard en Monad.
  const encoded = encodeAbiParameters(REPORT, [agent, finding.level, finding.observedAt, reason]);
  const report = runtime.report({ encodedPayload: hexToBase64(encoded), encoderName: 'evm', signingAlgo: 'ecdsa', hashingAlgo: 'keccak256' }).result();
  const write = evm.writeReport(runtime, { receiver: config.riskGuard, report, gasConfig: { gasLimit: config.gasLimit } }).result();
  const hash = write.txHash ? bytesToHex(write.txHash) : 'sin hash (simulación sin --broadcast)';
  runtime.log(`Reporte a AvalRiskGuard: estado ${TxStatus[write.txStatus] ?? write.txStatus}, tx ${hash}`);
  return `Nivel ${finding.level} para ${agent}: ${reason}`;
};

export const initWorkflow = (config: Config) => {
  const evm = evmClientFor(config);
  return [
    handler(
      evm.logTrigger({ addresses: [hexToBase64(config.agentPermit)], topics: [{ values: [hexToBase64(SPENT_TOPIC)] }] }),
      onPayment,
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
