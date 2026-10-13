import { AvalError, type AgentTaskStep } from '@aval/sdk';
import { useState } from 'react';
import { usd } from '../lib/format';
import { href } from '../lib/router';
import type { App } from '../state/useAval';
import type { Memory } from '../state/useMemory';
import { Badge, Button, Card, Empty, Icon, LinkButton, PageHead, ScrollIntoView } from './ui';

const DEFAULT_TASK = 'Necesito traducir un contrato. El servicio cobra 75 tUSD: contrátalo si su reputación es buena y ten en cuenta mis preferencias.';

export type TaskResult = { steps: AgentTaskStep[]; answer: string; ms: number };

/** Nombre legible de cada herramienta que usa el agente. */
const LABELS: Record<string, string> = {
  consultar_permiso: 'Revisó su permiso',
  consultar_reputacion: 'Consultó la reputación verificada del servicio',
  leer_memoria_compartida: 'Leyó tu memoria compartida',
  pagar_servicio: 'Intentó pagar',
  pedir_aprobacion: 'Pidió tu aprobación',
  reseniar_servicio: 'Reseñó al servicio',
};

const TOOLS = [
  ['tune', 'Revisar su permiso'],
  ['workspace_premium', 'Consultar la reputación verificada'],
  ['encrypted', 'Leer tu memoria compartida'],
  ['payments', 'Pagar al servicio'],
  ['fingerprint', 'Pedirte aprobación'],
  ['star', 'Reseñar al servicio'],
] as const;

type Summary = { tone: 'ok' | 'bad' | 'warn'; text: string; tag?: string; icon?: string };

function summary(step: Extract<AgentTaskStep, { kind: 'tool' }>): Summary {
  const r = (step.result ?? {}) as Record<string, unknown>;
  if (typeof r.error === 'string') return { tone: 'bad', text: r.error };
  switch (step.name) {
    case 'consultar_permiso':
      return { tone: 'ok', tag: 'Válido', text: `Máximo ${r.maximoPorPago} por pago, te pide aprobación sobre ${r.aprobacionDelUsuarioSobre}, quedan ${r.restante} tUSD.` };
    case 'consultar_reputacion':
      return {
        tone: 'ok',
        tag: 'ERC-8004',
        text: r.promedio === null ? 'Todavía sin reseñas que cuenten.' : `${r.promedio}/100 con ${r.reseniasQueCuentan} reseña(s) de clientes que pagaron.`,
      };
    case 'leer_memoria_compartida':
      return r.acceso ? { tone: 'ok', tag: 'Autorizado', text: `«${String(r.texto)}»` } : { tone: 'warn', tag: 'Sin acceso', icon: 'key_off', text: String(r.motivo) };
    case 'pagar_servicio':
    case 'pedir_aprobacion':
      if (r.ok === false) {
        const why: Record<string, string> = {
          NeedsApproval: 'supera tu umbral de aprobación',
          ExceedsPerSpendLimit: 'supera tu máximo por pago',
          ExceedsTotalLimit: 'supera lo que queda de tu permiso',
          PermitInactive: 'el permiso venció o fue revocado',
        };
        const code = String(r.rechazoDelContrato);
        const amounts = typeof r.monto === 'number' && typeof r.limite === 'number' ? ` (${r.monto} tUSD; límite ${r.limite} tUSD)` : '';
        return { tone: code === 'NeedsApproval' ? 'warn' : 'bad', tag: code, text: `El contrato lo rechazó: ${why[code] ?? code}${amounts}.` };
      }
      return step.name === 'pagar_servicio'
        ? { tone: 'ok', tag: 'Pagado', text: `Pagó ${String(r.pagado)} tUSD.` }
        : { tone: 'warn', tag: 'En espera', text: `Pedido #${String(r.pedido)} pendiente: apruébalo con tu huella.` };
    case 'reseniar_servicio':
      return { tone: 'ok', tag: 'Reseña', text: `Puntaje ${String(r.puntaje)}/100.` };
    default:
      return { tone: 'ok', text: 'Listo.' };
  }
}

const STEP_LOOK = {
  ok: { box: 'bg-surface ring-1 ring-line/60', dot: 'bg-ok-soft text-on-ok-soft', icon: 'check', title: 'text-ink', tag: 'ok' },
  warn: { box: 'bg-warn-soft/50 ring-1 ring-warn/30', dot: 'bg-warn-soft text-on-warn-soft', icon: 'fingerprint', title: 'text-ink', tag: 'warn' },
  bad: { box: 'bg-bad-soft/60 ring-1 ring-bad/30', dot: 'bg-bad-soft text-on-bad-soft', icon: 'gpp_bad', title: 'text-on-bad-soft', tag: 'bad' },
} as const;

