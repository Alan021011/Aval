# @aval/demo

La demo de Aval: una app web donde un usuario le da a un agente de IA un **permiso con límites**, y lo grande lo aprueba con su **huella**. Está hecha con el SDK ([`@aval/sdk`](../../packages/sdk/README.md)) y el [relayer](../relayer/README.md), sobre los contratos de Monad testnet.

No es el producto: es la prueba de que el protocolo funciona y de que otro desarrollador puede construir encima con pocas líneas.

## Qué muestra

| Pantalla | Qué hace | Qué demuestra |
|---|---|---|
| **Inicio** | Un botón: «Empezar con mi huella» | Cuenta nueva con **una sola ceremonia** de passkey (Mera): sin frase secreta, sin extensión, sin correo ni contraseña |
| **Preparando** | Crea la cuenta, recibe tUSD de prueba y registra la clave de la huella | Todo lo envía el relayer: el usuario **no necesita MON** |
| **Permiso** | Máximo por pago, total, umbral de aprobación y vencimiento | Se firma **sin ventanas** con la sesión abierta; el contrato aplica los límites |
| **Tu agente en acción** | Pagar, intentar pagar de más, pedir un pago grande, reseñar | Cada caso lo decide el contrato, y el bloqueo se explica con montos en tUSD |
| **Aprobaciones** | Pagos grandes pendientes | **Aprobar con la huella** (la ventana de passkey aparece a propósito): se verifica en la cadena con el precompile P256 de Monad |
| **Actividad** | Pagos y bloqueos | Los pagos se leen de los **recibos onchain**, no de memoria |
| **Reputación** | Puntaje del servicio | Solo cuentan reseñas de quienes **de verdad le pagaron** |
| **Inspector** | Contratos, clave P256, hashes, tiempos | Todo lo que la vista de usuario oculta, para los jueces |

## Sesión y prueba sin estado

- **Sesión:** mientras está abierta, la app firma permisos y revocaciones sin pedir la huella. Se bloquea sola a los 10 minutos sin actividad (o con un toque en el indicador): la clave sale de la memoria y los botones de acción se deshabilitan. Aprobar un pago grande **siempre** pide la huella.
- **Nada importante se guarda en el navegador.** Al entrar, el saldo, los permisos, los pedidos pendientes y el historial de pagos se reconstruyen **solo desde la cadena**. Los contratos guardan índices por usuario y un libro de recibos precisamente por esto: los RPC públicos de Monad limitan `eth_getLogs` a 100 bloques, así que no se puede reconstruir leyendo eventos.
- **«Simular dispositivo nuevo»** (en el inspector) borra la memoria y el almacenamiento local. Al volver a entrar con la misma passkey, todo reaparece.

## Dos tipos de passkey

- **Real** (por defecto): la passkey del dispositivo con la extensión PRF. En Chrome de escritorio solo funcionan las passkeys guardadas en el gestor de contraseñas de Google; también sirven iCloud Keychain y 1Password. La passkey queda atada al dominio donde se creó.
- **Modo de prueba** (desplegable en la pantalla de inicio): una clave de software guardada en este navegador. Sirve para recorrer la demo en dispositivos sin PRF y para probar la interfaz sin un autenticador. **No es una passkey real** y no demuestra la recuperación en otro dispositivo: la app lo avisa.

## Ejecutar

```bash
npm install
npm run build:sdk      # el SDK se usa compilado
npm run dev            # http://localhost:5173
```

Por defecto usa el relayer publicado (`https://aval-relayer.vercel.app`). Para usar uno propio: `VITE_RELAYER_URL=http://localhost:8787 npm run dev`. El relayer debe tener tu origen en `ALLOWED_ORIGINS`.

Las lecturas de la cadena usan **tres RPC públicos con respaldo automático**: si uno no responde (el principal ha tenido caídas cortas), pasa al siguiente.

## Pruebas

```bash
npm test
```

13 pruebas de la lógica que no depende del navegador: formato de montos, cálculo de los montos de las acciones de ejemplo (siempre bajo el umbral, sobre el máximo y entre los dos) y mensajes de bloqueo en tUSD. Encontraron un caso límite real: con umbral 4 y máximo 5, el «pago grande» de ejemplo quedaba igual al umbral y no pedía aprobación.

## Despliegue

`vercel.json` ya trae los comandos. En Vercel: carpeta raíz `apps/demo` e «incluir archivos fuera de la raíz» activado. Después hay que agregar la URL de la demo a `ALLOWED_ORIGINS` del relayer.
