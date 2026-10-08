# @aval/sdk

SDK de Aval: permisos acotados, aprobaciones con passkey y reputación verificada para agentes de IA en Monad.

Aval deja que un usuario le dé a un agente de IA un **permiso con límites** (monto por gasto, total, caducidad, a quién puede pagar). Los gastos grandes **esperan la huella del usuario**, que se verifica onchain con el precompile P256 de Monad. Cada pago deja un **recibo**, y la reputación del agente solo cuenta a quienes de verdad le pagaron.

Este SDK envuelve los contratos desplegados en **Monad testnet** (chain ID 10143). Funciona con [viem](https://viem.sh).

## Integración en menos de 10 líneas

**Si construyes un agente** (el agente gasta dentro de los límites que le dio el usuario):

```ts
import { createAval } from '@aval/sdk';

const aval = createAval({ publicClient, walletClient: agentWallet });

await aval.permits.spend({ permitId, to: shop, amount: 10_000000n, ref: 'pedido-1' });          // dentro del límite

const { requestId } = await aval.permits.requestSpend({ permitId, to: shop, amount: 80_000000n }); // sobre el umbral: espera al usuario
```

**Si construyes la app del usuario** (el usuario crea el permiso y aprueba con su huella):

```ts
const aval = createAval({ publicClient, walletClient: userWallet });

const { permitId } = await aval.permits.grant({
  agent, maxPerSpend: 100_000000n, maxTotal: 300_000000n, approvalThreshold: 50_000000n, expiresIn: 86_400,
});

await aval.permits.approve(requestId); // pide la huella y ejecuta el gasto pendiente
```

Los montos van en las unidades del token. `tUSD` tiene 6 decimales, así que `10_000000n` es 10 tUSD.

## Instalación

```bash
npm install @aval/sdk viem
```

Dentro de este monorepo ya está disponible como workspace (`packages/sdk`).

## Conceptos

| Concepto | Qué es |
|---|---|
| **Permiso** | Límites que el usuario le da a un agente: token, máximo por gasto, total, umbral de aprobación, caducidad y destinatarios. Los fondos se quedan en la cuenta del usuario. |
| **Umbral de aprobación** | Los gastos mayores deben pasar por `requestSpend` y esperar la aprobación del usuario. `null` = nunca piden aprobación. Es obligatorio, para que la decisión sea explícita. |
| **Aprobación** | El usuario firma con su passkey el hash del pedido (`challenge`). Solo sirve para ese gasto exacto, en esa red y en ese contrato. |
| **Recibo** | Cada gasto suma al pagador y a su agente en `paidAmount(payee, client)`. |
| **Reputación verificada** | El promedio de reseñas de ERC-8004 contando solo a quienes pagaron al agente. |

## Referencia

`createAval({ publicClient, walletClient?, addresses?, assertionProvider? })` devuelve cuatro módulos.

### `aval.permits`

| Método | Quién | Qué hace |
|---|---|---|
| `grant(input)` | Usuario | Crea un permiso. Devuelve `{ permitId, hash, receipt }`. |
| `signGrant(input)` → `relayGrant(signed)` | Usuario firma, relayer envía | Igual, sin que el usuario gaste gas. |
| `revoke(permitId)` | Usuario | Revoca el permiso. |
| `signRevoke(permitId)` → `relayRevoke(signed)` | Usuario firma, relayer envía | Revoca sin gas. |
| `spend({ permitId, to, amount, ref? })` | Agente | Gasta dentro de los límites y bajo el umbral. |
| `requestSpend({ permitId, to, amount, ref? })` | Agente | Pide un gasto sobre el umbral. Devuelve `{ requestId }`. |
| `approve(requestId, { credentialId? })` | Usuario | Pide la huella y ejecuta el gasto. |
| `signApproval(requestId)` → `submitApproval(requestId, auth)` | Usuario firma, cualquiera envía | Lo mismo en dos pasos. |
| `get`, `getRequest`, `remaining`, `isAllowedRecipient`, `paidAmount`, `challenge` | — | Consultas. |

`GrantInput`: `agent`, `agentId?`, `token?` (por defecto tUSD), `maxPerSpend`, `maxTotal`, `approvalThreshold` (`bigint` o `null`), `expiresIn` (segundos) o `expiresAt` (fecha UNIX), `recipients?` (vacío = cualquiera).

### `aval.passkeys`

| Método | Qué hace |
|---|---|
| `register(key)` | Guarda onchain la clave P256 de la passkey del usuario. |
| `signRegister(key)` → `relayRegister(signed)` | Lo mismo sin gas para el usuario. |
| `keyOf(owner)`, `has(owner)` | Lee la clave registrada, para reconstruir todo en un dispositivo nuevo. |

### `aval.reputation`

| Método | Qué hace |
|---|---|
| `summary(agentId, { tag1?, tag2?, minPaid?, verifier? })` | `{ count, value, decimals, verifiedClients }` contando solo clientes con recibo. `minPaid` exige un pago mínimo. `verifier` es un contrato que decide quién es una persona verificada. |
| `clients(agentId, { minPaid?, verifier? })` | Las cuentas que cuentan. |

### `aval.tokens`

Para que el usuario no necesite MON: `signPermit({ value })` → `relayPermit(signed)` autoriza a AgentPermit con una firma (ERC-2612). También `approve`, `balanceOf` y `faucet` (hasta 1.000 tUSD, solo testnet).

### Passkeys y WebAuthn

Por defecto el SDK pide la huella con `navigator.credentials.get`. Para otros entornos (pruebas, apps nativas) pasa tu propio `assertionProvider`:

```ts
const aval = createAval({
  publicClient,
  assertionProvider: async ({ challenge, credentialId }) => ({ authenticatorData, clientDataJSON, signature }),
});
```

Utilidades exportadas: `buildAuth` (arma lo que esperan los contratos), `derToRS` (convierte la firma DER y la normaliza a `s` bajo), `publicKeyFromSpki`, `toBase64Url`.

> **Importante:** los contratos solo aceptan firmas con `s` bajo (`s ≤ n/2`). Los autenticadores entregan cualquiera de las dos formas al azar; `derToRS` lo normaliza. Si armas la firma por tu cuenta, hazlo tú.

## Errores

Los reverts de los contratos llegan como `AvalError`, con `code` (el nombre del error del contrato) y un mensaje en español. Se simula antes de enviar, así que un error no gasta gas.

```ts
try {
  await aval.permits.spend({ permitId, to, amount: 80_000000n });
} catch (e) {
  if (e instanceof AvalError && e.code === 'NeedsApproval') {
    // pide la aprobación del usuario con requestSpend
  }
}
```

Códigos frecuentes: `NeedsApproval`, `ExceedsPerSpendLimit`, `ExceedsTotalLimit`, `RecipientNotAllowed`, `PermitInactive`, `NotAgent`, `InvalidApproval`, `InvalidSignature`.

## Cuentas con delegación EIP-7702

Las funciones con firma (`relayGrant`, `relayRevoke`, `relayRegister`) verifican con ERC-1271 si la cuenta del usuario tiene código. Una EOA con delegación EIP-7702 cuenta como contrato, y su firma solo sirve si el contrato delegado implementa ERC-1271. Las cuentas que Mera deriva de una passkey son EOAs limpias y funcionan sin problema. En Monad testnet las claves de prueba públicas (como las de anvil o hardhat) suelen tener delegaciones puestas por bots: no las uses.

## Desarrollo

```bash
npm run gen:abi    # regenera src/abi.ts desde la compilación de Foundry (hay que correr `forge build` antes)
npm run typecheck
npm test           # pruebas unitarias + prueba de punta a punta
```

La prueba de punta a punta levanta una copia local de Monad testnet con `anvil` y recorre el flujo completo contra los contratos desplegados, con una passkey simulada. Si `anvil` no está instalado, esas pruebas se saltan.
