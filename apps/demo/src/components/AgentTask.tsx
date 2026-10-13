import { AvalError, type AgentTaskStep } from '@aval/sdk';
import { useState } from 'react';
import type { App } from '../state/useAval';
import type { Memory } from '../state/useMemory';
import { Button, Card, Field, Icon } from './ui';

const DEFAULT_TASK = 'Necesito traducir un contrato. El servicio cobra 75 tUSD: contrátalo si su reputación es buena y ten en cuenta mis preferencias.';

/** Nombre legible de cada herramienta que usa el agente. */
const LABELS: Record<string, string> = {
  consultar_permiso: 'Revisó su permiso',
  consultar_reputacion: 'Consultó la reputación verificada del servicio',
  leer_memoria_compartida: 'Leyó tu memoria compartida',
  pagar_servicio: 'Intentó pagar',
  pedir_aprobacion: 'Pidió tu aprobación',
  reseniar_servicio: 'Reseñó al servicio',
};

function summary(step: Extract<AgentTaskStep, { kind: 'tool' }>): { tone: 'ok' | 'bad'; text: string } {
  const r = (step.result ?? {}) as Record<string, unknown>;
  if (typeof r.error === 'string') return { tone: 'bad', text: r.error };
  switch (step.name) {
    case 'consultar_permiso':
      return { tone: 'ok', text: `Máximo ${r.maximoPorPago} por pago, te pide aprobación sobre ${r.aprobacionDelUsuarioSobre}, quedan ${r.restante} tUSD.` };
    case 'consultar_reputacion':
      return { tone: 'ok', text: r.promedio === null ? 'Todavía sin reseñas que cuenten.' : `${r.promedio}/100 con ${r.reseniasQueCuentan} reseña(s) de clientes que pagaron.` };
    case 'leer_memoria_compartida':
      return r.acceso ? { tone: 'ok', text: `«${String(r.texto)}»` } : { tone: 'bad', text: String(r.motivo) };
    case 'pagar_servicio':
    case 'pedir_aprobacion':
      if (r.ok === false) return { tone: 'bad', text: `El contrato lo rechazó (${String(r.rechazoDelContrato)}): ${String(r.explicacion)}` };
      return step.name === 'pagar_servicio'
        ? { tone: 'ok', text: `Pagó ${String(r.pagado)} tUSD.` }
        : { tone: 'ok', text: `Pedido #${String(r.pedido)} pendiente: apruébalo abajo con tu huella.` };
    case 'reseniar_servicio':
      return { tone: 'ok', text: `Puntaje ${String(r.puntaje)}/100.` };
    default:
      return { tone: 'ok', text: 'Listo.' };
  }
}

/** Una tarea en lenguaje natural para el agente: Qwen planifica y usa herramientas reales sobre Monad. */
export function AgentTaskCard({ app, memory }: { app: App; memory: Memory }) {
  const [task, setTask] = useState(DEFAULT_TASK);
  const [shareMemory, setShareMemory] = useState(true);
  const [result, setResult] = useState<{ steps: AgentTaskStep[]; answer: string } | null>(null);
  const permit = app.currentPermit;
  const locked = app.phase === 'locked';
  const memoryKey = memory.agentKey();

  const run = () =>
    app.bridge.act('agent-task', async () => {
      if (!permit || !app.address) throw new Error('Primero dale un permiso a tu agente.');
      setResult(null);
      try {
        const t0 = performance.now();
        const done = await app.bridge.relayer.agent.task({
          owner: app.address,
          permitId: permit.permitId,
          task,
          ...(shareMemory && memoryKey ? { memoryKey } : {}),
        });
        setResult(done);
        app.bridge.addLog({ kind: 'info', title: `Qwen resolvió la tarea en ${done.steps.length} paso(s)`, ms: performance.now() - t0 });
        await app.bridge.refresh();
      } catch (e) {
        if (e instanceof AvalError && e.code === 'AgentBrainDisabled') {
          throw new Error('El agente con Qwen todavía no está activo en el relayer.');
        }
        throw e;
      }
    });

  return (
    <Card id="agent-task" title="Pídele algo a tu agente" subtitle="Un agente con Qwen planifica y usa herramientas reales: revisa su permiso, la reputación y tu memoria, paga o te pide aprobación.">
      {!permit ? (
        <p className="empty">Primero dale un permiso a tu agente.</p>
      ) : (
        <div className="memory">
          <Field label="La tarea" hint="En lenguaje natural. Solo puede pagarle al Servicio de traducción, y siempre dentro de tu permiso.">
            <textarea value={task} maxLength={500} onChange={(e) => setTask(e.target.value)} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={shareMemory} disabled={!memoryKey} onChange={(e) => setShareMemory(e.target.checked)} />
            <span>{memoryKey ? 'Que pueda leer la memoria que le compartiste' : 'Comparte tu memoria con el agente (tarjeta de abajo) para que conozca tus preferencias'}</span>
          </label>
          <div className="memory-buttons">
            <Button variant="primary" icon="bot" loading={app.busy === 'agent-task'} disabled={locked || !!app.busy || task.trim().length < 3} onClick={run}>
              Pedírselo a Qwen
            </Button>
          </div>

          {result ? (
            <>
              <ol className="steps-agent">
                {result.steps.map((step, i) =>
                  step.kind === 'tool' ? (
                    <li key={i} className={`step-agent step-${summary(step).tone}`}>
                      <Icon name={summary(step).tone === 'ok' ? 'check' : 'shield'} size={16} />
                      <div>
                        <strong>{LABELS[step.name] ?? step.name}</strong>
                        <p>{summary(step).text}</p>
                      </div>
                    </li>
                  ) : null,
                )}
              </ol>
              <div className="callout callout-accent" role="status">
                <Icon name="bot" />
                <div>
                  <strong>Tu agente</strong>
                  <p>{result.answer}</p>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </Card>
  );
}
