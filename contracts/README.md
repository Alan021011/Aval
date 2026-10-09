# Aval · contratos

Contratos de Aval en Solidity, con [Foundry](https://getfoundry.sh). Red objetivo: Monad testnet (chain ID 10143).

## Despliegue en Monad testnet

Código verificado en Sourcify (coincidencia exacta). Las direcciones también están en [`deployments/monad-testnet.json`](deployments/monad-testnet.json).

| Contrato | Dirección |
|---|---|
| `PasskeyRegistry` | [`0x0C46E673C0f852920e9F15902B0859358Eb53789`](https://testnet.monadvision.com/address/0x0C46E673C0f852920e9F15902B0859358Eb53789) |
| `AgentPermit` | [`0x00F0C1b1FB751c380dF0132001eab6ca110Fc2DA`](https://testnet.monadvision.com/address/0x00F0C1b1FB751c380dF0132001eab6ca110Fc2DA) |
| `TestUSD` | [`0xeD4Bb1e1926441461BcADA4BBF647Aba8574B3C5`](https://testnet.monadvision.com/address/0xeD4Bb1e1926441461BcADA4BBF647Aba8574B3C5) |
| `ReputationReader` | [`0x831EeA5808B40C2f1fE49d817B056D3d54E685D6`](https://testnet.monadvision.com/address/0x831EeA5808B40C2f1fE49d817B056D3d54E685D6) |

`AgentPermit` y `ReputationReader` se redesplegaron al agregar los listados (las direcciones anteriores quedan en `deployments/monad-testnet.json`, bajo `previous`). `script/DeployPermits.s.sol` redespliega solo esos dos y reutiliza `PasskeyRegistry` y `TestUSD`.

Para desplegar todo de nuevo, poner `PRIVATE_KEY` en `contracts/.env` (git lo ignora) y correr:

```bash
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
```

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
| `permitIdsOf(owner, offset, limit)`, `permitCountOf(owner)` | — | Permisos de un usuario |
| `agentPermitIds(agent, offset, limit)`, `agentPermitCount(agent)` | — | Permisos que le dieron a un agente |
| `requestIdsOf(owner, offset, limit)`, `requestCountOf(owner)` | — | Pedidos de gasto sobre los permisos de un usuario (pendientes, ejecutados o vencidos) |
| `receiptsOf(owner, offset, limit)`, `receiptCountOf(owner)` | — | Libro de recibos de los pagos de un usuario: destinatario, permiso, monto, pedido, fecha y referencia |

**Por qué hay listados y recibos onchain:** los RPC públicos de Monad limitan `eth_getLogs` a **100 bloques** (la cadena produce ~217.000 por día), así que un cliente no puede reconstruir el estado de un usuario leyendo eventos. Con los listados, todo se recupera solo desde la cadena y desde cualquier RPC, sin indexador: es lo que permite que la app se reconstruya por completo desde la passkey. Las páginas son seguras en los bordes (offset pasado el final, límite enorme).

### `ReputationReader`

Reputación verificada de agentes ERC-8004: resume solo las reseñas de cuentas que de verdad le pagaron al agente a través de `AgentPermit`. Cualquiera puede reseñar en ERC-8004; este lector ignora a quien no tiene recibo.

- `verifiedSummary(agentId, tag1, tag2, minPaid)`: devuelve `count`, `value` y `decimals` (el promedio que calcula ERC-8004) y cuántos clientes verificados entraron. `minPaid` exige un pago mínimo para contar.
- `verifiedClients(agentId, minPaid)`: las cuentas que cuentan.
- Ambas tienen una versión con un `IClientVerifier` extra: solo cuentan los pagos cuyo humano (el dueño del permiso, aunque la reseña la deje su agente) está verificado por esa fuente. La elige quien consulta; con la dirección cero no se exige.

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
