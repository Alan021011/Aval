import {
  AvalError,
  agentMemorySlot,
  deriveMemoryKeys,
  fromBase64Url,
  openMemory,
  privateMemorySlot,
  sealMemory,
  sealedVersion,
  type MemoryKeys,
} from '@aval/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Address, type Hex, bytesToHex } from 'viem';
import type { App } from './useAval';

/** Lo que el agente pudo (o no) leer la última vez que se le pidió. */
export type AgentRead = { ok: true; text: string; version: number } | { ok: false; text: string };

export type MemoryState = {
  /** ¿Está abierta la memoria (la raíz de la passkey está en memoria)? */
  open: boolean;
  /** ¿La raíz salió de la misma ceremonia que la cuenta (sin otra huella)? */
  sameCeremony: boolean | null;
  privateText: string;
  sharedText: string;
  /** Versión actual de la parte compartida con el agente (0 = nunca compartida). Sube con cada revocación. */
  sharedVersion: number;
  /** Versión de la clave que el agente tiene ahora (null = no tiene ninguna). */
  agentKeyVersion: number | null;
  agentRead: AgentRead | null;
  /** Lo que guarda la cadena, tal cual: bytes cifrados (para el inspector). */
  onchain: { privateHex: Hex; sharedHex: Hex };
};

const EMPTY: MemoryState = {
  open: false,
  sameCeremony: null,
  privateText: '',
  sharedText: '',
  sharedVersion: 0,
  agentKeyVersion: null,
  agentRead: null,
  onchain: { privateHex: '0x', sharedHex: '0x' },
};

/**
 * Memoria del agente cifrada con la passkey. La raíz (segundo secreto PRF, salt `aval/memory/v1`) da una clave privada
 * y una clave por agente y versión. Lo cifrado se guarda en MemoryVault, en la cadena; el usuario firma y el relayer
 * paga el gas. Compartir = darle al agente la clave de la versión actual; revocar = volver a cifrar con la siguiente.
 */
