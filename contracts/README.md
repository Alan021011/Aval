# Aval · contratos

Contratos de Aval en Solidity, con [Foundry](https://getfoundry.sh). Red objetivo: Monad testnet (chain ID 10143).

## Contratos

### `PasskeyRegistry`

Liga la cuenta del usuario (la EOA que Mera deriva de su passkey) con la clave pública P256 de esa misma passkey.

- `register(x, y)`: registra o rota la clave de quien llama.
- `registerFor(owner, x, y, deadline, signature)`: lo mismo, con una firma EIP-712 del dueño, para que un relayer pague el gas. Tiene nonce contra repeticiones y fecha límite.
- `keyOf(owner)` y `hasKey(owner)`: consulta.
- `verifyApproval(owner, challenge, auth)`: comprueba que el dueño aprobó `challenge` con su passkey, con presencia y verificación del usuario. Usa `WebAuthn` y `P256` de OpenZeppelin, que llaman al precompile P256 de Monad (`0x0100`).

**Requisito para clientes:** la firma debe llegar con `s` bajo (`s ≤ n/2`). Los autenticadores entregan cualquiera de las dos formas, así que hay que normalizar (`s = n - s` si es alto).

### `AgentPermit`

Permisos acotados que un usuario le da a un agente para gastar sus tokens. Los fondos se quedan en la cuenta del usuario; el contrato los mueve con `transferFrom` (el usuario autoriza al contrato con `approve` o con una firma ERC-2612).

Cada permiso (`Terms`) fija: agente, ID en ERC-8004, token, máximo por gasto, total, umbral de aprobación, caducidad y, opcionalmente, una lista de destinatarios permitidos.

| Función | Quién la llama | Qué hace |
|---|---|---|
| `grant(terms, recipients)` | Usuario | Crea un permiso. `recipients` vacío = cualquier destinatario |
| `grantBySig(owner, terms, recipients, deadline, sig)` | Relayer | Igual, con firma EIP-712 del usuario |
| `revoke(id)` / `revokeBySig(id, deadline, sig)` | Usuario / relayer | Revoca el permiso |
| `spend(id, to, amount, ref)` | Agente | Gasta dentro de los límites y bajo el umbral |
| `requestSpend(id, to, amount, ref)` | Agente | Pide un gasto sobre el umbral; queda pendiente |
| `approveSpend(requestId, auth)` | Cualquiera | Ejecuta el pedido si trae la aprobación de la passkey del usuario sobre `approvalChallenge(requestId)` |
| `remaining`, `getPermit`, `getRequest`, `isAllowedRecipient` | — | Consultas |
| `paidAmount(payee, client)` | — | Recibo acumulado de pagos, para filtrar la reputación |
| `payerCount(payee)`, `payers(payee, offset, limit)` | — | Cuentas que le pagaron a `payee` (el dueño del permiso y su agente) |

### `ReputationReader`

Reputación verificada de agentes ERC-8004: resume solo las reseñas de cuentas que de verdad le pagaron al agente a través de `AgentPermit`. Cualquiera puede reseñar en ERC-8004; este lector ignora a quien no tiene recibo.

- `verifiedSummary(agentId, tag1, tag2, minPaid)`: devuelve `count`, `value` y `decimals` (el promedio que calcula ERC-8004) y cuántos clientes verificados entraron. `minPaid` exige un pago mínimo para contar.
- `verifiedClients(agentId, minPaid)`: las cuentas que cuentan.

Detalles:
- El pago cuenta si fue a la billetera registrada del agente (`getAgentWallet` del Identity Registry).
- El Reputation Registry de Monad testnet **revierte si la lista de clientes está vacía**; el lector devuelve cero en ese caso.
- ERC-8004 devuelve el **promedio truncado** a los decimales de las reseñas: conviene reseñar en escala 0–100 en vez de -1/1.
- Considera como máximo 200 pagadores; para más, el indexador calcula el puntaje completo.
- Limitación conocida: un agente podría pagarse desde cuentas propias. `minPaid` encarece ese fraude, pero no lo elimina.

Registros ERC-8004 en Monad testnet: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`.

`approvalChallenge(requestId)` es un hash EIP-712 atado a la red, al contrato y a los datos exactos del gasto: una aprobación no sirve para otro pedido. Los límites se revisan otra vez al aprobar, por si el permiso se revocó, venció o se gastó mientras tanto.

### `TestUSD`

Dólar de prueba (6 decimales, como USDC) con ERC-2612 y un `faucet` de hasta 1.000 por llamada. Solo para testnet. Se paga en un token y no en MON para no chocar con la reserva de balance de Monad.

## Comandos

```bash
forge build
forge test
forge test --fork-url monad_testnet
```

El último corre los tests sobre una copia de Monad testnet, donde se usa el precompile P256 real y se activa `test/fork/`, que prueba `ReputationReader` contra los registros ERC-8004 reales.
