# @aval/relayer

Relayer de Aval: recibe lo que el usuario **firmó** y lo envía a Monad pagando el gas. Así un usuario nuevo puede registrar su passkey, recibir tUSD, crear permisos y aprobar gastos **sin tener MON**.

El relayer **nunca recibe claves privadas**. Solo recibe firmas, que no sirven para nada distinto a lo que el usuario firmó (cada una está atada a una operación exacta, a la red, al contrato, a un nonce y a una fecha límite).

## Qué puede y qué no puede hacer

Solo envía cinco operaciones con los contratos de Aval. No envía datos arbitrarios, así que no sirve para hacer otra cosa con su dinero.

| Ruta | Qué envía | Firma del usuario |
|---|---|---|
| `POST /relay/register` | Guarda la clave P256 de su passkey | EIP-712 `Register` |
| `POST /relay/token-permit` | Autoriza a `AgentPermit` a mover un token | ERC-2612 `Permit` |
| `POST /relay/grant` | Crea un permiso para un agente | EIP-712 `Grant` |
| `POST /relay/revoke` | Revoca un permiso | EIP-712 `Revoke` |
| `POST /relay/approve` | Ejecuta un gasto pendiente | Aprobación con passkey (P256) |
| `POST /faucet` | Entrega tUSD de prueba | — |
| `GET /agent/info` | Datos del agente de demostración (dirección, saldo, servicio al que paga) | — |
| `POST /agent/spend` | El agente de demostración paga al servicio dentro del permiso | — |
| `POST /agent/request` | El agente pide un pago que supera el umbral de aprobación | — |
| `POST /agent/review` | El agente reseña al servicio (de 0 a 100) | — |
| `GET /health` | Estado y saldo del relayer | — |

## Agente de demostración

Para mostrar el flujo completo alguien tiene que hacer de agente de IA: pagar dentro del límite, intentar pasarse, pedir una aprobación y reseñar al servicio. El relayer trae un **agente de demostración** con su propia cuenta de testnet (`AGENT_PRIVATE_KEY`) y su propio saldo mínimo. Es el "cuerpo" del agente: las acciones que luego usa el agente con Qwen para decidir.

- **El usuario le da un permiso** al agente (con la dirección que devuelve `GET /agent/info` como `agent`) y el agente actúa con esos límites.
- **Solo paga a un servicio fijo**, un agente registrado en ERC-8004 cuya billetera recibe los pagos. No hay ningún parámetro para elegir a quién pagar (una prueba comprueba que un campo `to` se rechaza).
- **Solo usa permisos que un usuario le dio a su cuenta**: el contrato rechaza cualquier otro (`NotAgent`).
- Comparte las mismas protecciones que el relayer: límites por IP y por usuario, tope diario, reintento ante choques de nonce y su **propia cola** de envío, porque es otra cuenta con su propio nonce.
- Si no se configura `AGENT_PRIVATE_KEY`, sus rutas responden `404 DemoAgentDisabled`.
- Con el SDK: `relayer.agent.info()`, `.spend()`, `.request()` y `.review()`.

Prueba real del flujo completo contra un relayer en marcha (un usuario sin MON, con una passkey simulada para la aprobación):

```bash
node scripts/smoke-agent.mjs [url]
```

Comprueba que cada rechazo sea **con el código exacto esperado** (un fallo por falta de gas no cuenta como éxito) y termina con código de salida distinto de cero si algo no coincide.

## Cómo protege sus fondos

Sin estas reglas, cualquiera podría gastarle el gas:

1. **Solo las cinco operaciones de arriba**, con esquemas estrictos: un campo extra o fuera de rango se rechaza.
2. **Simula antes de enviar.** Una firma falsa, vencida o repetida se rechaza **sin gastar gas** (hay una prueba que comprueba que el nonce del relayer no cambia).
3. **Solo trabaja con tokens permitidos** (por defecto, el tUSD del despliegue).
4. **Límites por IP y por usuario** (30 y 10 por minuto por defecto), con `Retry-After`.
5. **Tope diario de transacciones** (2.000 por defecto).
6. **Saldo mínimo:** si baja de 0,5 MON deja de enviar en vez de vaciarse.
7. **Faucet:** una vez por dirección y por IP cada hora.
8. **Una transacción a la vez**, para que el nonce nunca se pise.
9. **CORS** solo para los orígenes autorizados, y **tamaño máximo** de solicitud.
10. **Los errores no filtran detalles internos ni la clave.**

Costo observado en Monad testnet: **~0,01 MON por operación**.

## Puesta en marcha

```bash
cp .env.example .env     # y pon una clave de TESTNET en RELAYER_PRIVATE_KEY
npm run dev              # desde apps/relayer; escucha en http://localhost:8787
```

1. Genera una cuenta nueva solo para esto (`cast wallet new`) y cárgala desde https://faucet.monad.xyz. **Nunca uses una cuenta con fondos reales ni una clave personal.**
2. `.env` está en `.gitignore`. La clave nunca se imprime en ningún log.
3. Antes de arrancar, reconstruye el SDK una vez (`npm run build:sdk` en la raíz), porque el relayer lo usa desde `dist`.

Variables (ver [`.env.example`](.env.example)): `RELAYER_PRIVATE_KEY`, `RPC_URL`, `PORT`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, `ALLOWED_TOKENS`, `MIN_BALANCE_MON` y los límites opcionales.

