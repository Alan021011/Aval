import { isMeraError } from '@category-labs/mera';
import {
  type Aval,
  AvalError,
  type DemoAgentInfo,
  type PasskeyPublicKey,
  type Permit,
  type Receipt,
  type SpendRequest,
  type VerifiedSummary,
  createAval,
  createRelayerClient,
} from '@aval/sdk';
import { useCallback, useMemo, useRef, useState } from 'react';
import { type Address, type Hash, createWalletClient } from 'viem';
import { RELAYER_URL, SESSION_MINUTES, USD, monad, publicClient, transport } from '../lib/config';
import { usd } from '../lib/format';
import { type Backend, forgetSimulatedAccount, realBackend, simulatedBackend } from '../lib/passkey';
import { type Session, createAccount, signIn } from '../lib/session';

export type Phase = 'out' | 'working' | 'in' | 'locked';
export type StepState = 'pending' | 'doing' | 'done' | 'error' | 'skipped';
export type Step = { id: string; label: string; state: StepState };

export type PermitView = { permitId: bigint; permit: Permit };
export type RequestView = { requestId: bigint; request: SpendRequest };

/** Todo lo que la app muestra del usuario, leído desde la cadena. Nada de esto se guarda en el navegador. */
export type Snapshot = {
  balance: bigint;
  permits: PermitView[];
  requests: RequestView[];
  receipts: Receipt[];
  reputation: VerifiedSummary;
  agent: DemoAgentInfo;
  p256: PasskeyPublicKey | null;
  at: number;
};

export type LogEntry = {
  id: number;
  at: number;
  kind: 'tx' | 'blocked' | 'info';
  title: string;
  detail?: string;
  code?: string;
  hash?: Hash;
  ms?: number;
};

export type Notice = { id: number; kind: 'ok' | 'error' | 'info'; text: string };

export type Metrics = {
  /** Del toque en "Empezar" hasta la primera transacción confirmada, en ms. */
  firstTxMs: number | null;
  /** Del toque en "Empezar" hasta tener la cuenta lista, en ms. */
  readyMs: number | null;
  /** Cuántas veces se pidió la huella hasta tener la cuenta lista (no cambia con lo que el usuario haga después). */
  readyPrompts: number | null;
};

export type PermitForm = { perSpend: bigint; total: bigint; threshold: bigint; hours: number };

const NEVER = (1n << 128n) - 1n;
const ONBOARDING: Step[] = [
  { id: 'account', label: 'Crear tu cuenta con tu huella', state: 'pending' },
  { id: 'funds', label: 'Recibir saldo de prueba', state: 'pending' },
  { id: 'key', label: 'Registrar tu huella para aprobar pagos', state: 'pending' },
];

/** Códigos de rechazo del contrato que la demo muestra como "bloqueado por tus límites" (no como un error). */
const BLOCKED = new Set([
  'ExceedsPerSpendLimit',
  'ExceedsTotalLimit',
  'NeedsApproval',
  'RecipientNotAllowed',
  'PermitInactive',
]);

export const isNever = (threshold: bigint) => threshold >= NEVER;
export const isActive = (permit: Permit, now = Date.now()) =>
  !permit.revoked && permit.terms.expiresAt > BigInt(Math.floor(now / 1000)) && permit.spent < permit.terms.maxTotal;

/** Montos de las acciones de ejemplo del agente, calculados a partir de los límites del permiso. */
export function scenarios(permit: Permit) {
  const { maxPerSpend, approvalThreshold } = permit.terms;
  const whole = (x: bigint) => (x / USD > 0n ? (x / USD) * USD : x);
  const small = whole(isNever(approvalThreshold) ? maxPerSpend / 2n : approvalThreshold / 2n);
  const over = whole(maxPerSpend + 50n * USD);
  // El pago grande debe superar el umbral (el contrato solo pide aprobación para montos MAYORES) sin pasar el máximo.
  // Si al redondear el punto medio no lo supera, se usa el máximo, que siempre es mayor que el umbral aquí.
  let big: bigint | null = null;
  if (!isNever(approvalThreshold) && approvalThreshold < maxPerSpend) {
    const middle = whole((approvalThreshold + maxPerSpend) / 2n);
    big = middle > approvalThreshold ? middle : maxPerSpend;
  }
  return { small, over, big };
}

const money = (value: unknown) => (typeof value === 'bigint' ? `${usd(value)} tUSD` : String(value));

