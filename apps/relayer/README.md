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
| `GET /health` | Estado y saldo del relayer | — |

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

## Limitaciones conocidas

- **Los límites viven en memoria.** Sirven para una sola instancia. Con varias instancias (por ejemplo, funciones serverless) hay que moverlos a un almacén compartido, como Redis.
- **Es un relayer de testnet.** No tiene autenticación de usuario: confía en las firmas y en los límites. Para producción haría falta además un pago por uso o una lista de usuarios admitidos.
- **No envía avisos de aprobación pendiente.** Eso se hará con webhooks de Alchemy, y necesita una URL pública.
