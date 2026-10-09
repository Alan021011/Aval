import type { App } from '../state/useAval';
import { Button, Card, Icon, Spinner } from './ui';

const HOW = [
  { icon: 'shield', title: 'Le das un permiso', text: 'Tú fijas cuánto puede pagar tu agente, a quién y por cuánto tiempo.' },
  { icon: 'bot', title: 'Tu agente trabaja', text: 'Paga solo dentro de esos límites. Si se pasa, el contrato lo bloquea.' },
  { icon: 'fingerprint', title: 'Lo grande, con tu huella', text: 'Los pagos grandes esperan tu aprobación, verificada en la cadena.' },
] as const;

export function Landing({ app }: { app: App }) {
  const loading = app.busy === 'start';
  const entering = app.busy === 'enter';

  return (
    <div className="landing">
      <section className="hero">
        <p className="eyebrow">Confianza para agentes de IA</p>
        <h1>Dale a tu agente un permiso, no tus llaves.</h1>
        <p className="lead">
          Aval deja que un agente de IA pague por ti dentro de los límites que tú fijas. Lo grande lo apruebas con tu
          huella. Sin contraseñas, sin frases secretas y sin tener cripto.
        </p>
        <div className="hero-actions">
          <Button variant="primary" icon="fingerprint" loading={loading} disabled={!!app.busy} onClick={() => app.start('real')}>
            Empezar con mi huella
          </Button>
          <Button variant="secondary" loading={entering} disabled={!!app.busy} onClick={() => app.enter('real')}>
            Ya tengo cuenta: entrar
          </Button>
        </div>
        <p className="fine">Se crea una passkey en este dispositivo. Todo lo demás pasa solo. Dinero de prueba en Monad testnet.</p>

        {app.needsFallback ? (
          <div className="callout callout-warn" role="alert">
            <Icon name="alert" />
            <div>
              <strong>Tu navegador no soporta este tipo de passkey.</strong>
              <p>Puedes recorrer la demo con el modo de prueba, que usa una clave guardada en este navegador.</p>
            </div>
          </div>
        ) : null}

        <details className="fallback">
          <summary>¿Tu dispositivo no soporta passkeys? Modo de prueba</summary>
          <p>
            El modo de prueba usa una clave de software guardada en este navegador. Sirve para ver cómo funciona todo, pero
            <strong> no es una passkey real</strong> y no demuestra la recuperación en otro dispositivo.
          </p>
          <div className="row">
            <Button variant="secondary" disabled={!!app.busy} onClick={() => app.start('simulated')}>
              Crear cuenta de prueba
            </Button>
            <Button variant="ghost" disabled={!!app.busy} onClick={() => app.enter('simulated')}>
              Entrar con mi cuenta de prueba
            </Button>
          </div>
        </details>
      </section>

      <section aria-labelledby="how-title" className="how">
        <h2 id="how-title" className="section-title">
          Cómo funciona
        </h2>
        <ol className="how-grid">
          {HOW.map((step, i) => (
            <li key={step.title} className="how-card">
              <span className="how-num" aria-hidden="true">
                {i + 1}
              </span>
              <Icon name={step.icon} size={22} />
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function Preparing({ app }: { app: App }) {
  const failed = app.steps.some((s) => s.state === 'error');
  return (
    <div className="working">
      <Card title={failed ? 'No pudimos terminar' : 'Preparando tu cuenta'} subtitle="Tu huella se pide una sola vez. Lo demás lo hacemos por ti.">
        <ol className="steps" aria-live="polite">
          {app.steps.map((step) => (
            <li key={step.id} className={`step step-${step.state}`}>
              <span className="step-icon" aria-hidden="true">
                {step.state === 'doing' ? <Spinner /> : step.state === 'done' ? <Icon name="check" size={16} /> : step.state === 'error' ? <Icon name="x" size={16} /> : step.state === 'skipped' ? <Icon name="info" size={16} /> : null}
              </span>
              <span>{step.label}</span>
              <span className="visually-hidden">
                {step.state === 'done' ? ' (listo)' : step.state === 'doing' ? ' (en curso)' : step.state === 'error' ? ' (falló)' : step.state === 'skipped' ? ' (omitido)' : ''}
              </span>
            </li>
          ))}
        </ol>
        {failed ? (
          <div className="row">
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