/** Explica en lenguaje de usuario por qué el contrato bloqueó al agente, con los montos en tUSD (no en unidades crudas). */
export function blockedMessage(error: AvalError): string {
  const [a, b] = error.args;
  switch (error.code) {
    case 'ExceedsPerSpendLimit':
      return `El pago de ${money(a)} supera tu máximo por pago (${money(b)}).`;
    case 'ExceedsTotalLimit':
      return `El pago de ${money(a)} supera lo que queda de tu permiso (${money(b)}).`;
    case 'NeedsApproval':
      return `Un pago de ${money(a)} supera tu umbral de ${money(b)}: el agente tiene que pedirte aprobación.`;
    case 'RecipientNotAllowed':
      return 'Ese destinatario no está en la lista de tu permiso.';
    case 'PermitInactive':
      return 'Tu permiso está revocado, vencido o ya se gastó.';
    default:
      return error.message;
  }
}

export function friendlyError(error: unknown): string {
  if (isMeraError(error) && error.code === 'PRF_UNAVAILABLE') {
    return 'Tu dispositivo o navegador no entrega la clave de la passkey (PRF). Prueba con Chrome y las contraseñas de Google, iCloud Keychain o 1Password, o usa el modo de prueba.';
  }
  if (error instanceof AvalError) return error.message;
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
    return 'Se canceló la verificación con tu huella.';
  }
  if (error instanceof Error) return error.message;
  return 'Algo salió mal. Inténtalo de nuevo.';
}

