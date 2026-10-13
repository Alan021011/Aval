import { useMemo, useState } from 'react';
import { parseUsd, remainingTime, usd } from '../lib/format';
import { href } from '../lib/router';
import { type App, type PermitForm, isNever, scenarios } from '../state/useAval';
import { Badge, Button, Callout, Card, Field, Icon, LinkButton, Meter, PageHead, ScrollIntoView, ZoneBar } from './ui';

/** Revocar es irreversible y se registra en la cadena: pide un segundo toque para confirmar. */
function RevokeButton({ app, permitId, locked }: { app: App; permitId: bigint; locked: boolean }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="danger" icon="cancel" disabled={locked || !!app.busy} onClick={() => setConfirming(true)}>
        Revocar permiso
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="alertdialog" aria-label="Confirmar revocación">
      <span className="text-[13px] font-medium">¿Revocar? El agente dejará de poder gastar.</span>
      <Button variant="danger" icon="cancel" loading={app.busy === 'revoke'} disabled={locked || !!app.busy} onClick={() => app.revokePermit(permitId)}>
        Sí, revocar
      </Button>
      <Button disabled={app.busy === 'revoke'} onClick={() => setConfirming(false)}>
        Cancelar
      </Button>
    </div>
  );
}

export const SERVICE_NAME = 'Servicio de traducción';

function PermitFormCard({ app }: { app: App }) {
  const [perSpend, setPerSpend] = useState('100');
  const [total, setTotal] = useState('300');
  const [threshold, setThreshold] = useState('50');
  const [hours, setHours] = useState('24');
  const locked = app.phase === 'locked';

  const parsed = useMemo(() => {
    const p = parseUsd(perSpend);
    const t = parseUsd(total);
    const th = parseUsd(threshold);
    const h = Number(hours);
    return {
      p,
      t,
      th,
      h,
      errors: {
        perSpend: p ? null : 'Escribe un monto mayor que 0.',
        total: !t ? 'Escribe un monto mayor que 0.' : p && p > t ? 'El total no puede ser menor que el máximo por pago.' : null,
        threshold: th ? null : 'Escribe un monto mayor que 0.',
        hours: Number.isFinite(h) && h >= 1 && h <= 720 ? null : 'Entre 1 y 720 horas.',
      },
    };
  }, [perSpend, total, threshold, hours]);

  const invalid = Object.values(parsed.errors).some(Boolean);
  const balance = app.snapshot!.balance;
  const short = parsed.t !== null && parsed.t > balance;

  const submit = () => {
    if (invalid || !parsed.p || !parsed.t || !parsed.th) return;
    const form: PermitForm = { perSpend: parsed.p, total: parsed.t, threshold: parsed.th, hours: parsed.h };
    void app.createPermit(form);
  };

  return (
    <Card id="permit" icon="shield" title="Dale un permiso a tu agente" subtitle={`Tu agente es una demostración y solo puede pagar al «${SERVICE_NAME}». Tú pones los límites.`}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Máximo por pago (tUSD)" hint="Lo más que puede pagar de una vez." error={parsed.errors.perSpend}>
            <input className="input" inputMode="decimal" value={perSpend} onChange={(e) => setPerSpend(e.target.value)} />
          </Field>
          <Field label="Total que puede gastar (tUSD)" hint="El tope de todo el permiso." error={parsed.errors.total}>
            <input className="input" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
          </Field>
          <Field label="Pedirme aprobación sobre (tUSD)" hint="Los pagos mayores esperan tu huella." error={parsed.errors.threshold}>
            <input className="input" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
          <Field label="Vence en (horas)" hint="Después, el permiso deja de funcionar." error={parsed.errors.hours}>
            <input className="input" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
        </div>

        {parsed.p && parsed.th ? (
          <div>
            <p className="mb-2 text-sm font-medium">Así quedarían tus reglas</p>
            <ZoneBar threshold={parsed.th >= parsed.p ? (1n << 128n) - 1n : parsed.th} maxPerSpend={parsed.p} />
          </div>
        ) : null}

        {short ? (
          <p className="flex items-center gap-2 text-[13px] text-warn" role="status">
            <Icon name="warning" size={16} />
            Ojo: tu saldo es menor que el total. El agente solo podrá pagar lo que tengas.
          </p>
        ) : null}
        <Button variant="primary" size="lg" icon="shield" loading={app.busy === 'permit'} disabled={invalid || locked || !!app.busy} onClick={submit} className="sm:w-fit">
          Crear permiso
        </Button>
      </form>
    </Card>
  );
}

