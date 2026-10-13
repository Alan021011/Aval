import { usd } from '../lib/format';
import { USD } from '../lib/config';
import { href } from '../lib/router';
import type { App } from '../state/useAval';
import { Button, Card, Icon, Spinner, ZoneBar } from './ui';

const HOW = [
  { icon: 'tune', tint: 'bg-primary-soft text-on-primary-soft', title: 'Le das un permiso', text: 'Tú fijas cuánto puede pagar tu agente, a quién y por cuánto tiempo. Los fondos se quedan en tu cuenta.', tag: 'AgentPermit' },
  { icon: 'smart_toy', tint: 'bg-ok-soft text-on-ok-soft', title: 'Tu agente trabaja (con Qwen)', text: 'Revisa su permiso, la reputación verificada y tu memoria, y paga solo dentro de tus límites. Si se pasa, el contrato lo bloquea.', tag: 'Qwen 3.8 Max' },
  { icon: 'fingerprint', tint: 'bg-warn-soft text-on-warn-soft', title: 'Lo grande, con tu huella', text: 'Los pagos sobre tu umbral esperan tu aprobación. La firma WebAuthn se verifica en la cadena con el precompile P256 de Monad.', tag: 'P256 · 0x0100' },
  { icon: 'encrypted', tint: 'bg-surface-high text-primary', title: 'Tu memoria, cifrada', text: 'Tus preferencias se cifran con tu passkey. Compartes una parte con el agente y le quitas el acceso con un toque.', tag: 'WebAuthn PRF' },
] as const;

const FACTS = [
  { label: 'Para empezar', value: '1 huella', note: 'Sin frase secreta' },
  { label: 'Gas para ti', value: '0 MON', note: 'Lo paga el relayer' },
  { label: 'Tus llaves', value: 'Tuyas', note: 'Sin custodia' },
] as const;

/** Ejemplo de permiso (con los mismos valores por defecto que el formulario) para explicar las tres zonas. */
function PermitSpecimen() {
  return (
    <div className="card relative !p-5 md:!p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-xl bg-surface-mid text-primary">
            <Icon name="smart_toy" size={28} />
          </span>
          <div>
            <p className="font-semibold">Permiso de tu agente</p>
            <p className="text-[13px] text-muted">Ejemplo · solo puede pagar al Servicio de traducción</p>
          </div>
        </div>
        <span className="hidden rounded-full bg-ok-soft px-2.5 py-0.5 text-[12px] font-medium text-on-ok-soft sm:inline">Activo</span>
      </div>
      <div className="mb-4 flex items-end justify-between rounded-2xl bg-surface-low p-4">
        <div>
          <p className="text-[13px] text-ink-2">Puede gastar en total</p>
          <p className="text-2xl font-bold">
            {usd(300n * USD)} <span className="text-sm font-semibold text-primary">tUSD</span>
          </p>
        </div>
        <p className="text-right font-mono text-[12px] text-muted">
          vence en
          <br />
          <span className="text-ink">24 h</span>
        </p>
      </div>
      <p className="mb-2 text-sm font-medium">Qué pasa con cada pago</p>
      <ZoneBar threshold={50n * USD} maxPerSpend={100n * USD} marker={75n * USD} />
      <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
        <Icon name="fingerprint" size={18} className="text-warn" />
        Un pago de 75 tUSD supera el umbral: espera tu huella.
      </p>
    </div>
  );
}