export function useMemory(app: App) {
  const { bridge } = app;
  const [state, setState] = useState<MemoryState>(EMPTY);
  const keys = useRef<MemoryKeys | null>(null);
  // La clave que el usuario le dio al agente. Se guarda aquí solo para mostrar que, tras revocar, deja de servir.
  const givenKey = useRef<Hex | null>(null);
  const agentAddress = app.snapshot?.agent.address as Address | undefined;

  // Al bloquear la sesión, cambiar de cuenta o simular un dispositivo nuevo, la memoria se cierra.
  useEffect(() => {
    if (app.phase !== 'in') {
      keys.current = null;
      givenKey.current = null;
      setState(EMPTY);
    }
  }, [app.phase, app.address]);

  /** Lee de la cadena y descifra lo que corresponde con las claves de esta passkey. */
  const reload = useCallback(
    async (k: MemoryKeys, owner: Address, agent: Address) => {
      const [privateHex, sharedHex] = await Promise.all([
        bridge.reader.memory.read(owner, privateMemorySlot),
        bridge.reader.memory.read(owner, agentMemorySlot(agent)),
      ]);
      const privateText = privateHex === '0x' ? '' : await openMemory(await k.privateKey(), privateHex);
      let sharedText = '';
      let sharedVersion = 0;
      if (sharedHex !== '0x') {
        sharedVersion = sealedVersion(sharedHex);
        sharedText = await openMemory(await k.agentKey(agent, sharedVersion), sharedHex);
      }
      setState((s) => ({ ...s, privateText, sharedText, sharedVersion, onchain: { privateHex, sharedHex } }));
    },
    [bridge.reader],
  );

  const unlock = useCallback(
    () =>
      bridge.act('memory-open', async () => {
        const backend = bridge.backend();
        const owner = app.address;
        if (!backend || !owner || !agentAddress) throw new Error('Abre la sesión con tu huella primero.');
        const captured = backend.memoryRoot();
        const credentialId = bridge.credentialId();
        const root = captured ?? (await backend.unlockMemory(credentialId ? fromBase64Url(credentialId) : undefined));
        keys.current = deriveMemoryKeys(root);
        setState((s) => ({ ...s, open: true, sameCeremony: captured !== null }));
        await reload(keys.current, owner, agentAddress);
        bridge.addLog({
          kind: 'info',
          title: captured
            ? 'Memoria abierta con la clave que dio tu passkey al entrar (sin otra huella)'
            : 'Memoria abierta con tu huella (salt propio de la memoria)',
        });
      }),
    [agentAddress, app.address, bridge, reload],
  );

  /** Cifra en el dispositivo, firma sin ventanas y el relayer lo guarda en MemoryVault. */
  const store = useCallback(
    async (slot: Hex, sealed: Hex, title: string) => {
      const signed = await bridge.aval().memory.signStore(slot, sealed);
      await bridge.timed(title, () => bridge.relayer.storeMemory(signed));
    },
    [bridge],
  );

  const savePrivate = useCallback(
    (text: string) =>
      bridge.act('memory-private', async () => {
        const k = keys.current;
        if (!k || !app.address || !agentAddress) throw new Error('Abre la memoria primero.');
        await store(privateMemorySlot, await sealMemory(await k.privateKey(), 0, text), 'Memoria privada cifrada y guardada');
        await reload(k, app.address, agentAddress);
        bridge.notify('ok', 'Guardado. En la cadena solo quedan bytes cifrados.');
      }),
    [agentAddress, app.address, bridge, reload, store],
  );

  /** Guarda la parte compartida con la versión actual y le da al agente la clave de esa versión. */
  const share = useCallback(
    (text: string) =>
      bridge.act('memory-share', async () => {
        const k = keys.current;
        if (!k || !app.address || !agentAddress) throw new Error('Abre la memoria primero.');
        const version = Math.max(state.sharedVersion, 1);
        const key = await k.agentKey(agentAddress, version);
        await store(agentMemorySlot(agentAddress), await sealMemory(key, version, text), `Memoria compartida con el agente (versión ${version})`);
        givenKey.current = bytesToHex(key);
        setState((s) => ({ ...s, agentKeyVersion: version, agentRead: null }));
        await reload(k, app.address, agentAddress);
        bridge.notify('ok', `Le diste al agente la clave de la versión ${version}. Solo abre esta parte de tu memoria.`);
      }),
    [agentAddress, app.address, bridge, reload, state.sharedVersion, store],
  );

  /** Revoca: vuelve a cifrar la parte compartida con la versión siguiente. La clave del agente deja de servir. */
  const revoke = useCallback(
    () =>
      bridge.act('memory-revoke', async () => {
        const k = keys.current;
        if (!k || !app.address || !agentAddress) throw new Error('Abre la memoria primero.');
        const next = state.sharedVersion + 1;
        const key = await k.agentKey(agentAddress, next);
        await store(agentMemorySlot(agentAddress), await sealMemory(key, next, state.sharedText), `Acceso del agente revocado (versión ${next})`);
        setState((s) => ({ ...s, agentRead: null }));
        await reload(k, app.address, agentAddress);
        bridge.notify('ok', `Revocado. Lo compartido ahora usa la versión ${next}: la clave del agente ya no lo abre.`);
      }),
    [agentAddress, app.address, bridge, reload, state.sharedText, state.sharedVersion, store],
  );

  /** El agente intenta leer su parte con la clave que tiene. */
  const agentRecall = useCallback(
    () =>
      bridge.act('memory-recall', async () => {
        const owner = app.address;
        if (!owner) throw new Error('Abre la sesión primero.');
        if (!givenKey.current) {
          setState((s) => ({ ...s, agentRead: { ok: false, text: 'El agente todavía no tiene ninguna clave: comparte algo primero.' } }));
          return;
        }
        try {
          const read = await bridge.relayer.agent.recall({ owner, key: givenKey.current });
          setState((s) => ({ ...s, agentRead: { ok: true, text: read.text, version: read.version } }));
          bridge.addLog({ kind: 'info', title: `El agente leyó la memoria compartida (versión ${read.version})` });
        } catch (e) {
          if (e instanceof AvalError && (e.code === 'MemoryAccessRevoked' || e.code === 'NoSharedMemory')) {
            setState((s) => ({ ...s, agentRead: { ok: false, text: e.message } }));
            bridge.addLog({ kind: 'blocked', title: 'El agente intentó leer la memoria', detail: e.message, code: e.code });
          } else {
            throw e;
          }
        }
      }),
    [app.address, bridge],
  );

  return { ...state, agentAddress, unlock, savePrivate, share, revoke, agentRecall };
}

export type Memory = ReturnType<typeof useMemory>;
