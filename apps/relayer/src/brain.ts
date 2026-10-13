import { type Aval } from '@aval/sdk';
import type { Address, Hex } from 'viem';
import type { DemoAgent } from './agent.js';
import { RelayerError, SlidingWindow } from './limits.js';
import { type ChatFn, type Step, type Tool, runPlanner } from './qwen.js';
import { type Context, limited } from './runtime.js';

/**
 * El "cerebro" del agente de demostración: Qwen planifica y usa herramientas reales sobre Monad. Cada herramienta pasa
 * por el agente (que solo paga al servicio fijo y solo con permisos que el usuario le dio) y por el contrato, que
 * decide. Si el contrato rechaza un pago, el rechazo vuelve a Qwen y Qwen cambia de plan.
 */

const UNIT = 1_000_000;
const tusd = (units: bigint) => Number(units) / UNIT;

const SYSTEM = `Eres el agente de IA de un usuario de Aval, en Monad testnet. Trabajas con dólares de prueba (tUSD).
El usuario te dio un PERMISO con límites: un máximo por pago, un total y un umbral; los pagos sobre el umbral necesitan que el usuario los apruebe con su huella. El contrato hace cumplir esas reglas, no tú.
Solo puedes pagarle al "Servicio de traducción" (agente ERC-8004).

Cómo trabajas:
1. Antes de pagar, consulta tu permiso (consultar_permiso) y la reputación verificada del servicio (consultar_reputacion).
2. Si la tarea puede depender de las preferencias del usuario, lee la memoria que te compartió (leer_memoria_compartida).
3. Paga con pagar_servicio. Si el contrato lo rechaza, lee el motivo y cambia de plan:
   - NeedsApproval (supera el umbral): usa pedir_aprobacion con el mismo monto; el usuario lo aprobará con su huella.
   - ExceedsPerSpendLimit o ExceedsTotalLimit: no pagues nada; explica el límite y deja que el usuario decida (por ejemplo, que suba su límite).
   - NUNCA dividas un pago en varios para esquivar un límite: el límite lo fijó el usuario a propósito.
   - PermitInactive: el permiso venció o fue revocado; avísale al usuario.
4. Reseña al servicio (reseñar_servicio) solo si pagaste en esta tarea y el usuario lo pidió.
Nunca inventes resultados: usa solo lo que devuelven las herramientas. Responde al final en español, en 2 a 4 frases, diciendo qué hiciste y qué falta (por ejemplo, que el usuario apruebe un pago).`;

const amountSchema = { type: 'number', description: 'Monto en tUSD (dólares de prueba), por ejemplo 25 o 75.5', minimum: 0.01, maximum: 10000 };

function toUnits(value: unknown): bigint {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000) throw new Error('El monto debe estar entre 0,01 y 10.000 tUSD.');
  return BigInt(Math.round(n * UNIT));
}

/** Explica un rechazo del contrato con los montos en tUSD, para que el modelo entienda qué pasó. */
function rejection(error: unknown) {
  if (error instanceof RelayerError) {
    const [a, b] = error.args;
    const amounts = typeof a === 'bigint' && typeof b === 'bigint' ? { monto: tusd(a), limite: tusd(b) } : {};
    return { ok: false, rechazoDelContrato: error.code, explicacion: error.message, ...amounts };
  }
  throw error;
}

