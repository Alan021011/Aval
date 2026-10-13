import { usd } from '../lib/format';
import { href } from '../lib/router';
import { type App, isNever } from '../state/useAval';
import { SERVICE_NAME } from './Permit';
import { Badge, Button, Card, Empty, Icon, LinkButton, Meter, PageHead } from './ui';

function ApproveButton({ app, requestId, size }: { app: App; requestId: bigint; size?: 'lg' }) {
  return (
    <Button
      variant="primary"
      size={size}
      icon="fingerprint"
      block
      loading={app.busy === `approve-${requestId}`}
      disabled={app.phase === 'locked' || !!app.busy}
      onClick={() => app.approve(requestId)}
    >
      Aprobar con mi huella
    </Button>
  );
}

/** Tarjeta corta para el panel: el primer pedido pendiente, o que no hay nada. */
export function ApprovalsMini({ app }: { app: App }) {
  const first = app.pending[0];
  return (
    <Card
      icon="fingerprint"
      title="Aprobaciones"
      action={app.pending.length > 0 ? <Badge tone="warn">{app.pending.length} en espera</Badge> : undefined}
      className={first ? 'ring-2 !ring-warn/40' : ''}
    >
      {first ? (
        <div className="rounded-2xl bg-warn-soft/60 p-4">
          <p className="text-lg font-semibold">Tu agente quiere pagar {usd(first.request.amount)} tUSD</p>
          <p className="mb-4 text-sm text-primary">Al {SERVICE_NAME}</p>
          <ApproveButton app={app} requestId={first.requestId} />
          {app.pending.length > 1 ? (
            <a href={href('aprobaciones')} className="mt-3 block text-center text-sm font-semibold text-primary hover:underline">
              Ver los {app.pending.length} pedidos
            </a>
          ) : null}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Icon name="done_all" size={18} />
          Nada pendiente. Los pagos grandes esperarán aquí tu huella.
        </p>
      )}
    </Card>
  );
}