> **`TRUST_PROXY`:** actívalo solo detrás de un proxy de confianza (Vercel, nginx…). Si no, cualquiera podría falsear su IP con la cabecera `x-forwarded-for` y saltarse los límites por IP. Con `false` (por defecto) se usa la IP real de la conexión.

## Cómo usarlo desde una app

El SDK trae un cliente:

```ts
import { createAval, createRelayerClient } from '@aval/sdk';

const relayer = createRelayerClient({ url: 'http://localhost:8787' });
const aval = createAval({ publicClient, walletClient: userWallet });

await relayer.faucet(userAddress);                                          // recibe tUSD
await relayer.register(await aval.passkeys.signRegister(passkeyKey));       // registra su passkey
await relayer.grant(await aval.permits.signGrant({ agent, ... }));          // crea el permiso
await relayer.approve(requestId, await aval.permits.signApproval(requestId)); // aprueba con la huella
```

El usuario firma, el relayer envía. El usuario no necesita MON en ningún paso.

## Prueba real

Con el servidor en marcha:

```bash
node scripts/smoke.mjs
```

Crea un usuario nuevo sin MON, le pide tUSD al relayer, registra su clave de passkey y comprueba que quedó guardada onchain.

## Pruebas

```bash
npm test
```

14 pruebas contra los contratos desplegados, sobre una copia local de Monad testnet (`anvil`): el flujo completo sin MON del usuario, varias operaciones a la vez, firmas falsas o vencidas, tokens no permitidos, solicitudes mal formadas, límites, saldo bajo, CORS y que no se filtre la clave. Si `anvil` no está instalado, se saltan.

## Despliegue en Vercel

**En vivo:** https://aval-relayer.vercel.app (Monad testnet). `GET /health` muestra su estado y saldo. Probado en vivo: un usuario sin MON recibe tUSD y registra su passkey en ~6 s, y 10 operaciones simultáneas llegan todas (dos corridas, 20 de 20).

`api/index.ts` es la entrada para Vercel: una función Node que atiende `/health`, `/relay/*` y `/faucet`. `vercel.json` ya trae el comando de instalación, el de compilación del SDK y las reglas de reenvío.

Ajustes del proyecto en Vercel:

| Ajuste | Valor |
|---|---|
| Root Directory | `apps/relayer` |
| Include source files outside of the Root Directory | Activado (el relayer usa el SDK del monorepo) |
| Framework Preset | Other |

Variables de entorno (márcalas como **Sensitive** las secretas):

| Variable | Valor |
|---|---|
| `RELAYER_PRIVATE_KEY` | Clave de la cuenta de testnet del relayer (**secreta**) |
| `TRUST_PROXY` | `true` (en Vercel la IP real llega en `x-forwarded-for`; Vercel la reescribe y el cliente no puede falsearla) |
| `ALLOWED_ORIGINS` | La URL de la demo, por ejemplo `https://aval-demo-alpha.vercel.app` |

Dos cosas que solo se descubren en el entorno real (las pruebas en local no las detectaban):

1. **El formato de la función importa.** Con el formato clásico `(req, res)` de Node, Vercel lee el cuerpo de la petición antes de llamar a la función y los POST se cuelgan hasta que Vercel los corta a los 300 s (los GET sí funcionan). Por eso `api/index.ts` usa el formato estándar de Web: `export default { fetch(request) }`.
2. **El RPC de Monad no dice "nonce too low" cuando dos envíos chocan.** Responde un error genérico de parámetros con el detalle *"An existing transaction had higher priority"*, que viem no clasifica como error de nonce. El relayer lo reconoce por ese mensaje.

Lo que cambia respecto a un servidor normal:

- **Varias instancias a la vez.** Vercel puede correr copias de la función en paralelo, cada una con su propia cola. Dos copias pueden elegir el mismo nonce y una choca. Cuando eso pasa la transacción no llegó a enviarse, así que el relayer la **reintenta sola** (hasta `MAX_NONCE_RETRIES`, 6 por defecto). Está probado, también inyectando el error.
- **Los límites no se comparten entre copias.** Cada instancia cuenta por su cuenta, así que el límite por IP es aproximado. Para algo más estricto hay que moverlo a un almacén compartido (por ejemplo, Upstash Redis).
- **Tiempo máximo por función.** En el plan gratuito es corto (10 s según la documentación pública). Medido en vivo: el flujo completo de la prueba (dos operaciones) tarda ~6 s y diez operaciones simultáneas ~6 s.
- **Si falta una variable de entorno**, la función responde `ServerMisconfigured` (HTTP 500) y el motivo queda en los registros de Vercel, en vez de no arrancar.

Para probar la función de Vercel en tu equipo, sin desplegar:

```bash
node --env-file=.env --import tsx scripts/local-vercel.mjs   # http://localhost:8790
```

## Limitaciones conocidas

- **Los límites viven en memoria.** Sirven bien para una sola instancia; con varias son aproximados (ver arriba).
- **Es un relayer de testnet.** No tiene autenticación de usuario: confía en las firmas y en los límites. Para producción haría falta además un pago por uso o una lista de usuarios admitidos.
- **No envía avisos de aprobación pendiente.** Eso se hará con webhooks de Alchemy, y necesita una URL pública.
