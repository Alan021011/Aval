import { isMeraError } from '@category-labs/mera';
import { useState } from 'react';
import { type Hex, sha256, toBytes } from 'viem';
import { type Cuenta, crearCuenta, entrar } from './lib/cuenta';
import { type Aprobacion, firmarAprobacion, revisarAprobacion, verificarEnMonad } from './lib/p256';

type Resultado = {
  accion: string;
  aprobacion: Aprobacion;
  revision: ReturnType<typeof revisarAprobacion>;
  valida: boolean;
  alterada: boolean;
};

const corto = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

function mensajeDeError(e: unknown) {
  if (isMeraError(e) && e.code === 'PRF_UNAVAILABLE') {
    return 'Tu passkey no soporta PRF. En Chrome de escritorio usa el gestor de Google; también sirven iCloud Keychain o 1Password.';
  }
  return e instanceof Error ? e.message : 'Algo falló. Inténtalo de nuevo.';
}

export default function App() {
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [segundos, setSegundos] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const conEspera = async (tarea: () => Promise<void>) => {
    setError('');
    setOcupado(true);
    try {
      await tarea();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setOcupado(false);
    }
  };

  const adoptar = (c: Cuenta, t0: number) => {
    cuenta?.sesion.end();
    setCuenta(c);
    setResultado(null);
    setSegundos(((performance.now() - t0) / 1000).toFixed(1));
  };

  const crear = () => conEspera(async () => {
    const t0 = performance.now();
    adoptar(await crearCuenta(`aval-${Date.now().toString(36)}`), t0);
  });

  const volverAEntrar = () => conEspera(async () => {
    const t0 = performance.now();
    adoptar(await entrar(), t0);
  });

  const aprobar = () => conEspera(async () => {
    if (!cuenta?.clave) throw new Error('Primero crea la cuenta en este dispositivo para tener la clave P256.');
    const accion = `Pagar 30 USDC al agente #1 · nonce ${crypto.getRandomValues(new Uint32Array(1))[0]}`;
    const desafio = new Uint8Array(sha256(toBytes(accion), 'bytes'));
    const aprobacion = await firmarAprobacion(cuenta.credentialId, desafio);
    const { r, s, hash } = aprobacion;
    const ultimo = (parseInt(hash.slice(-2), 16) ^ 0xff).toString(16).padStart(2, '0');
    const hashAlterado = `${hash.slice(0, -2)}${ultimo}` as Hex;

    const [valida, alterada] = await Promise.all([
      verificarEnMonad(hash, r, s, cuenta.clave),
      verificarEnMonad(hashAlterado, r, s, cuenta.clave),
    ]);
    setResultado({ accion, aprobacion, revision: revisarAprobacion(aprobacion, desafio), valida, alterada });
  });

  return (
    <main>
      <header>
        <h1>Aval · prueba de P256 con Mera</h1>
        <p>Comprueba si de una sola passkey sale la cuenta de Mera y una clave P256 que Monad verifica onchain.</p>
      </header>

      <section>
        <h2>1. Cuenta con una sola ceremonia</h2>
        <div className="botones">
          <button disabled={ocupado} onClick={crear}>Crear cuenta con passkey</button>
          <button className="sec" disabled={ocupado} onClick={volverAEntrar}>Ya tengo passkey: entrar</button>
        </div>
        {cuenta && (
          <dl>
            <dt>Dirección (Mera)</dt><dd><code>{cuenta.direccion}</code></dd>
            <dt>Ceremonias usadas</dt>
            <dd className={cuenta.ceremonias === 1 ? 'ok' : 'aviso'}>
              {cuenta.ceremonias} {cuenta.ceremonias === 1 ? '(cumple la regla de una sola ceremonia)' : '(el autenticador no dio PRF al crear; Mera hizo una aserción extra)'}
            </dd>
            <dt>Tiempo</dt><dd>{segundos} s</dd>
            <dt>Clave P256 de la passkey</dt>
            <dd>
              {cuenta.clave
                ? <><code>x {corto(cuenta.clave.x)}</code><br /><code>y {corto(cuenta.clave.y)}</code></>
                : <span className="aviso">No disponible al entrar: en la versión final se leerá de la cadena.</span>}
            </dd>
          </dl>
        )}
      </section>

      <section>
        <h2>2. Aprobar una acción y verificarla en Monad</h2>
        <button disabled={ocupado || !cuenta?.clave} onClick={aprobar}>Aprobar pago de prueba con la passkey</button>
        {resultado && (
          <dl>
            <dt>Acción firmada</dt><dd>{resultado.accion}</dd>
            <dt>Precompile P256 de Monad</dt>
            <dd className={resultado.valida ? 'ok' : 'mal'}>{resultado.valida ? 'Firma válida' : 'Firma rechazada'}</dd>
            <dt>Con el hash alterado</dt>
            <dd className={resultado.alterada ? 'mal' : 'ok'}>{resultado.alterada ? 'Aceptada (error grave)' : 'Rechazada, como debe ser'}</dd>
            <dt>Desafío = hash de la acción</dt><dd className={resultado.revision.desafioCoincide ? 'ok' : 'mal'}>{resultado.revision.desafioCoincide ? 'Sí' : 'No'}</dd>
            <dt>Tipo webauthn.get</dt><dd className={resultado.revision.tipoCorrecto ? 'ok' : 'mal'}>{resultado.revision.tipoCorrecto ? 'Sí' : 'No'}</dd>
            <dt>Usuario presente y verificado</dt>
            <dd className={resultado.revision.usuarioPresente && resultado.revision.usuarioVerificado ? 'ok' : 'mal'}>
              {resultado.revision.usuarioPresente ? 'presente' : 'no presente'} · {resultado.revision.usuarioVerificado ? 'verificado' : 'no verificado'}
            </dd>
            <dt>Origen</dt><dd><code>{resultado.revision.origen}</code></dd>
            <dt>Firma</dt><dd><code>r {corto(resultado.aprobacion.r)}</code><br /><code>s {corto(resultado.aprobacion.s)}</code></dd>
          </dl>
        )}
      </section>

      {ocupado && <p className="estado">Esperando la passkey o la red…</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