/** Lo esencial del permiso activo: cuánto gastó y las tres zonas. Se usa en el panel y en esta vista. */
export function PermitSummary({ app, compact }: { app: App; compact?: boolean }) {
  const current = app.currentPermit!;
  const { permit, permitId } = current;
  const { terms } = permit;
  const used = Number((permit.spent * 1000n) / (terms.maxTotal || 1n)) / 10;
  const locked = app.phase === 'locked';

  return (
    <Card
      id="permit"
      icon="shield"
      title="Permiso de tu agente"
      subtitle={`Puede pagar solo al «${SERVICE_NAME}» · permiso #${permitId}`}
      action={
        <Badge tone="ok" dot>
          Activo
        </Badge>
      }
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="font-semibold">
          {usd(permit.spent)} gastados de {usd(terms.maxTotal)} tUSD
        </p>
        <p className="font-mono text-[13px] text-ink-2">{used.toLocaleString('es', { maximumFractionDigits: 1 })}%</p>
      </div>
      <Meter parts={[{ value: used, className: 'bg-primary-strong' }]} label={`Gastó ${usd(permit.spent)} de ${usd(terms.maxTotal)} tUSD`} />
      <p className="mt-1.5 mb-4 text-[13px] text-muted">
        Quedan {usd(terms.maxTotal - permit.spent)} tUSD · vence en {remainingTime(terms.expiresAt)}
      </p>

      <ZoneBar threshold={terms.approvalThreshold} maxPerSpend={terms.maxPerSpend} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] text-ink-2">
          <Icon name="verified" size={18} className="text-primary" />
          Máximo por pago {usd(terms.maxPerSpend)} tUSD · aprobación {isNever(terms.approvalThreshold) ? 'nunca' : `sobre ${usd(terms.approvalThreshold)} tUSD`}
        </p>
        {compact ? (
          <LinkButton href={href('permiso')} icon="play_arrow">
            Probar a tu agente
          </LinkButton>
        ) : (
          <RevokeButton app={app} permitId={permitId} locked={locked} />
        )}
      </div>
    </Card>
  );
}

type Scenario = {
  key: string;
  icon: string;
  tint: string;
  title: string;
  detail: string;
  badge: { tone: 'ok' | 'bad' | 'warn' | 'accent'; icon: string; text: string };
  button: string;
  primary?: boolean;
  busy: string;
  disabled: boolean;
  run: () => void;
};