export function useAval() {
  const relayer = useMemo(() => createRelayerClient({ url: RELAYER_URL }), []);
  const reader = useMemo(() => createAval({ publicClient }), []);

  const [phase, setPhase] = useState<Phase>('out');
  const [mode, setMode] = useState<Backend['mode']>('real');
  const [steps, setSteps] = useState<Step[]>(ONBOARDING);
  const [address, setAddress] = useState<Address | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lockAt, setLockAt] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<Metrics>({ firstTxMs: null, readyMs: null, readyPrompts: null });
  const [prompts, setPrompts] = useState(0);
  const [needsFallback, setNeedsFallback] = useState(false);
  const [lastResult, setLastResult] = useState<{ kind: 'ok' | 'blocked'; text: string } | null>(null);

  const backend = useRef<Backend | null>(null);
  const session = useRef<Session | null>(null);
  const aval = useRef<Aval | null>(null);
  const pendingKey = useRef<PasskeyPublicKey | null>(null);
  const startedAt = useRef(0);
  const ids = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ---------------------------------------------------------------- utilidades

  const notify = useCallback((kind: Notice['kind'], text: string) => {
    clearTimeout(noticeTimer.current);
    setNotice({ id: ++ids.current, kind, text });
    noticeTimer.current = setTimeout(() => setNotice(null), kind === 'error' ? 9000 : 5000);
  }, []);

  const addLog = useCallback((entry: Omit<LogEntry, 'id' | 'at'>) => {
    setLog((old) => [{ ...entry, id: ++ids.current, at: Date.now() }, ...old].slice(0, 200));
  }, []);

  const syncPrompts = () => setPrompts(backend.current?.prompts() ?? 0);

  /** Cada acción del usuario renueva el plazo de la sesión. */
  const touch = useCallback(() => setLockAt(Date.now() + SESSION_MINUTES * 60_000), []);

  /** Ejecuta una llamada al relayer o al agente, la registra con su tiempo y devuelve su resultado. */
  const timed = useCallback(
    async <T extends { hash?: Hash }>(title: string, fn: () => Promise<T>): Promise<T> => {
      const t0 = performance.now();
      const result = await fn();
      const ms = performance.now() - t0;
      addLog({ kind: 'tx', title, hash: result.hash, ms });
      setMetrics((m) => (m.firstTxMs === null && startedAt.current ? { ...m, firstTxMs: performance.now() - startedAt.current } : m));
      return result;
    },
    [addLog],
  );

  const load = useCallback(
    async (owner: Address): Promise<Snapshot> => {
      const agent = await relayer.agent.info();
      const [balance, permits, requests, receipts, reputation, p256] = await Promise.all([
        reader.tokens.balanceOf(owner),
        reader.permits.listByOwner(owner),
        reader.permits.requestsOf(owner),
        reader.permits.receiptsOf(owner),
        reader.reputation.summary(agent.service.agentId, { tag1: 'calidad' }),
        reader.passkeys.keyOf(owner),
      ]);
      return { balance, permits, requests, receipts, reputation, agent, p256, at: Date.now() };
    },
    [reader, relayer],
  );

  const refresh = useCallback(async () => {
    const owner = session.current?.address ?? address;
    if (!owner) return;
    setSnapshot(await load(owner));
  }, [address, load]);

  const ensureAval = (): Aval => {
    if (!aval.current || !session.current) throw new Error('La sesión está bloqueada. Usa tu huella para continuar.');
    return aval.current;
  };

  function bindSession(next: Session, current: Backend) {
    session.current?.end();
    session.current = next;
    backend.current = current;
    aval.current = createAval({
      publicClient,
      walletClient: createWalletClient({ account: next.account, chain: monad, transport }),
      assertionProvider: current.assertionProvider,
    });
    setAddress(next.address);
    touch();
  }

  const mark = (id: string, state: StepState) => setSteps((old) => old.map((s) => (s.id === id ? { ...s, state } : s)));

  // ---------------------------------------------------------------- empezar y entrar

  /** Pasos que se pueden repetir sin riesgo: cada uno comprueba primero si ya está hecho. */
  const prepare = useCallback(async () => {
    const a = ensureAval();
    const owner = session.current!.address;

    mark('funds', 'doing');
    if ((await reader.tokens.balanceOf(owner)) === 0n) {
      try {
        await timed('Saldo de prueba (faucet)', () => relayer.faucet(owner));
        mark('funds', 'done');
      } catch (e) {
        // El faucet limita por IP: si ya se usó desde esta red, se sigue y se avisa.
        if (e instanceof AvalError && e.code === 'RateLimited') {
          mark('funds', 'skipped');
          notify('info', 'El faucet ya entregó saldo desde esta red hace poco. Puedes pedirlo de nuevo más tarde.');
        } else {
          mark('funds', 'error');
          throw e;
        }
      }
    } else {
      mark('funds', 'done');
    }

    mark('key', 'doing');
    if (!(await reader.passkeys.has(owner))) {
      const key = pendingKey.current;
      if (!key) throw new Error('Esta cuenta no terminó de registrar su huella. Crea una cuenta nueva.');
      await timed('Registrar clave de la huella (P256)', async () => relayer.register(await a.passkeys.signRegister(key)));
    }
    mark('key', 'done');
  }, [notify, reader, relayer, timed]);

  const start = useCallback(
    async (kind: Backend['mode']) => {
      if (busy) return;
      setBusy('start');
      setNeedsFallback(false);
      setLastResult(null);
      setSteps(ONBOARDING.map((s) => ({ ...s })));
      setMode(kind);
      setPhase('working');
      startedAt.current = performance.now();
      setMetrics({ firstTxMs: null, readyMs: null, readyPrompts: null });
      const current = kind === 'real' ? realBackend() : simulatedBackend();
      try {
        mark('account', 'doing');
        const { session: created, publicKey } = await createAccount(current, `aval-${Date.now().toString(36)}`);
        pendingKey.current = publicKey;
        bindSession(created, current);
        syncPrompts();
        mark('account', 'done');
        await prepare();
        await refresh();
        setMetrics((m) => ({ ...m, readyMs: performance.now() - startedAt.current, readyPrompts: backend.current?.prompts() ?? null }));
        setPhase('in');
      } catch (e) {
        if (isMeraError(e) && e.code === 'PRF_UNAVAILABLE') setNeedsFallback(true);
        setSteps((old) => old.map((s) => (s.state === 'doing' ? { ...s, state: 'error' } : s)));
        notify('error', friendlyError(e));
        if (!session.current) setPhase('out');
      } finally {
        setBusy(null);
        syncPrompts();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, notify, prepare, refresh],
  );

  /** Reintenta los pasos de preparación que fallaron, sin volver a crear la cuenta. */
  const retry = useCallback(async () => {
    if (busy || !session.current) return;
    setBusy('retry');
    try {
      await prepare();
      await refresh();
      setMetrics((m) => ({ ...m, readyMs: performance.now() - startedAt.current, readyPrompts: backend.current?.prompts() ?? null }));
      setPhase('in');
    } catch (e) {
      setSteps((old) => old.map((s) => (s.state === 'doing' ? { ...s, state: 'error' } : s)));
      notify('error', friendlyError(e));
    } finally {
      setBusy(null);
    }
  }, [busy, notify, prepare, refresh]);

  const enter = useCallback(
    async (kind: Backend['mode']) => {
      if (busy) return;
      setBusy('enter');
      setNeedsFallback(false);
      setMode(kind);
      startedAt.current = performance.now();
      const current = backend.current?.mode === kind ? backend.current : kind === 'real' ? realBackend() : simulatedBackend();
      // Al desbloquear se reutiliza la misma passkey: se cuentan solo las verificaciones de esta entrada.
      const promptsBefore = current.prompts();
      try {
        const opened = await signIn(current);
        const changed = session.current && session.current.address !== opened.address;
        bindSession(opened, current);
        if (changed) setSnapshot(null);
        setSnapshot(await load(opened.address));
        setMetrics((m) => ({ ...m, readyMs: performance.now() - startedAt.current, readyPrompts: current.prompts() - promptsBefore }));
        setLastResult(null);
        setPhase('in');
        addLog({ kind: 'info', title: 'Sesión abierta con la huella: estado reconstruido desde la cadena' });
      } catch (e) {
        if (isMeraError(e) && e.code === 'PRF_UNAVAILABLE') setNeedsFallback(true);
        notify('error', friendlyError(e));
      } finally {
        setBusy(null);
        setPrompts(current.prompts());
      }
    },
    [addLog, busy, load, notify],
  );

  /** Bloquea la sesión: la clave sale de la memoria y hay que volver a usar la huella. */
  const lock = useCallback(
    (reason?: string) => {
      session.current?.end();
      session.current = null;
      aval.current = null;
      setLockAt(null);
      setPhase((p) => (p === 'in' ? 'locked' : p));
      if (reason) notify('info', reason);
      addLog({ kind: 'info', title: reason ?? 'Sesión bloqueada' });
    },
    [addLog, notify],
  );

  /**
   * Simula abrir la app en un dispositivo nuevo: borra todo lo que hay en memoria y en el navegador y deja la pantalla
   * de inicio. Al volver a entrar con la huella, todo reaparece porque solo vive en la cadena.
   */
  const forget = useCallback(() => {
    session.current?.end();
    session.current = null;
    aval.current = null;
    backend.current = null;
    pendingKey.current = null;
    forgetSimulatedAccount();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // sin almacenamiento disponible
    }
    setSnapshot(null);
    setAddress(null);
    setLog([]);
    setLastResult(null);
    setLockAt(null);
    setMetrics({ firstTxMs: null, readyMs: null, readyPrompts: null });
    setPhase('out');
    notify('info', 'Datos locales borrados. Entra con tu huella: todo se reconstruye desde la cadena.');
  }, [notify]);

  // ---------------------------------------------------------------- acciones del usuario

  /** Envuelve una acción: evita dobles toques, renueva la sesión y traduce los errores. */
  const act = useCallback(
    async (name: string, fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(name);
      try {
        ensureAval();
        await fn();
        touch();
      } catch (e) {
        notify('error', friendlyError(e));
      } finally {
        setBusy(null);
        syncPrompts();
      }
    },
    [busy, notify, touch],
  );

  const currentPermit = useMemo(() => {
    if (!snapshot) return null;
    const mine = snapshot.permits.filter((p) => p.permit.terms.agent.toLowerCase() === snapshot.agent.address.toLowerCase());
    return [...mine].reverse().find((p) => isActive(p.permit)) ?? null;
  }, [snapshot]);

  const pending = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.requests
      .filter((r) => r.request.status === 1)
      .filter((r) => snapshot.permits.some((p) => p.permitId === r.request.permitId && isActive(p.permit)))
      .reverse();
  }, [snapshot]);

  const createPermit = useCallback(
    (form: PermitForm) =>
      act('permit', async () => {
        const a = ensureAval();
        const agent = snapshot!.agent;
        // El usuario firma sin ventanas (la sesión ya está abierta) y el relayer envía.
        await timed('Autorizar el gasto del token', async () => relayer.tokenPermit(await a.tokens.signPermit({ value: form.total })));
        const { permitId } = await timed('Crear permiso para el agente', async () =>
          relayer.grant(
            await a.permits.signGrant({
              agent: agent.address,
              maxPerSpend: form.perSpend,
              maxTotal: form.total,
              approvalThreshold: form.threshold >= form.perSpend ? null : form.threshold,
              expiresIn: form.hours * 3600,
              recipients: [agent.service.address],
            }),
          ),
        );
        await refresh();
        setLastResult(null);
        notify('ok', `Permiso #${permitId} creado. Tu agente ya puede actuar dentro de esos límites.`);
      }),
    [act, notify, refresh, relayer, snapshot, timed],
  );

  const revokePermit = useCallback(
    (permitId: bigint) =>
      act('revoke', async () => {
        const a = ensureAval();
        await timed('Revocar permiso', async () => relayer.revoke(await a.permits.signRevoke(permitId)));
        await refresh();
        notify('ok', 'Permiso revocado. El agente ya no puede gastar.');
      }),
    [act, notify, refresh, relayer, timed],
  );

  const topUp = useCallback(
    () =>
      act('faucet', async () => {
        await timed('Saldo de prueba (faucet)', () => relayer.faucet(session.current!.address));
        await refresh();
        notify('ok', 'Recibiste saldo de prueba.');
      }),
    [act, notify, refresh, relayer, timed],
  );

  /** Aprobar con la huella: aquí sí aparece la ventana de la passkey, a propósito. */
  const approve = useCallback(
    (requestId: bigint) =>
      act(`approve-${requestId}`, async () => {
        const a = ensureAval();
        const auth = await a.permits.signApproval(requestId, { credentialId: session.current!.credentialId });
        await timed('Aprobar pago con la huella', () => relayer.approve(requestId, auth));
        await refresh();
        setLastResult({ kind: 'ok', text: 'Aprobaste el pago con tu huella y se ejecutó.' });
        notify('ok', 'Pago aprobado y ejecutado.');
      }),
    [act, notify, refresh, relayer, timed],
  );

  // ---------------------------------------------------------------- acciones del agente

  /** Una acción del agente: si el contrato la rechaza por los límites, se muestra como un bloqueo, no como un error. */
  const agentAction = useCallback(
    (name: string, title: string, fn: () => Promise<{ hash?: Hash }>, okText: string) =>
      act(name, async () => {
        const t0 = performance.now();
        try {
          const result = await timed(title, fn);
          await refresh();
          setLastResult({ kind: 'ok', text: okText });
          void result;
        } catch (e) {
          if (e instanceof AvalError && BLOCKED.has(e.code)) {
            const text = blockedMessage(e);
            addLog({ kind: 'blocked', title, detail: text, code: e.code, ms: performance.now() - t0 });
            setLastResult({ kind: 'blocked', text });
            await refresh();
          } else {
            throw e;
          }
        }
      }),
    [act, addLog, refresh, timed],
  );

  const agentSpend = useCallback(
    (amount: bigint, label: string) => {
      const permit = currentPermit;
      if (!permit) return Promise.resolve();
      return agentAction(
        `spend-${amount}`,
        `El agente intentó pagar (${label})`,
        () => relayer.agent.spend({ permitId: permit.permitId, amount, ref: 'traduccion' }),
        'El agente pagó dentro de tus límites.',
      );
    },
    [agentAction, currentPermit, relayer],
  );

  const agentRequest = useCallback(
    (amount: bigint) => {
      const permit = currentPermit;
      if (!permit) return Promise.resolve();
      return agentAction(
        `request-${amount}`,
        'El agente pide aprobación para un pago grande',
        () => relayer.agent.request({ permitId: permit.permitId, amount, ref: 'traduccion-grande' }),
        'El agente pidió tu aprobación. Aparece abajo, en "Aprobaciones".',
      );
    },
    [agentAction, currentPermit, relayer],
  );

  const agentReview = useCallback(
    (value: number) =>
      agentAction(
        `review-${value}`,
        `El agente reseña al servicio (${value}/100)`,
        () => relayer.agent.review({ value, tag: 'calidad' }),
        'El agente dejó su reseña. Cuenta porque ya le pagó al servicio.',
      ),
    [agentAction, relayer],
  );

  return {
    // estado
    phase,
    mode,
    steps,
    address,
    snapshot,
    log,
    notice,
    busy,
    lockAt,
    metrics,
    prompts,
    needsFallback,
    lastResult,
    currentPermit,
    pending,
    // derivados
    credentialId: session.current?.credentialId ?? null,
    // acciones
    start,
    retry,
    enter,
    lock,
    forget,
    refresh: () => act('refresh', refresh),
    createPermit,
    revokePermit,
    topUp,
    approve,
    agentSpend,
    agentRequest,
    agentReview,
    dismissNotice: () => setNotice(null),
  };
}

export type App = ReturnType<typeof useAval>;
