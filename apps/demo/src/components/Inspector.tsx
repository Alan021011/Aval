import { erc8004MonadTestnet, monadTestnet } from '@aval/sdk';
import { type ReactNode, useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { EXPLORER_URL, RELAYER_URL, SESSION_MINUTES, addressUrl, publicClient, txUrl } from '../lib/config';
import { seconds, shortHash } from '../lib/format';
import type { App } from '../state/useAval';
import type { Memory } from '../state/useMemory';
import { MemoryFacts } from './Memory';
import { Badge, Button, Card, Empty, Icon, Stat } from './ui';

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] text-primary hover:underline">
      {children}
      <Icon name="open_in_new" size={14} />
    </a>
  );
}

const CONTRACTS = [
  ['PasskeyRegistry', monadTestnet.passkeyRegistry],
  ['AgentPermit', monadTestnet.agentPermit],
  ['ReputationReader', monadTestnet.reputationReader],
  ['TestUSD (tUSD)', monadTestnet.testUsd],
  ['MemoryVault', monadTestnet.memoryVault],
  ['ERC-8004 Identity', erc8004MonadTestnet.identityRegistry],
  ['ERC-8004 Reputation', erc8004MonadTestnet.reputationRegistry],
  ['Precompile P256', '0x0000000000000000000000000000000000000100'],
] as const;

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-col gap-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 rounded-xl bg-surface-low px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <dt className="text-[13px] text-ink-2">{k}</dt>
          <dd className="text-sm font-medium break-all sm:text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Panel para los jueces del track: todo lo que la vista de usuario oculta a propósito. */