function AgentPanel({ app }: { app: App }) {
  const current = app.currentPermit!;
  const { small, over, big } = scenarios(current.permit);
  const left = current.permit.terms.maxTotal - current.permit.spent;
  const disabled = app.phase === 'locked' || !!app.busy;

  const items: Scenario[] = [
    {
      key: 'small',
      icon: 'payments',
      tint: 'bg-ok-soft text-on-ok-soft',
      title: `Pagar un servicio · ${usd(small)} tUSD`,
      detail: 'Dentro de tus límites: se paga solo, sin molestarte.',
      badge: { tone: 'ok', icon: 'check', text: 'Se paga solo' },
      button: 'Que pague',
      primary: true,
      busy: `spend-${small}`,
      disabled: disabled || small > left,
      run: () => app.agentSpend(small, 'dentro del límite'),
    },
    {
      key: 'over',
      icon: 'block',
      tint: 'bg-bad-soft text-on-bad-soft',
      title: `Intentar pagar de más · ${usd(over)} tUSD`,
      detail: 'Supera el máximo por pago: el contrato lo bloquea.',
      badge: { tone: 'bad', icon: 'gpp_bad', text: 'Bloqueado' },
      button: 'Que lo intente',
      busy: `spend-${over}`,
      disabled,
      run: () => app.agentSpend(over, 'más del máximo por pago'),
    },
    ...(big !== null
      ? [
          {
            key: 'big',
            icon: 'fingerprint',
            tint: 'bg-warn-soft text-on-warn-soft',
            title: `Pedir permiso para un pago grande · ${usd(big)} tUSD`,
            detail: 'Supera tu umbral: espera tu huella antes de pagar.',
            badge: { tone: 'warn' as const, icon: 'fingerprint', text: 'Espera tu huella' },
            button: 'Que pida permiso',
            busy: `request-${big}`,
            disabled: disabled || big > left,
            run: () => app.agentRequest(big),
          },
        ]
      : []),
    {
      key: 'review',
      icon: 'star',
      tint: 'bg-primary-soft text-on-primary-soft',
      title: 'Reseñar al servicio · 90/100',
      detail: app.snapshot!.receipts.length === 0 ? 'Primero tu agente tiene que pagarle: solo cuentan las reseñas de clientes que pagaron.' : 'Cuenta en su reputación porque tu agente ya le pagó.',
      badge: { tone: 'accent', icon: 'verified', text: 'ERC-8004' },
      button: 'Que reseñe',
      busy: 'review-90',
      disabled: disabled || app.snapshot!.receipts.length === 0,
      run: () => app.agentReview(90),
    },
  ];

  const result = app.lastResult;

  return (
    <Card id="agent" icon="smart_toy" title="Tu agente en acción" subtitle="Prueba qué pasa en cada caso. El agente intenta; el contrato decide.">
      <ul className="flex flex-col gap-2.5">
        {items.map((s) => (
          <li key={s.key} className="flex flex-col gap-3 rounded-2xl bg-surface-low p-3.5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${s.tint}`}>
                <Icon name={s.icon} />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                  {s.title}
                  <Badge tone={s.badge.tone} icon={s.badge.icon}>
                    {s.badge.text}
                  </Badge>
                </p>
                <p className="mt-0.5 text-[13px] text-ink-2">{s.detail}</p>
              </div>
            </div>
            <Button variant={s.primary ? 'primary' : 'secondary'} icon="smart_toy" loading={app.busy === s.busy} disabled={s.disabled} onClick={s.run} className="shrink-0 sm:min-w-40">
              {s.button}
            </Button>
          </li>
        ))}
      </ul>

      <div className="mt-4" aria-live="polite">
        {result ? (
          <ScrollIntoView key={result.text}>
          <Callout
            tone={result.kind === 'blocked' ? 'bad' : 'ok'}
            title={result.kind === 'blocked' ? 'El contrato lo bloqueó' : 'Hecho'}
            action={
              app.pending.length > 0 && result.kind === 'ok' ? (
                <LinkButton href={href('aprobaciones')} variant="primary" icon="fingerprint">
                  Ir a aprobar
                </LinkButton>
              ) : undefined
            }
          >
            {result.text}
            {result.kind === 'blocked' ? <span className="mt-1 block font-mono text-[12px] opacity-80">Tus fondos no se movieron y el usuario no pagó gas.</span> : null}
          </Callout>
          </ScrollIntoView>
        ) : null}
      </div>
    </Card>
  );
}

export function PermitView({ app }: { app: App }) {
  const has = !!app.currentPermit;
  return (
    <>
      <PageHead
        eyebrow="Permiso y reglas"
        title={has ? 'Tu agente, dentro de tus reglas' : 'Dale un permiso a tu agente'}
        subtitle="El contrato hace cumplir tus límites: lo pequeño se paga solo, lo grande espera tu huella y lo que se pasa se bloquea."
      />
      {has ? (
        <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-2">
          <PermitSummary app={app} />
          <AgentPanel app={app} />
        </div>
      ) : (
        <div className="max-w-3xl">
          <PermitFormCard app={app} />
        </div>
      )}
    </>
  );
}
