import { useMemo, useState } from 'react';
import { ago, parseUsd, remainingTime, seconds, usd } from '../lib/format';
import { type App, type PermitForm, isNever, scenarios } from '../state/useAval';
import { Badge, Button, Card, Field, Icon } from './ui';

const SERVICE_NAME = 'Servicio de traducción';

// ------------------------------------------------------------------------------------------------------------------

export function Summary({ app }: { app: App }) {
  const snapshot = app.snapshot!;
  const locked = app.phase === 'locked';
  return (
    <div className="summary">
      <Card className="balance">
        <p className="muted small">Tu saldo</p>
        <p className="balance-amount">
          {usd(snapshot.balance)} <span>tUSD</span>
        </p>
        <p className="muted small">Dólares de prueba. No tienen valor real.</p>
        <Button variant="ghost" icon="refresh" loading={app.busy === 'faucet'} disabled={locked || !!app.busy} onClick={() => app.topUp()}>
          Pedir más saldo de prueba
        </Button>
      </Card>

      {app.metrics.readyMs !== null ? (
        <div className="callout callout-ok" role="status">
          <Icon name="check" />
          <div>
            <strong>
              Listo en {seconds(app.metrics.readyMs)} s, con{' '}
              {(app.metrics.readyPrompts ?? 1) === 1 ? '1 verificación' : `${app.metrics.readyPrompts} verificaciones`} de tu huella.
            </strong>
            <p>No necesitaste cripto, ni extensiones, ni frases secretas: el gas lo paga el relayer.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------

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
    <Card
      id="permit"
      title="Dale un permiso a tu agente"
      subtitle={`Tu agente es una demostración y solo puede pagar al «${SERVICE_NAME}». Tú pones los límites.`}
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="form-grid">
          <Field label="Máximo por pago (tUSD)" hint="Lo más que puede pagar de una vez." error={parsed.errors.perSpend}>
            <input inputMode="decimal" value={perSpend} onChange={(e) => setPerSpend(e.target.value)} />
          </Field>
          <Field label="Total que puede gastar (tUSD)" hint="El tope de todo el permiso." error={parsed.errors.total}>
            <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
          </Field>
          <Field label="Pedirme aprobación sobre (tUSD)" hint="Los pagos mayores esperan tu huella." error={parsed.errors.threshold}>
            <input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
          <Field label="Vence en (horas)" hint="Después, el permiso deja de funcionar." error={parsed.errors.hours}>
            <input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
        </div>
        {short ? (
          <p className="field-hint" role="status">
            Ojo: tu saldo es menor que el total. El agente solo podrá pagar lo que tengas.
          </p>
        ) : null}
        <Button variant="primary" icon="shield" loading={app.busy === 'permit'} disabled={invalid || locked || !!app.busy} onClick={submit}>
          Crear permiso
        </Button>
      </form>
    </Card>
  );
}

export function PermitCard({ app }: { app: App }) {
  const current = app.currentPermit;
  if (!current) return <PermitFormCard app={app} />;

  const { permit, permitId } = current;
  const { terms } = permit;
  const used = Number((permit.spent * 100n) / (terms.maxTotal || 1n));
  const locked = app.phase === 'locked';

  return (
    <Card
      id="permit"
      title="Permiso de tu agente"
      subtitle={`Puede pagar solo al «${SERVICE_NAME}».`}
      action={<Badge tone="ok">Activo</Badge>}
    >
      <div className="meter" role="img" aria-label={`Gastó ${usd(permit.spent)} de ${usd(terms.maxTotal)} tUSD`}>
        <div className="meter-bar" style={{ width: `${Math.min(100, used)}%` }} />
      </div>
      <p className="meter-label">
        <strong>{usd(permit.spent)}</strong> gastados de <strong>{usd(terms.maxTotal)}</strong> tUSD
      </p>
      <dl className="facts">
        <div>
          <dt>Máximo por pago</dt>
          <dd>{usd(terms.maxPerSpend)} tUSD</dd>
        </div>
        <div>
          <dt>Te pide aprobación sobre</dt>
          <dd>{isNever(terms.approvalThreshold) ? 'Nunca' : `${usd(terms.approvalThreshold)} tUSD`}</dd>
        </div>
        <div>
          <dt>Vence en</dt>
          <dd>{remainingTime(terms.expiresAt)}</dd>
        </div>
        <div>
          <dt>Permiso</dt>
          <dd>#{permitId.toString()}</dd>
        </div>
      </dl>
      <Button variant="danger" icon="x" loading={app.busy === 'revoke'} disabled={locked || !!app.busy} onClick={() => app.revokePermit(permitId)}>
        Revocar permiso
      </Button>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------------------------

export function AgentPanel({ app }: { app: App }) {
  const current = app.currentPermit;
  const locked = app.phase === 'locked';
  if (!current) return null;

  const { small, over, big } = scenarios(current.permit);
  const left = current.permit.terms.maxTotal - current.permit.spent;
  const disabled = locked || !!app.busy;

  return (
    <Card id="agent" title="Tu agente en acción" subtitle="Prueba qué pasa en cada caso. El agente intenta; el contrato decide.">
      <ul className="actions">
        <li>
          <div>
            <strong>Pagar un servicio · {usd(small)} tUSD</strong>
            <p>Dentro de tus límites: se paga solo, sin molestarte.</p>
          </div>
          <Button
            variant="primary"
            icon="bot"
            loading={app.busy === `spend-${small}`}
            disabled={disabled || small > left}
            onClick={() => app.agentSpend(small, 'dentro del límite')}
          >
            Que pague
          </Button>
        </li>
        <li>
          <div>
            <strong>Intentar pagar de más · {usd(over)} tUSD</strong>
            <p>Supera el máximo por pago: el contrato lo bloquea.</p>
          </div>
          <Button
            icon="bot"
            loading={app.busy === `spend-${over}`}
            disabled={disabled}
            onClick={() => app.agentSpend(over, 'más del máximo por pago')}
          >
            Que lo intente
          </Button>
        </li>
        {big !== null ? (
          <li>
            <div>
              <strong>Pedir permiso para un pago grande · {usd(big)} tUSD</strong>
              <p>Supera tu umbral: espera tu huella antes de pagar.</p>
            </div>
            <Button
              icon="bot"
              loading={app.busy === `request-${big}`}
              disabled={disabled || big > left}
              onClick={() => app.agentRequest(big)}
            >
              Que pida permiso
            </Button>
          </li>
        ) : null}
        <li>
          <div>
            <strong>Reseñar al servicio · 90/100</strong>
            <p>Cuenta en su reputación porque tu agente ya le pagó.</p>
          </div>
          <Button icon="star" loading={app.busy === 'review-90'} disabled={disabled || app.snapshot!.receipts.length === 0} onClick={() => app.agentReview(90)}>
            Que reseñe
          </Button>
        </li>
      </ul>

      <div className="result" aria-live="polite">
        {app.lastResult ? (
          <div className={`callout ${app.lastResult.kind === 'blocked' ? 'callout-bad' : 'callout-ok'}`}>
            <Icon name={app.lastResult.kind === 'blocked' ? 'shield' : 'check'} />
            <div>
              <strong>{app.lastResult.kind === 'blocked' ? 'El contrato lo bloqueó' : 'Hecho'}</strong>
              <p>{app.lastResult.text}</p>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------------------------

export function Approvals({ app }: { app: App }) {
  const locked = app.phase === 'locked';
  const items = app.pending;
  return (
    <Card
      id="approvals"
      title="Aprobaciones"
      subtitle="Los pagos grandes esperan aquí hasta que los apruebes con tu huella."
      action={items.length > 0 ? <Badge tone="warn">{items.length} pendiente{items.length > 1 ? 's' : ''}</Badge> : undefined}
    >
      {items.length === 0 ? (
        <p className="empty">Nada pendiente. Cuando tu agente pida un pago grande, aparecerá aquí.</p>
      ) : (
        <ul className="list">
          {items.map(({ requestId, request }) => (
            <li key={requestId.toString()} className="approval">
              <div>
                <strong>Tu agente quiere pagar {usd(request.amount)} tUSD</strong>
                <p className="muted small">Al {SERVICE_NAME}</p>
              </div>
              <Button
                variant="primary"
                icon="fingerprint"
                loading={app.busy === `approve-${requestId}`}
                disabled={locked || !!app.busy}
                onClick={() => app.approve(requestId)}
              >
                Aprobar con mi huella
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------------------------

type Row = { key: string; at: number; tone: 'ok' | 'bad'; title: string; meta: string; badge?: { tone: 'accent' | 'bad'; text: string } };

export function Activity({ app }: { app: App }) {
  const rows = useMemo<Row[]>(() => {
    const snapshot = app.snapshot!;
    const paid: Row[] = snapshot.receipts.map((r, i) => ({
      key: `r-${i}-${r.timestamp}`,
      at: Number(r.timestamp) * 1000,
      tone: 'ok',
      title: `Pago de ${usd(r.amount)} tUSD al ${SERVICE_NAME}`,
      meta: ago(r.timestamp),
      badge: r.requestId > 0n ? { tone: 'accent', text: 'Con tu aprobación' } : undefined,
    }));
    const blocked: Row[] = app.log
      .filter((l) => l.kind === 'blocked')
      .map((l) => ({
        key: `b-${l.id}`,
        at: l.at,
        tone: 'bad',
        title: l.title,
        meta: `${ago(l.at / 1000)} · ${l.detail ?? ''}`,
        badge: { tone: 'bad', text: 'Bloqueado' },
      }));
    return [...paid, ...blocked].sort((a, b) => b.at - a.at).slice(0, 10);
  }, [app.snapshot, app.log]);

  return (
    <Card id="activity" title="Actividad" subtitle="Lo que tu agente hizo con tu dinero. Los pagos se leen de la cadena.">
      {rows.length === 0 ? (
        <p className="empty">Aún no hay actividad.</p>
      ) : (
        <ul className="list">
          {rows.map((row) => (
            <li key={row.key} className={`activity activity-${row.tone}`}>
              <span className="activity-icon" aria-hidden="true">
                <Icon name={row.tone === 'ok' ? 'check' : 'shield'} size={16} />
              </span>
              <div>
                <strong>{row.title}</strong>
                <p className="muted small">{row.meta}</p>
              </div>
              {row.badge ? <Badge tone={row.badge.tone}>{row.badge.text}</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------------------------

export function Reputation({ app }: { app: App }) {
  const { reputation } = app.snapshot!;
  const has = reputation.count > 0n;
  return (
    <Card id="reputation" title="Reputación verificada" subtitle={`${SERVICE_NAME} · agente #${app.snapshot!.agent.service.agentId}`}>
      <p className="score">
        {has ? (
          <>
            {reputation.value.toString()} <span>/ 100</span>
          </>
        ) : (
          <span className="score-empty">Sin reseñas verificadas</span>
        )}
      </p>
      <p className="muted small">
        {reputation.count.toString()} {reputation.count === 1n ? 'reseña cuenta' : 'reseñas cuentan'} · {reputation.verifiedClients.toString()}{' '}
        {reputation.verifiedClients === 1n ? 'cliente le ha pagado' : 'clientes le han pagado'}
      </p>
      <p className="explain">
        Cualquiera puede escribir una reseña, incluso con cuentas falsas. Aquí solo cuentan las de quienes <strong>de verdad le pagaron</strong> al servicio.
      </p>
    </Card>
  );
}