export function createAgentBrain(options: { agent: DemoAgent; reader: Aval; chat: ChatFn }) {
  const { agent, reader, chat } = options;
  // Cada tarea llama al modelo varias veces: se limita fuerte por IP.
  const tasksByIp = new SlidingWindow(60_000);

  return {
    async runTask(
      input: { owner: Address; permitId: bigint; task: string; memoryKey?: Hex },
      ctx: Context,
    ): Promise<{ steps: Step[]; answer: string }> {
      limited(tasksByIp.hit(ctx.ip, 6, Date.now()), 'para pedirle tareas al agente desde esta IP');

      // El permiso tiene que ser de este usuario y para este agente: si no, no hay nada que hacer.
      const permit = await reader.permits.get(input.permitId).catch(() => null);
      if (!permit || permit.owner.toLowerCase() !== input.owner.toLowerCase()) {
        throw new RelayerError(400, 'PermitNotYours', 'Ese permiso no es de esta cuenta.');
      }
      if (permit.terms.agent.toLowerCase() !== agent.address.toLowerCase()) {
        throw new RelayerError(400, 'PermitNotForAgent', 'Ese permiso no es para el agente de demostración.');
      }

      const tools: Record<string, Tool> = {
        consultar_permiso: {
          spec: {
            type: 'function',
            function: { name: 'consultar_permiso', description: 'Lee en la cadena los límites y el saldo restante de tu permiso.', parameters: { type: 'object', properties: {} } },
          },
          async run() {
            const p = await reader.permits.get(input.permitId);
            const remaining = await reader.permits.remaining(input.permitId);
            const now = BigInt(Math.floor(Date.now() / 1000));
            return {
              activo: !p.revoked && p.terms.expiresAt > now,
              maximoPorPago: tusd(p.terms.maxPerSpend),
              total: tusd(p.terms.maxTotal),
              gastado: tusd(p.spent),
              restante: tusd(remaining),
              aprobacionDelUsuarioSobre: tusd(p.terms.approvalThreshold),
              venceEnMinutos: Math.max(0, Number(p.terms.expiresAt - now) / 60),
            };
          },
        },
        consultar_reputacion: {
          spec: {
            type: 'function',
            function: {
              name: 'consultar_reputacion',
              description: 'Reputación verificada del Servicio de traducción: solo cuenta reseñas de clientes que de verdad le pagaron.',
              parameters: { type: 'object', properties: {} },
            },
          },
          async run() {
            const s = await reader.reputation.summary(agent.service.agentId, { tag1: 'calidad' });
            return {
              servicio: 'Servicio de traducción',
              agentId: agent.service.agentId.toString(),
              promedio: s.count > 0n ? Number(s.value) / 10 ** s.decimals : null,
              reseniasQueCuentan: Number(s.count),
              clientesVerificados: Number(s.verifiedClients),
            };
          },
        },
        leer_memoria_compartida: {
          spec: {
            type: 'function',
            function: {
              name: 'leer_memoria_compartida',
              description: 'Lee la parte de la memoria cifrada que el usuario te compartió (sus preferencias). Puede no haber acceso.',
              parameters: { type: 'object', properties: {} },
            },
          },
          async run() {
            if (!input.memoryKey) return { acceso: false, motivo: 'El usuario no te dio la clave de su memoria en esta tarea.' };
            try {
              const read = await agent.recall({ owner: input.owner, key: input.memoryKey }, ctx);
              return { acceso: true, texto: read.text, version: read.version };
            } catch (error) {
              if (error instanceof RelayerError) return { acceso: false, motivo: error.message };
              throw error;
            }
          },
        },
        pagar_servicio: {
          spec: {
            type: 'function',
            function: {
              name: 'pagar_servicio',
              description: 'Paga al Servicio de traducción con tu permiso. El contrato puede rechazarlo si supera un límite o el umbral.',
              parameters: {
                type: 'object',
                properties: { monto_tusd: amountSchema, motivo: { type: 'string', description: 'Para qué es el pago, muy corto' } },
                required: ['monto_tusd'],
              },
            },
          },
          async run(args) {
            try {
              const { hash } = await agent.spend({ permitId: input.permitId, amount: toUnits(args.monto_tusd), ref: 'qwen-pago' }, ctx);
              return { ok: true, pagado: Number(args.monto_tusd), hash };
            } catch (error) {
              return rejection(error);
            }
          },
        },
        pedir_aprobacion: {
          spec: {
            type: 'function',
            function: {
              name: 'pedir_aprobacion',
              description: 'Pide un pago que supera el umbral: queda pendiente hasta que el usuario lo apruebe con su huella.',
              parameters: {
                type: 'object',
                properties: { monto_tusd: amountSchema, motivo: { type: 'string', description: 'Para qué es el pago, muy corto' } },
                required: ['monto_tusd'],
              },
            },
          },
          async run(args) {
            try {
              const { hash, requestId } = await agent.request({ permitId: input.permitId, amount: toUnits(args.monto_tusd), ref: 'qwen-aprobacion' }, ctx);
              return { ok: true, pedido: requestId.toString(), estado: 'pendiente: el usuario debe aprobarlo con su huella', hash };
            } catch (error) {
              return rejection(error);
            }
          },
        },
        reseniar_servicio: {
          spec: {
            type: 'function',
            function: {
              name: 'reseniar_servicio',
              description: 'Deja una reseña del Servicio de traducción (0 a 100) en ERC-8004. Solo si pagaste en esta tarea.',
              parameters: { type: 'object', properties: { puntaje: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['puntaje'] },
            },
          },
          async run(args) {
            const value = Math.round(Number(args.puntaje));
            if (!(value >= 0 && value <= 100)) throw new Error('El puntaje debe estar entre 0 y 100.');
            const { hash } = await agent.review({ value, tag: 'calidad' }, ctx);
            return { ok: true, puntaje: value, hash };
          },
        },
      };

      try {
        return await runPlanner({ chat, tools, system: SYSTEM, task: input.task, maxSteps: 8, deadlineMs: 50_000 });
      } catch (error) {
        if (error instanceof RelayerError) throw error;
        // Qwen no respondió (tiempo, red o cuota): un error claro, sin detalles internos.
        console.error('[agente] Qwen falló:', error instanceof Error ? error.message.slice(0, 200) : error);
        throw new RelayerError(502, 'AgentBrainUnavailable', 'Qwen no respondió a tiempo. Intenta de nuevo en un momento.');
      }
    },
  };
}

export type AgentBrain = ReturnType<typeof createAgentBrain>;