export function ApprovalsView({ app }: { app: App }) {
  const items = app.pending;
  const current = app.currentPermit;
  const waiting = items.reduce((sum, i) => sum + i.request.amount, 0n);

  return (
    <>
      <PageHead
        eyebrow={items.length > 0 ? `${items.length} en espera de tu huella` : 'Aprobaciones'}
        title="Aprobaciones"
        subtitle="Los pagos que superan tu umbral esperan aquí. Solo se ejecutan con tu huella, y la firma se verifica en la cadena con el precompile P256 de Monad."
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          {items.length === 0 ? (
            <Card>
              <Empty icon="done_all">Nada pendiente. Cuando tu agente pida un pago grande, aparecerá aquí.</Empty>
              {current ? (
                <div className="mt-4 flex justify-center">
                  <LinkButton href={href('permiso')} icon="smart_toy">
                    Que tu agente pida un pago grande
                  </LinkButton>
                </div>
              ) : null}
            </Card>
          ) : (
            items.map(({ requestId, request }) => {
              const remaining = current ? current.permit.terms.maxTotal - current.permit.spent : 0n;
              const fits = !current || (request.amount <= remaining && request.amount <= current.permit.terms.maxPerSpend);
              const threshold = current?.permit.terms.approvalThreshold;
              return (
                <Card key={requestId.toString()} className="rise">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="grid size-12 place-items-center rounded-xl bg-surface-mid text-primary">
                        <Icon name="translate" size={26} />
                      </span>
                      <div>
                        <p className="font-semibold">{SERVICE_NAME}</p>
                        <p className="text-[13px] text-muted">Agente ERC-8004 #{app.snapshot!.agent.service.agentId.toString()}</p>
                      </div>
                    </div>
                    <Badge tone="warn" dot>
                      Pedido #{requestId.toString()}
                    </Badge>
                  </div>

                  <div className="mb-4 rounded-2xl bg-surface-low p-5">
                    <p className="text-[12px] font-medium tracking-wider text-ink-2 uppercase">Monto solicitado</p>
                    <p className="text-5xl leading-tight font-bold tracking-tight">
                      {usd(request.amount)} <span className="text-xl font-semibold text-primary">tUSD</span>
                    </p>
                  </div>

                  {threshold !== undefined && !isNever(threshold) ? (
                    <div className="mb-5 flex items-start gap-3 rounded-2xl bg-warn-soft p-4 text-on-warn-soft">
                      <Icon name="priority_high" size={22} />
                      <div>
                        <p className="font-semibold">Supera tu umbral de {usd(threshold)} tUSD</p>
                        <p className="text-sm opacity-90">Tu permiso deja que el agente pague solo hasta {usd(threshold)} tUSD. Por encima, hace falta tu huella.</p>
                      </div>
                    </div>
                  ) : null}

                  <ul className="mb-5 flex flex-col gap-2 text-sm">
                    {fits ? (
                      <li className="flex items-center gap-2 rounded-xl bg-surface-low px-3 py-2">
                        <Icon name="check_circle" size={18} fill className="text-ok" />
                        Dentro de tu máximo por pago y de lo que queda del permiso
                      </li>
                    ) : (
                      <li className="flex items-center gap-2 rounded-xl bg-bad-soft px-3 py-2 text-on-bad-soft">
                        <Icon name="gpp_bad" size={18} />
                        Ya no cabe: tu permiso solo tiene {usd(remaining)} tUSD disponibles. Si lo apruebas, el contrato lo rechazará.
                      </li>
                    )}
                    <li className="flex items-center gap-2 rounded-xl bg-surface-low px-3 py-2">
                      <Icon name="check_circle" size={18} fill className="text-ok" />
                      Solo puede ir al {SERVICE_NAME}
                    </li>
                    <li className="flex items-center gap-2 rounded-xl bg-warn-soft/70 px-3 py-2 text-on-warn-soft">
                      <Icon name="fingerprint" size={18} />
                      <span className="flex-1">Falta tu firma con la passkey</span>
                      <span className="font-medium">Pendiente</span>
                    </li>
                  </ul>

                  <ApproveButton app={app} requestId={requestId} size="lg" />
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-muted">
                    <Icon name="verified_user" size={14} />
                    Firma WebAuthn sobre el hash exacto del pago (EIP-712)
                  </p>
                </Card>
              );
            })
          )}
        </div>

        <aside className="flex flex-col gap-4">
          {current ? (
            <Card icon="account_balance" title="Tu permiso" action={<Badge tone="ok">Activo</Badge>}>
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="text-ink-2">Usado del total</span>
                <span className="font-mono font-semibold">
                  {usd(current.permit.spent)} / {usd(current.permit.terms.maxTotal)} tUSD
                </span>
              </div>
              <Meter
                parts={[
                  { value: Number((current.permit.spent * 1000n) / (current.permit.terms.maxTotal || 1n)) / 10, className: 'bg-primary-strong' },
                  { value: Number((waiting * 1000n) / (current.permit.terms.maxTotal || 1n)) / 10, className: 'bg-[#f5a524]' },
                ]}
                label="Gastado y en espera de aprobación"
              />
              <div className="mt-3 flex flex-col gap-1 text-[13px] text-ink-2">
                <p className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-primary-strong" /> Pagado: {usd(current.permit.spent)} tUSD
                </p>
                <p className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#f5a524]" /> En espera de tu huella: {usd(waiting)} tUSD
                </p>
              </div>
            </Card>
          ) : null}

          <div className="rounded-2xl bg-term p-5 text-on-term">
            <p className="mb-3 flex items-center gap-2 font-semibold">
              <Icon name="terminal" size={20} />
              Cómo se verifica
            </p>
            <dl className="flex flex-col gap-2 font-mono text-[12px]">
              <div className="rounded-lg bg-term-2 px-3 py-2">
                <dt className="text-term-muted">PRECOMPILE</dt>
                <dd className="text-term-accent">0x…0100 · P256 nativo de Monad</dd>
              </div>
              <div className="rounded-lg bg-term-2 px-3 py-2">
                <dt className="text-term-muted">QUÉ FIRMAS</dt>
                <dd>El hash EIP-712 del pedido: monto, destinatario y permiso</dd>
              </div>
              <div className="rounded-lg bg-term-2 px-3 py-2">
                <dt className="text-term-muted">GAS PARA TI</dt>
                <dd className="text-term-accent">0 MON · lo paga el relayer</dd>
              </div>
            </dl>
            <a href={href('inspector')} className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-term-accent hover:underline">
              Ver los hashes en el inspector
              <Icon name="arrow_forward" size={16} />
            </a>
          </div>
        </aside>
      </div>
    </>
  );
}
