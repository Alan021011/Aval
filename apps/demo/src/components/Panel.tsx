import { seconds, shortHash, usd } from '../lib/format';
import { type Route, href } from '../lib/router';
import type { App } from '../state/useAval';
import type { Memory } from '../state/useMemory';
import { ApprovalsMini } from './Approvals';
import { PermitSummary } from './Permit';
import { RecentActivity, ReputationCard } from './Receipts';
import { Button, Card, Icon, LinkButton } from './ui';

function Balance({ app }: { app: App }) {
  const snapshot = app.snapshot!;
  return (
    <section className="card relative overflow-hidden" aria-labelledby="balance-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id="balance-title" className="text-[12px] font-medium tracking-wider text-ink-2 uppercase">
            Tu saldo
          </p>
          <p className="mt-1 text-5xl leading-tight font-bold tracking-tight">
            {usd(snapshot.balance)} <span className="text-2xl font-semibold text-primary">tUSD</span>
          </p>
          <p className="text-[13px] text-muted">Dólares de prueba. No tienen valor real. Se quedan en tu cuenta: el agente solo tiene un permiso.</p>
        </div>
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-surface-mid text-primary">
          <Icon name="account_balance_wallet" size={26} />
        </span>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line/60 pt-4">
        <Button icon="water_drop" loading={app.busy === 'faucet'} disabled={app.phase === 'locked' || !!app.busy} onClick={() => app.topUp()}>
          Pedir más saldo de prueba
        </Button>
        {app.address ? <span className="font-mono text-[12px] text-muted">Cuenta {shortHash(app.address, 4)}</span> : null}
      </div>
    </section>
  );
}

