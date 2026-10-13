import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { usd } from '../lib/format';
import { isNever } from '../state/useAval';

/** Íconos de Material Symbols (los mismos del diseño). `name` es el nombre del símbolo, p. ej. "fingerprint". */
export function Icon({ name, size = 20, fill, className = '' }: { name: string; size?: number; fill?: boolean; className?: string }) {
  return (
    <span className={`icon${fill ? ' icon-fill' : ''} ${className}`} style={{ fontSize: size, width: size, height: size }} aria-hidden="true" translate="no">
      {name}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} />;
}

const VARIANTS = {
  primary: 'bg-primary-strong text-white shadow-md shadow-primary-strong/20 hover:brightness-110',
  secondary: 'bg-surface-mid text-ink hover:bg-surface-high',
  ghost: 'text-ink-2 hover:bg-surface-low hover:text-ink',
  danger: 'bg-bad-soft text-on-bad-soft hover:brightness-95',
  dark: 'bg-term-2 text-on-term hover:brightness-125',
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  icon?: string;
  loading?: boolean;
  block?: boolean;
  size?: 'md' | 'lg';
};

export function Button({ variant = 'secondary', icon, loading, block, size = 'md', children, className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${
        size === 'lg' ? 'min-h-12 px-5 text-base' : 'min-h-10 px-4 text-sm'
      } ${VARIANTS[variant]} ${block ? 'w-full' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={size === 'lg' ? 22 : 18} /> : null}
      <span>{children}</span>
    </button>
  );
}