/** Recorta en el último espacio, para no cortar una palabra a medias. */
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, text.lastIndexOf(' ', max) > 0 ? text.lastIndexOf(' ', max) : max)}…`);

function Trace({ result }: { result: TaskResult }) {
  return (
    <ol className="relative flex flex-col gap-2.5 before:absolute before:top-4 before:bottom-4 before:left-[27px] before:w-px before:bg-line">
      {result.steps.map((step, i) => {
        if (step.kind === 'thought') {
          return (
            <li key={i} className="rise relative flex items-start gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-line/60">
              <span className="relative z-10 grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-on-primary-soft">
                <Icon name="psychology" size={16} />
              </span>
              <div className="min-w-0">
                <p className="font-semibold">
                  Razonamiento de Qwen <span className="text-[12px] font-normal text-muted">(texto original del modelo, en inglés)</span>
                </p>
                <p className="text-sm text-ink-2 italic">{clip(step.text, 280)}</p>
              </div>
            </li>
          );
        }
        if (step.kind !== 'tool') return null;
        const s = summary(step);
        const look = STEP_LOOK[s.tone];
        return (
          <li key={i} className={`rise relative flex items-start gap-3 rounded-2xl p-3.5 ${look.box}`}>
            <span className={`relative z-10 grid size-7 shrink-0 place-items-center rounded-full ${look.dot}`}>
              <Icon name={s.icon ?? look.icon} size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`flex flex-wrap items-center gap-2 font-semibold ${look.title}`}>
                {LABELS[step.name] ?? step.name}
                {s.tag ? (
                  <Badge tone={look.tag} className="font-mono !text-[11px]">
                    {s.tag}
                  </Badge>
                ) : null}
              </p>
              <p className="text-sm break-words text-ink-2">{s.text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Una tarea en lenguaje natural para el agente: Qwen planifica y usa herramientas reales sobre Monad. */
export function AgentTaskView({ app, memory, result, setResult }: { app: App; memory: Memory; result: TaskResult | null; setResult: (r: TaskResult | null) => void }) {
  const [task, setTask] = useState(DEFAULT_TASK);
  const [shareMemory, setShareMemory] = useState(true);
  const permit = app.currentPermit;
  const locked = app.phase === 'locked';
  const memoryKey = memory.agentKey();
  const thinking = app.busy === 'agent-task';
  const pending = app.pending[0];

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
        const ms = performance.now() - t0;
        setResult({ ...done, ms });
        app.bridge.addLog({ kind: 'info', title: `Qwen resolvió la tarea en ${done.steps.length} paso(s)`, ms });
        await app.bridge.refresh();
      } catch (e) {
        if (e instanceof AvalError && e.code === 'AgentBrainDisabled') {
          throw new Error('El agente con Qwen todavía no está activo en el relayer.');
        }
        throw e;
      }
    });

  return (
    <>
      <PageHead
        eyebrow="Supervisión de un agente autónomo"
        title="Pídele algo a tu agente"
        subtitle="Un agente con Qwen planifica y usa herramientas reales: revisa su permiso, la reputación y tu memoria, paga o te pide aprobación. El contrato tiene la última palabra."
        action={
          <Badge tone="accent" dot className="!py-1 !text-[13px]">
            Qwen 3.8 Max
          </Badge>
        }
      />

      {!permit ? (
        <Card>
          <Empty icon="shield">Primero dale un permiso a tu agente: sin permiso, no puede pagar nada.</Empty>
          <div className="mt-4 flex justify-center">
            <LinkButton href={href('permiso')} variant="primary" icon="add">
              Crear permiso
            </LinkButton>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <label className="mb-2 flex items-baseline justify-between gap-2" htmlFor="task">
              <span className="text-[13px] font-semibold tracking-wide uppercase">
                La tarea <span className="font-normal text-muted normal-case">(en lenguaje natural)</span>
              </span>
            </label>
            <div className="overflow-hidden rounded-2xl bg-surface-low ring-1 ring-line focus-within:ring-2 focus-within:ring-primary">
              <textarea
                id="task"
                className="block min-h-28 w-full resize-y bg-transparent px-4 py-3 text-[16px] leading-relaxed focus:outline-none"
                value={task}
                maxLength={500}
                onChange={(e) => setTask(e.target.value)}
              />
              <p className="flex items-center justify-between gap-2 border-t border-line/60 px-4 py-2 text-[12px] text-muted">
                <span>Solo puede pagarle al Servicio de traducción, y siempre dentro de tu permiso.</span>
                <span className="font-mono">{task.length}/500</span>
              </p>
            </div>

            <label className={`mt-4 flex items-start gap-3 rounded-2xl p-4 ring-1 ring-line/60 ${memoryKey ? 'bg-primary-soft/40' : 'bg-surface-low'}`}>
              <input type="checkbox" className="mt-1 size-4 accent-[var(--c-primary-strong)]" checked={shareMemory && !!memoryKey} disabled={!memoryKey} onChange={(e) => setShareMemory(e.target.checked)} />
              <span className="flex-1">
                <span className="block font-medium">Que pueda leer la memoria que le compartiste</span>
                <span className="block text-[13px] text-ink-2">
                  {memoryKey ? (
                    'Se le pasa la clave de su parte (cifrada con tu passkey) solo para esta tarea.'
                  ) : (
                    <>
                      Todavía no le compartiste nada.{' '}
                      <a className="font-semibold text-primary hover:underline" href={href('memoria')}>
                        Comparte tus preferencias
                      </a>{' '}
                      para que las tenga en cuenta.
                    </>
                  )}
                </span>
              </span>
              <Icon name={memoryKey ? 'lock_open' : 'lock'} size={20} className="text-muted" />
            </label>

            <div className="mt-4 flex justify-end">
              <Button variant="primary" size="lg" icon="send" loading={thinking} disabled={locked || !!app.busy || task.trim().length < 3} onClick={run} className="w-full sm:w-auto">
                Pedírselo a Qwen
              </Button>
            </div>

            {thinking ? (
              <div className="mt-6 flex flex-col gap-2.5" aria-live="polite">
                <p className="flex items-center gap-2 text-sm font-medium text-primary">
                  <span className="spinner !size-4" /> Qwen está pensando y usando sus herramientas…
                </p>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-low" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            ) : null}

            {result ? (
              <ScrollIntoView key={result.ms} className="mt-6">
                <div className="mb-3 flex items-center justify-between gap-2 border-b border-line/60 pb-2">
                  <p className="flex items-center gap-2 text-[13px] font-semibold tracking-wide uppercase">
                    <span className="size-2 rounded-full bg-primary-strong" aria-hidden="true" />
                    Traza de ejecución
                  </p>
                  <span className="rounded-full bg-surface-low px-2.5 py-0.5 font-mono text-[12px] text-ink-2">
                    {result.steps.filter((s) => s.kind !== 'answer').length} pasos · {(result.ms / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} s
                  </span>
                </div>
                <Trace result={result} />
                <div className="rise mt-4 flex items-start gap-3 rounded-2xl bg-primary-soft p-4 text-on-primary-soft ring-1 ring-primary/20">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-strong text-white">
                    <Icon name="smart_toy" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">Tu agente</p>
                    <p className="text-[16px] leading-relaxed">“{result.answer}”</p>
                  </div>
                </div>
              </ScrollIntoView>
            ) : null}

            {pending ? (
              <div className="rise mt-4 flex flex-col gap-3 rounded-2xl bg-surface-low p-4 sm:flex-row sm:items-center">
                <p className="flex flex-1 items-center gap-2 text-sm font-medium">
                  <span className="size-2.5 rounded-full bg-[#f5a524]" aria-hidden="true" />
                  {app.pending.length === 1 ? '1 pago espera tu huella' : `${app.pending.length} pagos esperan tu huella`}
                </p>
                <Button
                  variant="primary"
                  icon="fingerprint"
                  loading={app.busy === `approve-${pending.requestId}`}
                  disabled={locked || !!app.busy}
                  onClick={() => app.approve(pending.requestId)}
                >
                  Aprobar con huella ({usd(pending.request.amount)} tUSD)
                </Button>
              </div>
            ) : null}
          </Card>

          <aside className="flex flex-col gap-4">
            <Card icon="build" title="Sus herramientas">
              <ul className="flex flex-col gap-2 text-sm">
                {TOOLS.map(([icon, label]) => (
                  <li key={label} className="flex items-center gap-2 rounded-xl bg-surface-low px-3 py-2 text-ink-2">
                    <Icon name={icon} size={18} className="text-primary" />
                    {label}
                  </li>
                ))}
              </ul>
            </Card>
            <div className="rounded-2xl bg-term p-5 text-sm text-on-term">
              <p className="mb-2 flex items-center gap-2 font-semibold">
                <Icon name="gavel" size={20} className="text-term-accent" />
                El contrato tiene la última palabra
              </p>
              <p className="text-term-muted">
                Aunque el modelo decida pagar, AgentPermit revisa tus límites en Monad. Si el pago supera tu umbral, lo rechaza y el agente tiene que pedirte
                aprobación.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
