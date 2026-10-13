import { type ReactNode, useEffect, useState } from 'react';
import { type Route, href } from '../lib/router';
import type { App } from '../state/useAval';
import { Button, Icon } from './ui';

type NavItem = { route: Route; icon: string; label: string; short: string };

const NAV: NavItem[] = [
  { route: 'panel', icon: 'space_dashboard', label: 'Panel', short: 'Panel' },
  { route: 'permiso', icon: 'tune', label: 'Permiso y agente', short: 'Permiso' },
  { route: 'agente', icon: 'smart_toy', label: 'Pídele a tu agente', short: 'Agente' },
  { route: 'aprobaciones', icon: 'fingerprint', label: 'Aprobaciones', short: 'Aprobar' },
  { route: 'recibos', icon: 'receipt_long', label: 'Recibos y reputación', short: 'Recibos' },
  { route: 'memoria', icon: 'encrypted', label: 'Memoria del agente', short: 'Memoria' },
];

/** Cuenta atrás de la sesión. Tiene su propio reloj para que no se redibuje toda la app cada segundo. */
function SessionChip({ app }: { app: App }) {
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
  const warn = left <= 60;
  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium transition ${warn ? 'bg-warn-soft text-on-warn-soft' : 'bg-surface-low text-ink-2 hover:bg-surface-mid'}`}
      onClick={() => app.lock('Sesión bloqueada.')}
      title="Bloquear la sesión ahora"
    >
      <span className={`size-2 rounded-full ${warn ? 'bg-warn' : 'bg-ok-dot'}`} aria-hidden="true" />
      <span className="hidden md:inline">Sesión abierta · se bloquea en {text}</span>
      <span className="md:hidden">{text}</span>
      <Icon name="lock" size={16} />
    </button>
  );
}

export function Header({ app, route, signedIn }: { app: App; route: Route; signedIn: boolean }) {
  const inspector = route === 'inspector';
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-4 md:px-6">
        <a className="flex items-center gap-2.5 rounded-lg" href={signedIn ? href('panel') : '#/'} aria-label="Aval, inicio">
          <span className="grid size-9 place-items-center rounded-xl bg-primary-strong text-white shadow-sm">
            <Icon name="shield_person" size={20} />
          </span>
          <span className="text-xl font-semibold tracking-tight">Aval</span>
        </a>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full bg-surface-low px-3 py-1.5 font-mono text-[12px] text-ink-2 sm:inline-flex">
            <span className="size-2 animate-pulse rounded-full bg-ok-dot" aria-hidden="true" />
            Monad Testnet
          </span>
          <SessionChip app={app} />
          <a
            href={inspector ? (signedIn ? href('panel') : '#/') : href('inspector')}
            aria-current={inspector ? 'page' : undefined}
            className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition ${
              inspector ? 'bg-primary-strong text-white' : 'text-ink-2 hover:bg-surface-low hover:text-ink'
            }`}
          >
            <Icon name="terminal" size={18} />
            <span className="hidden sm:inline">Inspector</span>
          </a>
        </div>
      </div>
    </header>
  );
}

export function TestnetNote() {
  return (
    <p className="mb-5 flex items-center gap-2 rounded-full bg-surface-low px-4 py-1.5 font-mono text-[12px] text-ink-2 sm:w-fit">
      <span className="size-2 shrink-0 rounded-full bg-ok-dot" aria-hidden="true" />
      <span>
        <strong className="font-medium text-ink">tUSD</strong> · Dólares de prueba en Monad testnet. No tienen valor real.
      </span>
    </p>
  );
}

function Count({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="grid min-w-5 place-items-center rounded-full bg-warn px-1 text-[11px] leading-5 font-bold text-white" aria-label={`${n} pendiente${n > 1 ? 's' : ''}`}>
      {n}
    </span>
  );
}