/** Enlace con apariencia de botón (para navegar entre vistas). */
export function LinkButton({ href, variant = 'secondary', icon, children, className = '' }: { href: string; variant?: keyof typeof VARIANTS; icon?: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${VARIANTS[variant]} ${className}`}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
    </a>
  );
}

export function Card({
  title,
  subtitle,
  icon,
  action,
  children,
  className = '',
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`card ${className}`} id={id} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {title || action ? (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? (
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-mid text-primary">
                <Icon name={icon} />
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? (
                <h2 className="text-lg leading-6 font-semibold text-ink" id={id ? `${id}-title` : undefined}>
                  {title}
                </h2>
              ) : null}
              {subtitle ? <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const TONES = {
  neutral: 'bg-surface-mid text-ink-2',
  ok: 'bg-ok-soft text-on-ok-soft',
  warn: 'bg-warn-soft text-on-warn-soft',
  bad: 'bg-bad-soft text-on-bad-soft',
  accent: 'bg-primary-soft text-on-primary-soft',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', icon, dot, children, className = '' }: { tone?: Tone; icon?: string; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] leading-5 font-medium whitespace-nowrap ${TONES[tone]} ${className}`}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

const CALLOUT = {
  ok: { box: 'bg-ok-soft text-on-ok-soft', icon: 'check_circle' },
  warn: { box: 'bg-warn-soft text-on-warn-soft', icon: 'notifications_active' },
  bad: { box: 'bg-bad-soft text-on-bad-soft', icon: 'gpp_bad' },
  accent: { box: 'bg-primary-soft text-on-primary-soft', icon: 'info' },
  neutral: { box: 'bg-surface-low text-ink-2', icon: 'info' },
} as const;

export function Callout({ tone, icon, title, children, action, role }: { tone: Tone; icon?: string; title: ReactNode; children?: ReactNode; action?: ReactNode; role?: 'status' | 'alert' }) {
  const look = CALLOUT[tone];
  return (
    <div className={`rise flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center ${look.box}`} role={role}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon name={icon ?? look.icon} size={22} fill className="mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          {children ? <div className="mt-0.5 text-sm opacity-90">{children}</div> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? (
        <span className="text-[13px] text-bad" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="text-[13px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/** Barra de progreso. `parts` permite mostrar dos tramos (p. ej., gastado y en espera de aprobación). */
export function Meter({ parts, label }: { parts: { value: number; className: string }[]; label: string }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-high" role="img" aria-label={label}>
      {parts.map((p, i) => (
        <div key={i} className={`h-full transition-[width] duration-500 ${p.className}`} style={{ width: `${Math.max(0, Math.min(100, p.value))}%` }} />
      ))}
    </div>
  );
}

/**
 * Las tres zonas de un permiso: se paga solo, espera tu huella y el contrato lo bloquea. Las proporciones se dibujan
 * sobre una escala hasta un poco más que el máximo por pago, para que la zona roja siempre se vea.
 */
export function ZoneBar({ threshold, maxPerSpend, marker }: { threshold: bigint; maxPerSpend: bigint; marker?: bigint }) {
  const never = isNever(threshold) || threshold >= maxPerSpend;
  const scale = Number(maxPerSpend) * 1.3 || 1;
  const greenEnd = never ? Number(maxPerSpend) / scale : Number(threshold) / scale;
  const amberEnd = Number(maxPerSpend) / scale;
  const zones = [
    { tone: 'text-ok', bar: 'bg-ok', title: 'Se paga solo', range: never ? `hasta ${usd(maxPerSpend)} tUSD` : `hasta ${usd(threshold)} tUSD`, text: 'Sin molestarte.' },
    ...(never ? [] : [{ tone: 'text-warn', bar: 'bg-[#f5a524]', title: 'Espera tu huella', range: `${usd(threshold)} – ${usd(maxPerSpend)} tUSD`, text: 'Te pide aprobación.' }]),
    { tone: 'text-bad', bar: 'bg-bad', title: 'Bloqueado', range: `más de ${usd(maxPerSpend)} tUSD`, text: 'El contrato lo rechaza.' },
  ];
  const widths = never ? [amberEnd, 1 - amberEnd] : [greenEnd, amberEnd - greenEnd, 1 - amberEnd];
  const markerAt = marker !== undefined ? Math.min(0.99, Number(marker) / scale) : null;

  return (
    <div className="rounded-2xl bg-surface-low p-4">
      <div className="relative pt-1">
        <div className="flex h-2.5 gap-1" aria-hidden="true">
          {zones.map((z, i) => (
            <div key={z.title} className={`h-full rounded-full ${z.bar}`} style={{ width: `${widths[i]! * 100}%` }} />
          ))}
        </div>
        {markerAt !== null ? (
          <div className="absolute -top-1 h-5 w-0.5 rounded bg-ink" style={{ left: `${markerAt * 100}%` }} aria-hidden="true" />
        ) : null}
      </div>
      <ul className={`mt-3 grid gap-2 ${never ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
        {zones.map((z) => (
          <li key={z.title} className="rounded-xl bg-surface p-3 ring-1 ring-line/60">
            <p className={`flex items-center gap-1.5 text-[13px] font-semibold ${z.tone}`}>
              <span className="size-2 rounded-full bg-current" aria-hidden="true" />
              {z.title}
            </p>
            <p className="mt-0.5 font-mono text-[13px] text-ink">{z.range}</p>
            <p className="text-[12px] text-muted">{z.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Un dato grande con su etiqueta (las tarjetas de métricas del diseño). */
export function Stat({ label, value, unit, note, icon }: { label: string; value: ReactNode; unit?: string; note?: ReactNode; icon?: string }) {
  return (
    <div className="card flex flex-col gap-1 !p-4 md:!p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink-2">{label}</p>
        {icon ? <Icon name={icon} size={20} className="text-primary" /> : null}
      </div>
      <p className="text-3xl leading-tight font-bold tracking-tight text-ink">
        {value}
        {unit ? <span className="ml-1 text-base font-semibold text-primary">{unit}</span> : null}
      </p>
      {note ? <p className="font-mono text-[12px] text-muted">{note}</p> : null}
    </div>
  );
}

/** Título de cada vista. */
export function PageHead({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? <p className="mb-2 font-mono text-[12px] font-medium tracking-wide text-primary uppercase">{eyebrow}</p> : null}
        <h1 className="text-2xl leading-8 font-bold tracking-tight text-ink md:text-3xl md:leading-10">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-ink-2">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Empty({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
      <Icon name={icon} size={28} />
      <p className="max-w-sm">{children}</p>
    </div>
  );
}
