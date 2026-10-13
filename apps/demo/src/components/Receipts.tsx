import { useMemo, useState } from 'react';
import { ago, usd } from '../lib/format';
import { href } from '../lib/router';
import type { App } from '../state/useAval';
import { SERVICE_NAME } from './Permit';
import { Badge, Card, Empty, Icon, LinkButton, PageHead, Stat } from './ui';

export type Row = {
  key: string;
  at: number;
  kind: 'auto' | 'approved' | 'blocked';
  title: string;
  meta: string;
  amount?: bigint;
};

/** Pagos (leídos de los recibos onchain) y bloqueos (de esta sesión), del más reciente al más antiguo. */
export function useActivity(app: App): Row[] {
  return useMemo<Row[]>(() => {
    const snapshot = app.snapshot!;
    const paid: Row[] = snapshot.receipts.map((r, i) => ({
      key: `r-${i}-${r.timestamp}`,
      at: Number(r.timestamp) * 1000,
      kind: r.requestId > 0n ? 'approved' : 'auto',
      title: `Pago al ${SERVICE_NAME}`,
      meta: `${ago(r.timestamp)} · recibo #${i + 1}${r.requestId > 0n ? ` · pedido #${r.requestId}` : ''}`,
      amount: r.amount,
    }));
    const blocked: Row[] = app.log
      .filter((l) => l.kind === 'blocked')
      .map((l) => ({ key: `b-${l.id}`, at: l.at, kind: 'blocked', title: l.title, meta: `${ago(l.at / 1000)} · ${l.detail ?? ''}` }));
    return [...paid, ...blocked].sort((a, b) => b.at - a.at);
  }, [app.snapshot, app.log]);
}

const KIND = {
  auto: { icon: 'bolt', tint: 'bg-ok-soft text-on-ok-soft', badge: { tone: 'ok', icon: 'check', text: 'Automático' } },
  approved: { icon: 'fingerprint', tint: 'bg-primary-soft text-on-primary-soft', badge: { tone: 'accent', icon: 'fingerprint', text: 'Con tu huella' } },
  blocked: { icon: 'block', tint: 'bg-bad-soft text-on-bad-soft', badge: { tone: 'bad', icon: 'gpp_bad', text: 'Bloqueado' } },
} as const;

export function ActivityList({ rows }: { rows: Row[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const look = KIND[row.kind];
        return (
          <li key={row.key} className="rise flex items-center gap-3 rounded-2xl bg-surface-low p-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-full ${look.tint}`}>
              <Icon name={look.icon} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{row.title}</p>
              <p className="line-clamp-2 text-[13px] text-muted">{row.meta}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {row.amount !== undefined ? <span className="font-mono text-sm font-semibold">-{usd(row.amount)} tUSD</span> : null}
              <Badge tone={look.badge.tone} icon={look.badge.icon}>
                {look.badge.text}
              </Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Actividad reciente para el panel. */
export function RecentActivity({ app }: { app: App }) {
  const rows = useActivity(app).slice(0, 4);
  return (
    <Card
      icon="history"
      title="Actividad"
      subtitle="Lo que tu agente hizo con tu dinero."
      action={
        <a href={href('recibos')} className="text-sm font-semibold text-primary hover:underline">
          Ver todo
        </a>
      }
    >
      {rows.length === 0 ? <Empty icon="receipt_long">Aún no hay actividad. Cuando tu agente pague o lo bloqueen, aparecerá aquí.</Empty> : <ActivityList rows={rows} />}
    </Card>
  );
}

export function ReputationCard({ app, compact }: { app: App; compact?: boolean }) {
  const { reputation, agent } = app.snapshot!;
  const has = reputation.count > 0n;
  return (
    <Card
      icon="workspace_premium"
      title="Reputación verificada"
      subtitle={`${SERVICE_NAME} · agente ERC-8004 #${agent.service.agentId}`}
    >
      <div className="flex items-end gap-4">
        <p className="text-5xl leading-none font-bold tracking-tight text-primary">
          {has ? reputation.value.toString() : '—'}
          <span className="ml-1 text-xl font-semibold text-muted">/ 100</span>
        </p>
        <p className="pb-1 text-[13px] text-ink-2">
          {reputation.count.toString()} {reputation.count === 1n ? 'reseña cuenta' : 'reseñas cuentan'}
          <br />
          {reputation.verifiedClients.toString()} {reputation.verifiedClients === 1n ? 'cliente le pagó' : 'clientes le pagaron'}
        </p>
      </div>
      {!compact ? (
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          Cualquiera puede escribir una reseña en ERC-8004, incluso con cuentas falsas. Aquí solo cuentan las de quienes <strong className="text-ink">de verdad le pagaron</strong> al
          servicio: cada pago deja un recibo en la cadena.
        </p>
      ) : null}
      <p className="mt-4 flex items-center gap-2 rounded-xl bg-surface-low px-3 py-2 text-[13px] text-ink-2">
        <Icon name="verified" size={18} className="text-ok" />
        Solo cuentan clientes con un recibo de pago en AgentPermit
      </p>
    </Card>
  );
}

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'auto', label: 'Automáticos' },
  { id: 'approved', label: 'Con tu huella' },
  { id: 'blocked', label: 'Bloqueados' },
] as const;

export function ReceiptsView({ app }: { app: App }) {
  const rows = useActivity(app);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const snapshot = app.snapshot!;
  const total = snapshot.receipts.reduce((sum, r) => sum + r.amount, 0n);
  const approved = snapshot.receipts.filter((r) => r.requestId > 0n).length;
  const shown = filter === 'all' ? rows : rows.filter((r) => r.kind === filter);

  return (
    <>
      <PageHead
        eyebrow="Recibos onchain · ERC-8004"
        title="Recibos y reputación"
        subtitle="Cada pago de tu agente deja un recibo en la cadena. Solo quien tiene un recibo puede sumar a la reputación del servicio."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Total pagado por tu agente" value={usd(total)} unit="tUSD" icon="account_balance_wallet" note="Leído de la cadena" />
        <Stat label="Recibos onchain" value={snapshot.receipts.length} icon="receipt_long" note={`${approved} con tu huella`} />
        <Stat label="Reseñas que cuentan" value={snapshot.reputation.count.toString()} icon="star" note="Sin recibo, no cuenta" />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card icon="history" title="Historial" subtitle="Los pagos se leen de los recibos; los bloqueos son de esta sesión (no gastan nada).">
          <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filtrar actividad">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${filter === f.id ? 'bg-primary-strong text-white' : 'bg-surface-low text-ink-2 hover:bg-surface-mid'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <Empty icon="receipt_long">{rows.length === 0 ? 'Aún no hay actividad.' : 'Nada con este filtro.'}</Empty>
          ) : (
            <ActivityList rows={shown} />
          )}
          {rows.length === 0 ? (
            <div className="mt-4">
              <LinkButton href={href('permiso')} variant="primary" icon="smart_toy">
                Probar a tu agente
              </LinkButton>
            </div>
          ) : null}
        </Card>
        <ReputationCard app={app} />
      </div>
    </>
  );
}
