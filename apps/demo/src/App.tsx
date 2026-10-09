import { useEffect, useState } from 'react';
import { Activity, AgentPanel, Approvals, PermitCard, Reputation, Summary } from './components/Dashboard';
import { Inspector } from './components/Inspector';
import { Landing, Preparing } from './components/Onboarding';
import { Button, Icon } from './components/ui';
import { type App as AppState, useAval } from './state/useAval';

/** Cuenta atrás de la sesión. Tiene su propio reloj para que no se redibuje toda la app cada segundo. */
function SessionChip({ app }: { app: AppState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Al llegar a cero, se bloquea sola. La clave sale de la memoria.
  useEffect(() => {
    if (app.phase === 'in' && app.lockAt !== null && now >= app.lockAt) app.lock('Sesión bloqueada por inactividad.');
  }, [now, app]);

  if (app.phase !== 'in' || app.lockAt === null) return null;
  const left = Math.max(0, Math.ceil((app.lockAt - now) / 1000));
  const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <button type="button" className={`chip${left <= 60 ? ' chip-warn' : ''}`} onClick={() => app.lock('Sesión bloqueada.')} title="Bloquear la sesión ahora">
      <span className="dot" aria-hidden="true" />
      <span className="chip-long">Sesión abierta · se bloquea en {text}</span>
      <span className="chip-short">Sesión · {text}</span>
      <Icon name="lock" size={14} />
    </button>
  );
}

function Header({ app, inspector, onInspector }: { app: AppState; inspector: boolean; onInspector: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="/" aria-label="Aval, inicio">
          <Icon name="shield" size={22} />
          <span>Aval</span>
        </a>
        <div className="topbar-actions">
          <SessionChip app={app} />
          <Button variant={inspector ? 'primary' : 'ghost'} icon="eye" aria-pressed={inspector} onClick={onInspector}>
            Inspector
          </Button>
        </div>
      </div>
    </header>
  );
}

function Locked({ app }: { app: AppState }) {
  return (
    <div className="callout callout-warn locked" role="alert">
      <Icon name="lock" />
      <div>
        <strong>Sesión bloqueada</strong>
        <p>Por seguridad, la clave salió de la memoria. Usa tu huella para continuar; tus datos siguen ahí.</p>
      </div>
      <Button variant="primary" icon="unlock" loading={app.busy === 'enter'} disabled={!!app.busy} onClick={() => app.enter(app.mode)}>
        Desbloquear
      </Button>
    </div>
  );
}

function Dashboard({ app, inspector }: { app: AppState; inspector: boolean }) {
  return (
    <div className="dashboard">
      {app.phase === 'locked' ? <Locked app={app} /> : null}

      {app.pending.length > 0 && app.phase === 'in' ? (
        <a className="callout callout-accent attention" href="#approvals">
          <Icon name="fingerprint" />
          <div>
            <strong>Tu agente espera tu aprobación</strong>
            <p>
              {app.pending.length === 1 ? 'Hay un pago grande' : `Hay ${app.pending.length} pagos grandes`} que solo se hará con tu huella.
            </p>
          </div>
        </a>
      ) : null}

      <Summary app={app} />

      <div className="columns">
        <div className="col">
          <PermitCard app={app} />
          <AgentPanel app={app} />
        </div>
        <div className="col">
          <Approvals app={app} />
          <Activity app={app} />
          <Reputation app={app} />
        </div>
      </div>

      {inspector ? <Inspector app={app} /> : null}
    </div>
  );
}

export default function App() {
  const app = useAval();
  const [inspector, setInspector] = useState(false);

  const showDashboard = (app.phase === 'in' || app.phase === 'locked') && app.snapshot;

  return (
    <>
      <Header app={app} inspector={inspector} onInspector={() => setInspector((v) => !v)} />
      <main id="contenido">
        {showDashboard ? <Dashboard app={app} inspector={inspector} /> : app.phase === 'working' ? <Preparing app={app} /> : <Landing app={app} />}
        {!showDashboard && inspector ? <Inspector app={app} /> : null}
      </main>

      <div className="toast-zone" aria-live="polite">
        {app.notice ? (
          <div className={`toast toast-${app.notice.kind}`} role={app.notice.kind === 'error' ? 'alert' : 'status'} key={app.notice.id}>
            <Icon name={app.notice.kind === 'ok' ? 'check' : app.notice.kind === 'error' ? 'alert' : 'info'} />
            <span>{app.notice.text}</span>
            <button type="button" className="toast-close" aria-label="Cerrar aviso" onClick={app.dismissNotice}>
              <Icon name="x" size={16} />
            </button>
          </div>
        ) : null}
      </div>

      <footer className="footer">
        <p>
          Aval · confianza para agentes de IA en Monad testnet. Todo el dinero es de prueba.{' '}
          <a href="https://github.com/Alan021011/Aval" target="_blank" rel="noreferrer">
            Código en GitHub
          </a>
        </p>
      </footer>
    </>
  );
}