/** Menú lateral en pantallas anchas. */
export function Sidebar({ route, pending }: { route: Route; pending: number }) {
  return (
    <nav aria-label="Secciones" className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col justify-between border-r border-line/60 px-3 py-6 lg:flex">
      <div>
        <p className="mb-3 px-3 text-[12px] font-medium tracking-wider text-muted uppercase">Custodia y control</p>
        <ul className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = item.route === route;
            return (
              <li key={item.route}>
                <a
                  href={href(item.route)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition ${
                    active ? 'bg-primary-soft font-semibold text-on-primary-soft' : 'text-ink-2 hover:bg-surface-low hover:text-ink'
                  }`}
                >
                  <Icon name={item.icon} fill={active} />
                  <span className="flex-1">{item.label}</span>
                  {item.route === 'aprobaciones' ? <Count n={pending} /> : null}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="border-t border-line/60 px-3 pt-4 text-[12px] text-muted">
        <p className="flex items-center justify-between font-mono">
          <span>Monad testnet</span>
          <span className="text-ok">tUSD</span>
        </p>
        <p className="mt-1">Dólares de prueba. No tienen valor real.</p>
      </div>
    </nav>
  );
}

/** Barra inferior en el móvil. */
export function BottomNav({ route, pending }: { route: Route; pending: number }) {
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/60 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-6">
        {NAV.map((item) => {
          const active = item.route === route;
          return (
            <li key={item.route}>
              <a
                href={href(item.route)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center gap-0.5 px-1 pt-2 pb-2 text-[11px] font-medium ${active ? 'text-primary' : 'text-muted'}`}
              >
                <span className={`grid h-7 w-12 place-items-center rounded-full transition ${active ? 'bg-primary-soft' : ''}`}>
                  <Icon name={item.icon} size={22} fill={active} />
                </span>
                <span>{item.short}</span>
                {item.route === 'aprobaciones' && pending > 0 ? (
                  <span className="absolute top-1 right-[calc(50%-1.4rem)]">
                    <Count n={pending} />
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Locked({ app }: { app: App }) {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl bg-warn-soft p-4 text-on-warn-soft sm:flex-row sm:items-center" role="alert">
      <div className="flex flex-1 items-start gap-3">
        <Icon name="lock" size={22} fill />
        <div>
          <p className="font-semibold">Sesión bloqueada</p>
          <p className="text-sm opacity-90">Por seguridad, la clave salió de la memoria. Usa tu huella para continuar; tus datos siguen ahí.</p>
        </div>
      </div>
      <Button variant="primary" icon="lock_open" loading={app.busy === 'enter'} disabled={!!app.busy} onClick={() => app.enter(app.mode)}>
        Desbloquear
      </Button>
    </div>
  );
}

export function Toast({ app }: { app: App }) {
  const n = app.notice;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6" aria-live="polite">
      {n ? (
        <div
          key={n.id}
          className={`rise pointer-events-auto flex max-w-lg items-start gap-3 rounded-2xl px-4 py-3 text-sm shadow-xl ${
            n.kind === 'error' ? 'bg-on-bad-soft text-bad-soft' : 'bg-term text-on-term'
          }`}
          role={n.kind === 'error' ? 'alert' : 'status'}
        >
          <Icon name={n.kind === 'ok' ? 'check_circle' : n.kind === 'error' ? 'error' : 'info'} size={20} className={n.kind === 'ok' ? 'text-term-accent' : ''} />
          <span className="flex-1">{n.text}</span>
          <button type="button" className="-m-1 rounded-lg p-1 opacity-80 hover:opacity-100" aria-label="Cerrar aviso" onClick={app.dismissNotice}>
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Footer({ children }: { children?: ReactNode }) {
  return (
    <footer className="border-t border-line/60 px-4 py-6 text-[13px] text-muted md:px-6">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <Icon name="shield" size={16} />
          Aval · confianza para agentes de IA en Monad testnet. Todo el dinero es de prueba.
        </p>
        <p className="flex items-center gap-3">
          {children}
          <a className="underline-offset-2 hover:text-ink hover:underline" href="https://github.com/Alan021011/Aval" target="_blank" rel="noreferrer">
            Código en GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