export function Landing({ app }: { app: App }) {
  const loading = app.busy === 'start';
  const entering = app.busy === 'enter';

  return (
    <div className="relative overflow-x-clip">
      <div className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-[340px] w-[720px] -translate-x-1/2 bg-gradient-to-b from-primary-soft/70 to-transparent blur-3xl" aria-hidden="true" />

      <section className="mx-auto max-w-[1080px] px-4 pt-6 pb-12 md:px-8 md:pt-10">
        <p className="mb-6 flex w-fit items-center gap-2 rounded-full bg-surface-low px-4 py-1.5 font-mono text-[12px] text-ink-2">
          <span className="size-2 rounded-full bg-ok-dot" aria-hidden="true" />
          <span>
            <strong className="font-medium text-ink">tUSD</strong> · Dólares de prueba en Monad testnet. No tienen valor real.
          </span>
        </p>

        <div className="grid items-start gap-10 lg:grid-cols-2">
          <div className="flex flex-col items-start gap-5">
            <span className="eyebrow">
              <Icon name="verified_user" size={16} />
              Confianza para agentes de IA
            </span>
            <h1 className="text-[34px] leading-[1.1] font-bold tracking-tight text-balance md:text-5xl md:leading-[1.1]">Dale a tu agente un permiso, no tus llaves.</h1>
            <p className="text-[17px] leading-relaxed text-ink-2">
              Aval deja que un agente de IA pague por ti dentro de los límites que tú fijas. Lo grande lo apruebas con tu huella. Sin contraseñas, sin frases
              secretas y sin tener cripto.
            </p>

            <div className="flex w-full flex-col gap-3 pt-1 sm:flex-row">
              <Button variant="primary" size="lg" icon="fingerprint" loading={loading} disabled={!!app.busy} onClick={() => app.start('real')}>
                Empezar con mi huella
              </Button>
              <Button size="lg" loading={entering} disabled={!!app.busy} onClick={() => app.enter('real')}>
                Ya tengo cuenta: entrar
              </Button>
            </div>
            <p className="flex items-start gap-2 text-[13px] text-muted">
              <Icon name="key" size={16} className="mt-0.5" />
              Se crea una passkey en este dispositivo. Todo lo demás pasa solo. Dinero de prueba en Monad testnet.
            </p>

            {app.needsFallback ? (
              <div className="flex w-full items-start gap-3 rounded-2xl bg-warn-soft p-4 text-on-warn-soft" role="alert">
                <Icon name="warning" size={22} fill />
                <div>
                  <p className="font-semibold">Tu navegador no soporta este tipo de passkey.</p>
                  <p className="text-sm opacity-90">Puedes recorrer la demo con el modo de prueba, que usa una clave guardada en este navegador.</p>
                </div>
              </div>
            ) : null}

            <details className="group w-full rounded-2xl bg-surface-low p-4 open:bg-surface-mid" open={app.needsFallback || undefined}>
              <summary className="flex list-none items-center justify-between gap-2 text-sm font-medium select-none">
                <span className="flex items-center gap-2">
                  <Icon name="contactless" size={18} className="text-primary" />
                  ¿Tu dispositivo no soporta passkeys? Modo de prueba
                </span>
                <Icon name="expand_more" size={20} className="text-muted transition group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">
                El modo de prueba usa una clave de software guardada en este navegador. Sirve para ver cómo funciona todo, pero <strong>no es una passkey real</strong> y
                no demuestra la recuperación en otro dispositivo.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button disabled={!!app.busy} onClick={() => app.start('simulated')}>
                  Crear cuenta de prueba
                </Button>
                <Button variant="ghost" disabled={!!app.busy} onClick={() => app.enter('simulated')}>
                  Entrar con mi cuenta de prueba
                </Button>
              </div>
            </details>

            <dl className="grid w-full grid-cols-3 gap-2 pt-1">
              {FACTS.map((f) => (
                <div key={f.label} className="rounded-xl bg-surface p-3 ring-1 ring-line/60">
                  <dt className="text-[12px] text-muted">{f.label}</dt>
                  <dd className="text-lg font-semibold">{f.value}</dd>
                  <dd className="text-[12px] font-medium text-ok">{f.note}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex flex-col gap-3">
            <PermitSpecimen />
            <a href={href('inspector')} className="flex items-center gap-3 rounded-2xl bg-surface-low p-4 transition hover:bg-surface-mid">
              <span className="grid size-10 place-items-center rounded-xl bg-surface text-primary">
                <Icon name="bolt" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">Contratos verificados en Monad testnet</span>
                <span className="block text-[13px] text-muted">Direcciones, clave P256 y tiempos en el inspector</span>
              </span>
              <Icon name="arrow_outward" size={18} className="text-primary" />
            </a>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-title" className="bg-surface-low/70 py-12">
        <div className="mx-auto max-w-[1080px] px-4 md:px-8">
          <p className="mb-2 font-mono text-[12px] font-medium tracking-wide text-primary uppercase">El protocolo</p>
          <h2 id="how-title" className="text-2xl font-bold tracking-tight">
            Cómo funciona
          </h2>
          <p className="mt-1 max-w-2xl text-ink-2">Del permiso al pago sin intermediarios: tu passkey es la raíz de todo, y el contrato tiene la última palabra.</p>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW.map((step, i) => (
              <li key={step.title} className="card flex flex-col !p-5">
                <span className={`mb-4 grid size-11 place-items-center rounded-xl ${step.tint}`}>
                  <Icon name={step.icon} />
                </span>
                <p className="font-mono text-[12px] font-medium text-primary">PASO {String(i + 1).padStart(2, '0')}</p>
                <h3 className="mt-1 text-lg leading-6 font-semibold">{step.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-2">{step.text}</p>
                <p className="mt-4 rounded-lg bg-surface-low px-3 py-2 font-mono text-[12px] text-ink-2">{step.tag}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-[1080px] px-4 py-12 md:px-8">
        <div className="flex flex-col gap-5 rounded-3xl bg-term p-6 text-on-term md:flex-row md:items-center md:p-8">
          <div className="flex-1">
            <p className="mb-2 flex items-center gap-2 font-mono text-[12px] text-term-accent">
              <Icon name="terminal" size={16} />
              PARA JUECES
            </p>
            <h2 className="text-2xl font-bold">Todo se puede comprobar en la cadena</h2>
            <p className="mt-1 text-term-muted">
              El inspector muestra lo que la vista de usuario oculta: contratos, la clave P256 de tu passkey, hashes de cada transacción y los tiempos medidos.
            </p>
          </div>
          <a href={href('inspector')} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary-strong px-5 font-semibold text-white hover:brightness-110">
            <Icon name="code" size={20} />
            Abrir el inspector
          </a>
        </div>
      </section>
    </div>
  );
}

const STEP_ICON = { done: 'check', error: 'close', skipped: 'info' } as const;

export function Preparing({ app }: { app: App }) {
  const failed = app.steps.some((s) => s.state === 'error');
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <Card title={failed ? 'No pudimos terminar' : 'Preparando tu cuenta'} subtitle="Tu huella se pide una sola vez. Lo demás lo hacemos por ti." icon={failed ? 'error' : 'fingerprint'}>
        <ol className="flex flex-col gap-2" aria-live="polite">
          {app.steps.map((step) => (
            <li
              key={step.id}
              className={`flex items-center gap-3 rounded-xl p-3 text-[15px] ${
                step.state === 'done' ? 'bg-ok-soft text-on-ok-soft' : step.state === 'error' ? 'bg-bad-soft text-on-bad-soft' : step.state === 'doing' ? 'bg-primary-soft text-on-primary-soft' : 'bg-surface-low text-muted'
              }`}
            >
              <span className="grid size-6 place-items-center" aria-hidden="true">
                {step.state === 'doing' ? <Spinner /> : step.state === 'pending' ? <span className="size-2 rounded-full bg-current" /> : <Icon name={STEP_ICON[step.state]} size={20} />}
              </span>
              <span className="font-medium">{step.label}</span>
              <span className="visually-hidden">
                {step.state === 'done' ? ' (listo)' : step.state === 'doing' ? ' (en curso)' : step.state === 'error' ? ' (falló)' : step.state === 'skipped' ? ' (omitido)' : ''}
              </span>
            </li>
          ))}
        </ol>
        {failed ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" loading={app.busy === 'retry'} onClick={() => app.retry()}>
              Reintentar
            </Button>
            <Button variant="ghost" onClick={() => app.forget()}>
              Empezar de nuevo
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
