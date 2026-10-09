# Aval

Capa de confianza para agentes de IA en Monad: la passkey del usuario es la raíz de los permisos, las aprobaciones y la reputación de los agentes. Track Trust, Identity & AI Infrastructure de Monad Metropolis.

## Estado

**SDK listo** (`packages/sdk`) y **contratos desplegados en Monad testnet**, verificados en Sourcify: `PasskeyRegistry`, `AgentPermit`, `TestUSD` y `ReputationReader`. Direcciones y detalle en [`contracts/README.md`](contracts/README.md).

Prueba inicial (`apps/demo`): comprobar que de **una sola passkey** sale:

1. La cuenta del usuario con [Mera](https://mera.category.xyz) (EOA derivada del PRF de la passkey), en **una sola ceremonia**.
2. La **clave pública P256** de esa misma passkey, capturada con un `webAuthnClient` propio que se le pasa a Mera.
3. Una **aprobación** de una acción firmada con la passkey, que el **precompile P256 de Monad** (`0x0100`) verifica onchain.

## Probar

Requisitos: Node 22+ y una passkey con soporte PRF. En Chrome de escritorio solo funcionan las passkeys guardadas en el gestor de contraseñas de Google; también sirven iCloud Keychain o 1Password.

```bash
npm install
npm run dev
```

Abre `http://localhost:5173` y:

1. **Crear cuenta con passkey.** Debe decir "Ceremonias usadas: 1" y mostrar la clave P256 (x, y).
2. **Aprobar pago de prueba.** Debe decir "Firma válida" con el hash original y "Rechazada" con el hash alterado.

## Estructura

- `packages/sdk/`: **SDK en TypeScript** (`@aval/sdk`) para integrar Aval con viem: permisos, aprobaciones con passkey, recibos y reputación verificada. Ver [`packages/sdk/README.md`](packages/sdk/README.md).
- `apps/relayer/`: **relayer** (en vivo: https://aval-relayer.vercel.app) que envía las firmas del usuario y paga el gas, para que nadie necesite MON. Ver [`apps/relayer/README.md`](apps/relayer/README.md).
- `contracts/`: contratos en Solidity con Foundry, tests y script de despliegue. Ver [`contracts/README.md`](contracts/README.md).
- `apps/demo/src/lib/p256.ts`: cliente WebAuthn con captura de la clave P256, aprobación con desafío propio y verificación con el precompile.
- `apps/demo/src/lib/cuenta.ts`: cuenta con Mera. La derivación (PRF → BIP-39 → `m/44'/60'/0'/0/0`) viene de Garante.
- `apps/demo/src/lib/monad.ts`: red Monad testnet y dirección del precompile.

## Redes

Monad testnet (chain ID 10143). ERC-8004 en testnet: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`.
