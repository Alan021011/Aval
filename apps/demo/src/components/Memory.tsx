import { useEffect, useState } from 'react';
import type { App } from '../state/useAval';
import type { Memory } from '../state/useMemory';
import { Badge, Button, Callout, Card, Icon, PageHead } from './ui';

const preview = (hex: string, edge = 42) => (hex === '0x' ? 'vacío' : `${hex.slice(0, edge)}… (${(hex.length - 2) / 2} bytes)`);

/** Lo que ve un juez: casilleros, versiones y los bytes cifrados tal cual están en la cadena. */
export function MemoryFacts({ memory, dark }: { memory: Memory; dark?: boolean }) {
  const box = dark ? 'bg-term-2' : 'bg-surface-low';
  const label = dark ? 'text-term-muted' : 'text-muted';
  if (!memory.open) return <p className={`text-sm ${label}`}>Abre la memoria para ver los casilleros cifrados.</p>;
  const rows = [
    ['Raíz de la memoria', `PRF con salt «aval/memory/v1» ${memory.sameCeremony ? '(misma ceremonia que la cuenta)' : '(huella aparte)'}`],
    ['Claves derivadas (HKDF)', `privada · agente v${memory.sharedVersion || 1}`],
    ['Casillero privado en MemoryVault', preview(memory.onchain.privateHex)],
    ['Casillero del agente en MemoryVault', preview(memory.onchain.sharedHex)],
  ] as const;
  return (
    <dl className="flex flex-col gap-2">
      {rows.map(([k, v]) => (
        <div key={k} className={`rounded-lg px-3 py-2 ${box}`}>
          <dt className={`text-[11px] font-medium tracking-wide uppercase ${label}`}>{k}</dt>
          <dd className={`font-mono text-[12px] break-all ${dark ? 'text-term-accent' : ''}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Memoria del agente cifrada con la passkey: una parte solo para el usuario y otra que comparte con su agente. */
export function MemoryView({ app, memory }: { app: App; memory: Memory }) {
  const locked = app.phase === 'locked';
  const busy = !!app.busy;
  const [privateDraft, setPrivateDraft] = useState('');
  const [sharedDraft, setSharedDraft] = useState('');

  // Al abrir (o al recargar desde la cadena), los borradores toman lo que se descifró.
  useEffect(() => setPrivateDraft(memory.privateText), [memory.privateText]);
  useEffect(() => setSharedDraft(memory.sharedText), [memory.sharedText]);

  const revoked = memory.agentKeyVersion !== null && memory.agentKeyVersion < memory.sharedVersion;
  const access = memory.agentKeyVersion === null ? 'none' : revoked ? 'revoked' : 'active';

  return (
    <>
      <PageHead
        eyebrow="Cifrada con tu passkey · WebAuthn PRF"
        title="Memoria de tu agente"
        subtitle="Tus preferencias, cifradas de extremo a extremo. En la cadena solo quedan bytes cifrados, y tu passkey la abre en cualquier dispositivo."
        action={memory.sharedVersion > 0 ? <Badge tone="accent" icon="share">Compartida · v{memory.sharedVersion}</Badge> : undefined}
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          {!memory.open ? (
            <Card icon="key" title="Abre tu memoria" subtitle="Tu passkey tiene una clave aparte para la memoria (otro salt, no la de tu cuenta).">
              <p className="mb-5 text-sm leading-relaxed text-ink-2">
                De ella salen una clave solo tuya y una por cada agente con el que compartes. La parte privada no la puede leer nadie más, ni el relayer. La parte compartida sí la ve tu agente (y el modelo que la usa) cuando la lee.
              </p>
              <Button variant="primary" size="lg" icon="lock_open" loading={app.busy === 'memory-open'} disabled={locked || busy} onClick={() => memory.unlock()}>
                Abrir mi memoria
              </Button>
            </Card>
          ) : (
            <>
              {memory.sameCeremony ? (
                <p className="flex items-center gap-2 rounded-2xl bg-ok-soft px-4 py-3 text-sm text-on-ok-soft">
                  <Icon name="check_circle" size={18} fill />
                  Abierta con la clave que tu passkey entregó al entrar: no hizo falta otra huella.
                </p>
              ) : null}

              <Card icon="person" title="Solo para ti" subtitle="El agente nunca recibe esta clave." action={<Badge icon="lock">Privada</Badge>}>
                <textarea
                  className="input min-h-28 resize-y"
                  value={privateDraft}
                  maxLength={1500}
                  onChange={(e) => setPrivateDraft(e.target.value)}
                  placeholder="Ej.: mi número de viajero frecuente"
                  aria-label="Memoria privada"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="flex items-center gap-1.5 text-[13px] text-muted">
                    <Icon name="lock" size={16} />
                    Cifrado con tu clave privada de memoria
                  </p>
                  <Button icon="lock" loading={app.busy === 'memory-private'} disabled={locked || busy || !privateDraft.trim()} onClick={() => memory.savePrivate(privateDraft)}>
                    Guardar cifrado
                  </Button>
                </div>
              </Card>

              <Card
                icon="smart_toy"
                title="Compartido con tu agente"
                subtitle="Se cifra con una clave solo para este agente y esta versión."
                action={
                  <Badge tone={access === 'active' ? 'ok' : access === 'revoked' ? 'bad' : 'neutral'} dot>
                    {access === 'active' ? 'Con acceso' : access === 'revoked' ? 'Acceso revocado' : 'Sin clave'}
                  </Badge>
                }
              >
                <textarea
                  className="input min-h-28 resize-y"
                  value={sharedDraft}
                  maxLength={1500}
                  onChange={(e) => setSharedDraft(e.target.value)}
                  placeholder="Ej.: prefiero traducciones en inglés formal, presupuesto máximo 80 tUSD"
                  aria-label="Memoria compartida con el agente"
                />
                <p className="mt-2 text-[13px] text-muted">
                  {access === 'none'
                    ? 'El agente todavía no tiene ninguna clave.'
                    : access === 'revoked'
                      ? `El agente tiene la clave de la versión ${memory.agentKeyVersion}, pero lo compartido ya está en la versión ${memory.sharedVersion}: su clave no lo abre.`
                      : `El agente tiene la clave de la versión ${memory.agentKeyVersion}.`}
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button variant="primary" icon="share" loading={app.busy === 'memory-share'} disabled={locked || busy || !sharedDraft.trim()} onClick={() => memory.share(sharedDraft)}>
                    {memory.agentKeyVersion === null || revoked ? 'Guardar y darle acceso' : 'Guardar y compartir'}
                  </Button>
                  <Button icon="visibility" loading={app.busy === 'memory-recall'} disabled={locked || busy} onClick={() => memory.agentRecall()}>
                    Que el agente la lea
                  </Button>
                  <Button
                    variant="danger"
                    icon="key_off"
                    loading={app.busy === 'memory-revoke'}
                    disabled={locked || busy || memory.sharedVersion === 0 || revoked}
                    onClick={() => memory.revoke()}
                    className="sm:ml-auto"
                  >
                    Revocar acceso
                  </Button>
                </div>

                {memory.agentRead ? (
                  <div className="mt-4">
                    <Callout
                      tone={memory.agentRead.ok ? 'ok' : 'bad'}
                      icon={memory.agentRead.ok ? 'visibility' : 'gpp_bad'}
                      title={memory.agentRead.ok ? `El agente leyó su parte (versión ${memory.agentRead.version})` : 'El agente no pudo leer'}
                      role="status"
                    >
                      {memory.agentRead.ok ? `«${memory.agentRead.text}»` : memory.agentRead.text}
                    </Callout>
                  </div>
                ) : null}
              </Card>
            </>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Card icon="fingerprint" title="Cómo se protege">
            <ul className="flex flex-col gap-3 text-sm text-ink-2">
              <li className="flex gap-2.5">
                <Icon name="visibility_off" size={20} className="text-primary" />
                <span>
                  <strong className="text-ink">Cifrado de extremo a extremo.</strong> En la cadena solo hay bytes cifrados (AES-GCM). Lo privado solo lo abres tú; lo compartido lo lee tu agente.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="key" size={20} className="text-primary" />
                <span>
                  <strong className="text-ink">Tu passkey tiene la llave.</strong> La extensión PRF deriva las claves al entrar, sin guardarlas en el navegador.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="sync_lock" size={20} className="text-primary" />
                <span>
                  <strong className="text-ink">Revocación hacia adelante.</strong> Al revocar sube la versión: lo que se guarde después ya no lo abre la clave vieja. Lo que el agente ya leyó, o el texto antiguo que sigue en el historial de la cadena, sigue abriéndose con esa clave.
                </span>
              </li>
            </ul>
          </Card>
          <div className="rounded-2xl bg-term p-5 text-on-term">
            <p className="mb-3 flex items-center justify-between gap-2 font-semibold">
              <span className="flex items-center gap-2">
                <Icon name="terminal" size={20} />
                En la cadena
              </span>
              <span className="rounded bg-term-2 px-2 py-0.5 font-mono text-[11px] text-term-muted">MemoryVault</span>
            </p>
            <MemoryFacts memory={memory} dark />
          </div>
        </aside>
      </div>
    </>
  );
}
