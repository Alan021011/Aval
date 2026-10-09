import { erc8004MonadTestnet, monadTestnet } from '@aval/sdk';
import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { RELAYER_URL, SESSION_MINUTES, addressUrl, publicClient, txUrl } from '../lib/config';
import { seconds, shortHash } from '../lib/format';
import type { App } from '../state/useAval';
import { Badge, Button, Card, Icon } from './ui';

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="link">
      <code>{children}</code>
      <Icon name="external" size={13} />
    </a>
  );
}

const CONTRACTS = [
  ['PasskeyRegistry', monadTestnet.passkeyRegistry],
  ['AgentPermit', monadTestnet.agentPermit],
  ['ReputationReader', monadTestnet.reputationReader],
  ['TestUSD (tUSD)', monadTestnet.testUsd],
  ['ERC-8004 Identity', erc8004MonadTestnet.identityRegistry],
  ['ERC-8004 Reputation', erc8004MonadTestnet.reputationRegistry],
] as const;

/** Panel para los jueces del track: todo lo que la vista de usuario oculta a propósito. */
export function Inspector({ app }: { app: App }) {
  const snapshot = app.snapshot;
  const [userMon, setUserMon] = useState<bigint | null>(null);

  useEffect(() => {
    if (!app.address) return;
    let cancelled = false;
    void publicClient.getBalance({ address: app.address }).then((v) => !cancelled && setUserMon(v));
    return () => {
      cancelled = true;
    };
  }, [app.address, snapshot?.at]);

  return (
    <Card
      id="inspector"
      className="inspector"
      title="Inspector"
      subtitle="Lo que la vista de usuario oculta: contratos, claves, hashes y tiempos."
      action={<Badge tone="accent">Para jueces</Badge>}
    >
      <div className="inspector-grid">
        <section>
          <h3>Métricas del onboarding</h3>
          <dl className="facts facts-tight">
            <div>
              <dt>Hasta la cuenta lista</dt>
              <dd>{app.metrics.readyMs === null ? '—' : `${seconds(app.metrics.readyMs)} s`}</dd>
            </div>
            <div>
              <dt>Hasta la primera transacción confirmada</dt>
              <dd>{app.metrics.firstTxMs === null ? '—' : `${seconds(app.metrics.firstTxMs)} s`}</dd>
            </div>
            <div>
              <dt>Verificaciones de huella pedidas</dt>
              <dd>{app.prompts}</dd>
            </div>
            <div>
              <dt>MON que pagó el usuario</dt>
              <dd>{userMon === null ? '…' : `${formatEther(userMon)} (nunca tuvo)`}</dd>
            </div>
          </dl>
          <p className="muted small">
            Se cuenta desde el toque en «Empezar», e incluye el tiempo que el usuario tarda en la ventana de su huella.
          </p>
        </section>

        <section>
          <h3>Cuenta</h3>
          <dl className="facts facts-tight">
            <div>
              <dt>Dirección (Mera)</dt>
              <dd>{app.address ? <Link href={addressUrl(app.address)}>{shortHash(app.address, 6)}</Link> : '—'}</dd>
            </div>
            <div>
              <dt>Tipo de passkey</dt>
              <dd>{app.mode === 'real' ? 'Real (WebAuthn + PRF)' : 'Simulada (modo de prueba)'}</dd>
            </div>
            <div>
              <dt>Clave P256 registrada onchain</dt>
              <dd>
                {snapshot?.p256 ? (
                  <>
                    <code>x {shortHash(snapshot.p256.x, 5)}</code>
                    <br />
                    <code>y {shortHash(snapshot.p256.y, 5)}</code>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Sesión</dt>
              <dd>{app.phase === 'in' ? `Abierta (se bloquea a los ${SESSION_MINUTES} min sin actividad)` : app.phase === 'locked' ? 'Bloqueada' : '—'}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3>Red y contratos</h3>
          <dl className="facts facts-tight">
            <div>
              <dt>Red</dt>
              <dd>Monad testnet (10143)</dd>
            </div>
            <div>
              <dt>Relayer</dt>
              <dd>
                <a href={`${RELAYER_URL}/health`} target="_blank" rel="noreferrer" className="link">
                  <code>{RELAYER_URL.replace('https://', '')}</code>
                  <Icon name="external" size={13} />
                </a>
              </dd>
            </div>
            {CONTRACTS.map(([name, address]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{address ? <Link href={addressUrl(address)}>{shortHash(address, 5)}</Link> : '—'}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3>Agente y servicio</h3>
          {snapshot ? (
            <dl className="facts facts-tight">
              <div>
                <dt>Agente de demostración</dt>
                <dd>
                  <Link href={addressUrl(snapshot.agent.address)}>{shortHash(snapshot.agent.address, 5)}</Link>
                </dd>
              </div>
              <div>
                <dt>Gas del agente</dt>
                <dd>{snapshot.agent.balance} MON</dd>
              </div>
              <div>
                <dt>Servicio (ERC-8004 #{snapshot.agent.service.agentId.toString()})</dt>
                <dd>
                  <Link href={addressUrl(snapshot.agent.service.address)}>{shortHash(snapshot.agent.service.address, 5)}</Link>
                </dd>
              </div>
              <div>
                <dt>Recibos onchain del usuario</dt>
                <dd>{snapshot.receipts.length}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted small">Entra para ver los datos del agente.</p>
          )}
        </section>
      </div>

      <h3>Registro técnico</h3>
      {app.log.length === 0 ? (
        <p className="empty">Aún no hay llamadas.</p>
      ) : (
        <ul className="techlog">
          {app.log.slice(0, 30).map((entry) => (
            <li key={entry.id} className={`tech tech-${entry.kind}`}>
              <span className="tech-time">{new Date(entry.at).toLocaleTimeString('es')}</span>
              <span className="tech-title">
                {entry.title}
                {entry.code ? <Badge tone="bad">{entry.code}</Badge> : null}
              </span>
              <span className="tech-meta">
                {entry.ms !== undefined ? `${Math.round(entry.ms)} ms` : ''}
                {entry.hash ? (
                  <>
                    {' '}
                    <Link href={txUrl(entry.hash)}>{shortHash(entry.hash, 5)}</Link>
                  </>
                ) : null}
              </span>
              {entry.detail ? <span className="tech-detail">{entry.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}

      <div className="stateless">
        <div>
          <h3>Prueba sin estado</h3>
          <p>
            Borra todo lo que esta página guarda (memoria, almacenamiento local) y vuelve a la pantalla de inicio. Al entrar de
            nuevo con la misma passkey, la cuenta, el permiso, los pagos y la clave P256 reaparecen: todo se reconstruye desde la cadena.
            {app.mode === 'simulated' ? ' En el modo de prueba esto no funciona, porque la clave simulada vive en este navegador.' : ''}
          </p>
        </div>
        <Button variant="secondary" icon="refresh" onClick={() => app.forget()}>
          Simular dispositivo nuevo
        </Button>
      </div>
    </Card>
  );
}