function Ready({ app }: { app: App }) {
  const { readyMs, readyPrompts, firstTxMs } = app.metrics;
  if (readyMs === null) return null;
  const prompts = readyPrompts ?? 1;
  const facts = [
    { value: `${prompts} ${prompts === 1 ? 'huella' : 'huellas'}`, note: 'WebAuthn + PRF' },
    { value: '0 MON', note: 'El gas lo paga el relayer' },
    { value: firstTxMs === null ? '—' : `${seconds(firstTxMs)} s`, note: 'Hasta la 1.ª transacción' },
  ];
  return (
    <section className="rise flex flex-col justify-between gap-5 rounded-2xl bg-ok-soft p-5 text-on-ok-soft md:p-6" role="status">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-on-ok-soft text-ok-soft">
          <Icon name="verified_user" size={26} />
        </span>
        <p className="text-xl leading-snug font-semibold md:text-2xl">
          Listo en {seconds(readyMs)} s, con {prompts === 1 ? '1 toque' : `${prompts} toques`} de tu huella. Sin cripto, sin extensiones ni frases secretas.
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-3 border-t border-on-ok-soft/15 pt-4">
        {facts.map((f) => (
          <div key={f.note}>
            <dt className="sr-only">{f.note}</dt>
            <dd className="text-lg font-semibold">{f.value}</dd>
            <dd className="text-[12px] opacity-80">{f.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** El recorrido de la demo, con lo que ya está hecho marcado. */
function Journey({ app, memory }: { app: App; memory: Memory }) {
  const snapshot = app.snapshot!;
  const steps: { route: Route; icon: string; title: string; text: string; done: boolean }[] = [
    { route: 'permiso', icon: 'tune', title: 'Dale un permiso', text: 'Límites por pago, total y umbral.', done: !!app.currentPermit },
    { route: 'permiso', icon: 'smart_toy', title: 'Tu agente en acción', text: 'Paga, lo bloquean y pide permiso.', done: snapshot.receipts.length > 0 },
    { route: 'aprobaciones', icon: 'fingerprint', title: 'Aprueba con tu huella', text: 'Verificado en la cadena.', done: snapshot.receipts.some((r) => r.requestId > 0n) },
    { route: 'agente', icon: 'psychology', title: 'Pídeselo a Qwen', text: 'Un agente que planifica solo.', done: app.log.some((l) => l.title.startsWith('Qwen resolvió')) },
    { route: 'memoria', icon: 'encrypted', title: 'Memoria cifrada', text: 'Comparte y revoca el acceso.', done: memory.sharedVersion > 0 },
  ];
  const next = steps.find((s) => !s.done);
  return (
    <Card icon="route" title="Recorre la demo" subtitle={next ? `Siguiente: ${next.title.toLowerCase()}.` : 'Recorriste todo. Abre el inspector para ver qué pasó por debajo.'}>
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((s, i) => {
          const isNext = s === next;
          return (
            <li key={s.title}>
              <a
                href={href(s.route)}
                className={`flex h-full items-start gap-3 rounded-2xl p-3 transition xl:flex-col ${
                  s.done ? 'bg-ok-soft/70 text-on-ok-soft' : isNext ? 'bg-primary-soft text-on-primary-soft ring-2 ring-primary/30' : 'bg-surface-low text-ink-2 hover:bg-surface-mid'
                }`}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface/80">
                  <Icon name={s.done ? 'check' : s.icon} size={20} />
                </span>
                <span>
                  <span className="block text-[12px] font-mono opacity-75">PASO {i + 1}</span>
                  <span className="block font-semibold">{s.title}</span>
                  <span className="block text-[13px] opacity-80">{s.text}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function MemoryMini({ memory }: { memory: Memory }) {
  return (
    <Card icon="encrypted" title="Memoria de tu agente" action={memory.sharedVersion > 0 ? <span className="text-[13px] font-medium text-ok">Compartida · v{memory.sharedVersion}</span> : undefined}>
      <p className="mb-4 text-sm text-ink-2">Cifrada con tu passkey. En la cadena solo quedan bytes cifrados.</p>
      <LinkButton href={href('memoria')} icon={memory.open ? 'folder_open' : 'lock_open'} className="w-full">
        {memory.open ? 'Gestionar la memoria' : 'Abrir mi memoria'}
      </LinkButton>
    </Card>
  );
}

export function PanelView({ app, memory }: { app: App; memory: Memory }) {
  return (
    <div className="flex flex-col gap-5">
      {app.pending.length > 0 && app.phase === 'in' ? (
        <div className="rise flex flex-col gap-3 rounded-2xl bg-warn-soft p-4 text-on-warn-soft sm:flex-row sm:items-center">
          <div className="flex flex-1 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface/60">
              <Icon name="notifications_active" size={22} />
            </span>
            <div>
              <p className="font-semibold">Tu agente espera tu aprobación</p>
              <p className="text-sm opacity-90">
                {app.pending.length === 1 ? `Un pago de ${usd(app.pending[0]!.request.amount)} tUSD` : `${app.pending.length} pagos grandes`} solo se hará con tu huella.
              </p>
            </div>
          </div>
          <a href={href('aprobaciones')} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-term px-4 text-sm font-semibold text-on-term hover:brightness-125">
            Ver y aprobar
            <Icon name="arrow_forward" size={18} />
          </a>
        </div>
      ) : null}

      <div className={`grid grid-cols-1 gap-5 ${app.metrics.readyMs !== null ? 'lg:grid-cols-2' : ''}`}>
        <Balance app={app} />
        <Ready app={app} />
      </div>

      <Journey app={app} memory={memory} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          {app.currentPermit ? (
            <PermitSummary app={app} compact />
          ) : (
            <Card icon="shield" title="Tu agente todavía no tiene permiso" subtitle="Sin permiso no puede pagar nada. Tú pones los límites; el contrato los hace cumplir.">
              <LinkButton href={href('permiso')} variant="primary" icon="add">
                Crear permiso
              </LinkButton>
            </Card>
          )}
          <RecentActivity app={app} />
        </div>
        <div className="flex flex-col gap-5">
          <ApprovalsMini app={app} />
          <ReputationCard app={app} compact />
          <MemoryMini memory={memory} />
        </div>
      </div>
    </div>
  );
}
