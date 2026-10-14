# @aval/demo

La demo de Aval: una app web donde un usuario le da a un agente de IA un **permiso con límites**, y lo grande lo aprueba con su **huella**. Está hecha con el SDK ([`@aval/sdk`](../../packages/sdk/README.md)) y el [relayer](../relayer/README.md), sobre los contratos de Monad testnet.

**En vivo:** https://aval-demo-alpha.vercel.app (Monad testnet, dinero de prueba).

No es el producto: es la prueba de que el protocolo funciona y de que otro desarrollador puede construir encima con pocas líneas.

## Qué muestra

La interfaz sigue el diseño de Stitch (*Aval Agent Spending Control*), hecha con Tailwind CSS v4, con modo claro y oscuro. Después de entrar, cada sección es una vista propia (`#/panel`, `#/permiso`, `#/agente`, `#/aprobaciones`, `#/recibos`, `#/memoria`, `#/inspector`). En escritorio se navega con un menú lateral y en el móvil con una barra inferior.

| Pantalla | Qué hace | Qué demuestra |
|---|---|---|
| **Inicio** | Un botón: «Empezar con mi huella» | Cuenta nueva con **una sola ceremonia** de passkey (Mera): sin frase secreta, sin extensión, sin correo ni contraseña |
| **Preparando** | Crea la cuenta, recibe tUSD de prueba y registra la clave de la huella | Todo lo envía el relayer: el usuario **no necesita MON** |
| **Permiso y agente** | Máximo por pago, total, umbral de aprobación y vencimiento; botones para pagar, intentar pagar de más, pedir un pago grande y reseñar | El permiso se firma **sin ventanas** con la sesión abierta; cada caso lo decide el contrato y el bloqueo se explica con montos en tUSD |
| **Pídele a tu agente** | Una tarea en lenguaje natural | **Qwen 3.8 Max** planifica con 6 herramientas reales, reacciona a los rechazos del contrato y muestra su razonamiento (en inglés, tal cual lo devuelve el modelo). Tarda de 10 a 30 s |
| **Aprobaciones** | Pagos grandes pendientes | **Aprobar con la huella** (la ventana de passkey aparece a propósito): se verifica en la cadena con el precompile P256 de Monad |
| **Recibos y reputación** | Pagos, bloqueos y puntaje del servicio | Los pagos se leen de los **recibos onchain**; solo cuentan reseñas de quienes **de verdad le pagaron** |
| **Memoria del agente** | Una parte privada y otra compartida con el agente | Cifrada con claves derivadas de la passkey; se puede compartir y revocar (revocar protege lo que se escriba después). Probado con una passkey real en dos dispositivos (13-oct) |
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

Las lecturas de la cadena usan **tres RPC públicos con respaldo automático**: si uno no responde (el principal ha tenido caídas cortas), pasa al siguiente. Los dos de respaldo no siempre aceptan todas las llamadas, así que el respaldo es parcial.

## Pruebas

```bash
npm test
```

13 pruebas de la lógica que no depende del navegador: formato de montos, cálculo de los montos de las acciones de ejemplo (siempre bajo el umbral, sobre el máximo y entre los dos) y mensajes de bloqueo en tUSD. Encontraron un caso límite real: con umbral 4 y máximo 5, el «pago grande» de ejemplo quedaba igual al umbral y no pedía aprobación.

## Despliegue

`vercel.json` ya trae los comandos. En Vercel: proyecto `aval-demo`, carpeta raíz `apps/demo` e «incluir archivos fuera de la raíz» activado. La URL de la demo debe estar en `ALLOWED_ORIGINS` del relayer (ya lo está).

Dos detalles de Vercel que conviene saber:

- **El alias corto `aval-demo.vercel.app` pertenece a otro proyecto ajeno**: los nombres `*.vercel.app` son únicos en todo Vercel. El alias de este proyecto es **`aval-demo-alpha.vercel.app`**. Hay que usar siempre ese.
- Este repositorio tiene **dos proyectos de Vercel** (`aval-relayer` y `aval-demo`). El enlace de `.vercel/` en la raíz apunta al relayer; para desplegar la demo se indican los dos identificadores a mano: `VERCEL_ORG_ID=… VERCEL_PROJECT_ID=… vercel deploy --prod`.