export function InspectorView({ app, memory }: { app: App; memory?: Memory }) {
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

  const m = app.metrics;

  return (
    <>
      <section className="card mb-5 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge tone="accent" icon="gavel">
              Para jueces
            </Badge>
            <Badge dot className="font-mono">
              Monad testnet · chain 10143
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Inspector</h1>
          <p className="mt-1 text-ink-2">Lo que la vista de usuario oculta: contratos, claves, hashes y tiempos.</p>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-low p-4 sm:flex-row sm:items-center md:max-w-md">
          <div className="text-[13px]">
            <p className="font-semibold">Prueba sin estado</p>
            <p className="text-ink-2">
              Borra lo que esta página guarda y vuelve al inicio. Al entrar con la misma passkey, todo reaparece desde la cadena.
              {app.mode === 'simulated' ? ' En el modo de prueba esto no funciona: la clave simulada vive en este navegador.' : ''}
            </p>
          </div>
          <Button variant="primary" icon="phonelink_erase" onClick={() => app.forget()} className="shrink-0">
            Simular dispositivo nuevo
          </Button>
        </div>
      </section>

      <div className="mb-5 grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <Stat label="Hasta la cuenta lista" value={m.readyMs === null ? '—' : seconds(m.readyMs)} unit={m.readyMs === null ? undefined : 's'} icon="timer" note="Desde «Empezar»" />
        <Stat label="Primera transacción" value={m.firstTxMs === null ? '—' : seconds(m.firstTxMs)} unit={m.firstTxMs === null ? undefined : 's'} icon="bolt" note="Confirmada en Monad" />
        <Stat label="Huellas al crear la cuenta" value={m.readyPrompts ?? '—'} icon="fingerprint" note={`${app.prompts} en total (con aprobaciones)`} />
        <Stat label="MON que pagó el usuario" value={userMon === null ? (app.address ? '…' : '—') : formatEther(userMon)} unit="MON" icon="local_gas_station" note="Nunca tuvo: paga el relayer" />
      </div>
      <p className="-mt-2 mb-5 text-[12px] text-muted">Los tiempos incluyen lo que el usuario tarda en la ventana de su huella.</p>

      <div className="mb-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Card icon="fingerprint" title="Cuenta y passkey" action={<Badge tone="ok">P256 · 0x0100</Badge>}>
          <Facts
            rows={[
              ['Dirección (Mera)', app.address ? <Link href={addressUrl(app.address)}>{shortHash(app.address, 6)}</Link> : '—'],
              ['Tipo de passkey', app.mode === 'real' ? 'Real (WebAuthn + PRF)' : 'Simulada (modo de prueba)'],
              [
                'Clave P256 registrada onchain',
                snapshot?.p256 ? (
                  <span className="font-mono text-[12px]">
                    x {shortHash(snapshot.p256.x, 5)}
                    <br />y {shortHash(snapshot.p256.y, 5)}
                  </span>
                ) : (
                  '—'
                ),
              ],
              ['Sesión', app.phase === 'in' ? `Abierta (se bloquea a los ${SESSION_MINUTES} min sin actividad)` : app.phase === 'locked' ? 'Bloqueada' : '—'],
            ]}
          />
        </Card>

        <Card icon="smart_toy" title="Agente y servicio" action={snapshot?.agent.ready ? <Badge tone="ok" dot>Listo</Badge> : undefined}>
          {snapshot ? (
            <Facts
              rows={[
                ['Agente de demostración', <Link href={addressUrl(snapshot.agent.address)}>{shortHash(snapshot.agent.address, 5)}</Link>],
                ['Modelo', 'Qwen 3.8 Max (en el relayer)'],
                ['Gas del agente', `${snapshot.agent.balance} MON`],
                [`Servicio (ERC-8004 #${snapshot.agent.service.agentId})`, <Link href={addressUrl(snapshot.agent.service.address)}>{shortHash(snapshot.agent.service.address, 5)}</Link>],
                ['Recibos onchain del usuario', String(snapshot.receipts.length)],
              ]}
            />
          ) : (
            <Empty icon="login">Entra para ver los datos del agente.</Empty>
          )}
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          icon="hub"
          title="Red y contratos"
          subtitle="Verificados (coincidencia exacta) en el Sourcify de Monad."
          action={
            <a href={EXPLORER_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              Explorador
              <Icon name="open_in_new" size={16} />
            </a>
          }
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {CONTRACTS.map(([name, address]) => (
              <li key={name} className="flex items-center justify-between gap-2 rounded-xl bg-surface-low px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[13px] font-medium">{name}</span>
                  {address ? <Link href={addressUrl(address)}>{shortHash(address, 4)}</Link> : <span className="text-muted">—</span>}
                </span>
                <span className="size-2 shrink-0 rounded-full bg-ok-dot" aria-hidden="true" />
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 rounded-xl bg-surface-low px-3 py-2 sm:col-span-2">
              <span className="min-w-0">
                <span className="block font-mono text-[13px] font-medium">Relayer</span>
                <Link href={`${RELAYER_URL}/health`}>{RELAYER_URL.replace('https://', '')}</Link>
              </span>
            </li>
          </ul>
        </Card>

        <section className="rounded-2xl bg-term p-5 text-on-term" aria-labelledby="mem-facts">
          <p id="mem-facts" className="mb-3 flex items-center gap-2 font-semibold">
            <Icon name="encrypted" size={20} />
            Memoria cifrada (Mera · varias claves)
          </p>
          {memory ? <MemoryFacts memory={memory} dark /> : <p className="text-sm text-term-muted">Entra para ver los casilleros cifrados.</p>}
        </section>
      </div>

      <Card
        icon="terminal"
        title="Registro técnico"
        action={
          <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <span className="size-2 rounded-full bg-ok-dot" aria-hidden="true" />
            Esta sesión
          </span>
        }
      >
        {app.log.length === 0 ? (
          <Empty icon="terminal">Aún no hay llamadas.</Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto md:-mx-6">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-surface-low font-mono text-[12px] text-ink-2">
                <tr>
                  <th className="px-5 py-2.5 font-medium md:px-6">Hora</th>
                  <th className="px-3 py-2.5 font-medium">Acción</th>
                  <th className="px-3 py-2.5 font-medium">Tiempo</th>
                  <th className="px-3 py-2.5 font-medium">Transacción</th>
                  <th className="px-5 py-2.5 text-right font-medium md:px-6">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {app.log.slice(0, 30).map((entry) => (
                  <tr key={entry.id} className="align-top">
                    <td className="px-5 py-3 font-mono text-[12px] text-ink-2 md:px-6">{new Date(entry.at).toLocaleTimeString('es')}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{entry.title}</p>
                      {entry.detail ? <p className={`text-[12px] ${entry.kind === 'blocked' ? 'text-bad' : 'text-muted'}`}>{entry.detail}</p> : null}
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] whitespace-nowrap">{entry.ms !== undefined ? `${Math.round(entry.ms)} ms` : '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{entry.hash ? <Link href={txUrl(entry.hash)}>{shortHash(entry.hash, 4)}</Link> : <span className="text-muted">—</span>}</td>
                    <td className="px-5 py-3 text-right md:px-6">
                      {entry.code ? (
                        <Badge tone="bad" className="font-mono">
                          {entry.code}
                        </Badge>
                      ) : entry.kind === 'tx' ? (
                        <Badge tone="ok" icon="check">
                          Confirmada
                        </Badge>
                      ) : (
                        <Badge>Info</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
