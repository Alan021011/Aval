import { useEffect, useState } from 'react';
import type { App } from '../state/useAval';
import type { Memory } from '../state/useMemory';
import { Badge, Button, Card, Field, Icon } from './ui';

/** Memoria del agente cifrada con la passkey: una parte solo para el usuario y otra que comparte con su agente. */
export function MemoryCard({ app, memory }: { app: App; memory: Memory }) {
  const locked = app.phase === 'locked';
  const busy = !!app.busy;
  const [privateDraft, setPrivateDraft] = useState('');
  const [sharedDraft, setSharedDraft] = useState('');

  // Al abrir (o al recargar desde la cadena), los borradores toman lo que se descifró.
  useEffect(() => setPrivateDraft(memory.privateText), [memory.privateText]);
  useEffect(() => setSharedDraft(memory.sharedText), [memory.sharedText]);

  const revoked = memory.agentKeyVersion !== null && memory.agentKeyVersion < memory.sharedVersion;

  return (
    <Card
      id="memory"
      title="Memoria de tu agente"
      subtitle="Cifrada con tu huella. En la cadena solo quedan bytes cifrados, y tu passkey la abre en cualquier dispositivo."
      action={memory.sharedVersion > 0 ? <Badge tone="accent">Compartida · v{memory.sharedVersion}</Badge> : undefined}
    >
      {!memory.open ? (
        <div className="memory">
          <p className="muted small">
            Tu passkey tiene una clave aparte para la memoria (otro <em>salt</em>, no la de tu cuenta). De ella salen una clave solo
            tuya y una por cada agente con el que compartes. Nadie más, ni el relayer, puede leerla.
          </p>
          <Button variant="primary" icon="unlock" loading={app.busy === 'memory-open'} disabled={locked || busy} onClick={() => memory.unlock()}>
            Abrir mi memoria
          </Button>
        </div>
      ) : (
        <div className="memory">
          {memory.sameCeremony ? (
            <p className="muted small">
              <Icon name="check" size={14} /> Abierta con la clave que tu passkey entregó al entrar: no hizo falta otra huella.
            </p>
          ) : null}

          <div className="memory-part">
            <Field label="Solo para ti" hint="El agente nunca recibe esta clave.">
              <textarea value={privateDraft} maxLength={1500} onChange={(e) => setPrivateDraft(e.target.value)} placeholder="Ej.: mi número de viajero frecuente" />
            </Field>
            <div className="memory-buttons">
              <Button icon="lock" loading={app.busy === 'memory-private'} disabled={locked || busy} onClick={() => memory.savePrivate(privateDraft)}>
                Guardar cifrado
              </Button>
            </div>
          </div>

          <div className="memory-part">
            <Field label="Compartido con tu agente" hint="Se cifra con una clave solo para este agente y esta versión.">
              <textarea value={sharedDraft} maxLength={1500} onChange={(e) => setSharedDraft(e.target.value)} placeholder="Ej.: prefiero hoteles cerca del centro, presupuesto 300 USD" />
            </Field>
            <div className="memory-buttons">
              <Button variant="primary" icon="bot" loading={app.busy === 'memory-share'} disabled={locked || busy || !sharedDraft.trim()} onClick={() => memory.share(sharedDraft)}>
                {memory.agentKeyVersion === null || revoked ? 'Guardar y darle acceso' : 'Guardar y compartir'}
              </Button>
              <Button icon="eye" loading={app.busy === 'memory-recall'} disabled={locked || busy} onClick={() => memory.agentRecall()}>
                Que el agente la lea
              </Button>
              <Button
                variant="danger"
                icon="x"
                loading={app.busy === 'memory-revoke'}
                disabled={locked || busy || memory.sharedVersion === 0 || revoked}
                onClick={() => memory.revoke()}
              >
                Revocar acceso
              </Button>
            </div>
            <p className="muted small">
              {memory.agentKeyVersion === null
                ? 'El agente todavía no tiene ninguna clave.'
                : revoked
                  ? `El agente tiene la clave de la versión ${memory.agentKeyVersion}, pero lo compartido ya está en la versión ${memory.sharedVersion}: su clave no lo abre.`
                  : `El agente tiene la clave de la versión ${memory.agentKeyVersion}.`}
            </p>
          </div>

          {memory.agentRead ? (
            <div className={`callout ${memory.agentRead.ok ? 'callout-ok' : 'callout-bad'}`} role="status">
              <Icon name={memory.agentRead.ok ? 'bot' : 'shield'} />
              <div>
                <strong>{memory.agentRead.ok ? `El agente leyó su parte (versión ${memory.agentRead.version})` : 'El agente no pudo leer'}</strong>
                <p>{memory.agentRead.ok ? `«${memory.agentRead.text}»` : memory.agentRead.text}</p>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/** Lo que ve un juez en el inspector: casilleros, versiones y los bytes cifrados tal cual están en la cadena. */
export function MemoryFacts({ memory }: { memory: Memory }) {
  const preview = (hex: string) => (hex === '0x' ? 'vacío' : `${hex.slice(0, 42)}… (${(hex.length - 2) / 2} bytes)`);
  return (
    <section>
      <h3>Memoria cifrada (Mera · varias claves)</h3>
      {memory.open ? (
        <dl className="facts facts-tight">
          <div>
            <dt>Raíz de la memoria</dt>
            <dd>PRF con salt «aval/memory/v1» {memory.sameCeremony ? '(misma ceremonia que la cuenta)' : '(huella aparte)'}</dd>
          </div>
          <div>
            <dt>Claves derivadas (HKDF)</dt>
            <dd>privada · agente v{memory.sharedVersion || 1}</dd>
          </div>
          <div>
            <dt>Casillero privado en MemoryVault</dt>
            <dd className="cipher">{preview(memory.onchain.privateHex)}</dd>
          </div>
          <div>
            <dt>Casillero del agente en MemoryVault</dt>
            <dd className="cipher">{preview(memory.onchain.sharedHex)}</dd>
          </div>
        </dl>
      ) : (
        <p className="muted small">Abre la memoria en el tablero para ver los casilleros cifrados.</p>
      )}
    </section>
  );
}
