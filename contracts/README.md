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

## Comandos

```bash
forge build
forge test
forge test --fork-url monad_testnet
```

El último corre los tests sobre una copia de Monad testnet, donde se usa el precompile real.
