# Aval

**Dale a tu agente de IA un permiso, no tus llaves.**

Aval es una capa de confianza para agentes de IA en [Monad](https://monad.xyz). La **passkey del usuario es la raíz** de todo: los permisos que le da a un agente, las aprobaciones de lo importante y la reputación de los agentes. Es un protocolo con su SDK, no una app de consumo. Hecho para el track *Trust, Identity & AI Infrastructure* de Monad Metropolis.

## Qué resuelve

Hoy, para que un agente de IA pague por ti, le das tu llave o tu tarjeta. Si se equivoca o lo hackean, pierdes todo; no hay límites ni forma de saber si ese agente merece confianza. Con Aval:

1. **El usuario le da al agente un permiso con límites:** máximo por pago, total, a quién puede pagar y cuándo vence. Los fondos **se quedan en la cuenta del usuario**; el contrato hace cumplir los límites.
2. **Lo grande espera la huella del usuario.** Un pago sobre el umbral queda pendiente hasta que el usuario lo aprueba con su passkey, y **la firma se verifica en la cadena** con el precompile P256 nativo de Monad.
3. **Cada pago deja un recibo, y la reputación solo cuenta a quienes pagaron.** Cualquiera puede escribir una reseña en ERC-8004, incluso con cuentas falsas; la reputación verificada ignora las de quienes nunca le pagaron al agente, y se puede exigir además que el humano detrás esté verificado.

## Probarlo

- **Demo en vivo:** https://aval-demo-alpha.vercel.app (código en `apps/demo`). Un botón crea una cuenta con una sola huella (sin frase secreta, sin extensión, sin necesitar MON) y se puede recorrer todo el flujo.
- **Relayer en vivo:** https://aval-relayer.vercel.app (`/health`, `/agent/info`).
- **Contratos verificados** en Monad testnet: ver [`contracts/README.md`](contracts/README.md).

```bash
npm install
npm run build:sdk      # el SDK se usa compilado
npm run dev            # la demo, en http://localhost:5173
```

Necesitas Node 22+ y, para una passkey real, un dispositivo con soporte PRF (en Chrome de escritorio, passkeys guardadas en el gestor de contraseñas de Google; también sirven iCloud Keychain y 1Password). Sin eso, la demo trae un **modo de prueba** claramente rotulado.

## Integrarlo (menos de 10 líneas)

```ts
import { createAval } from '@aval/sdk';

// El agente paga dentro de los límites que le dio el usuario…
await aval.permits.spend({ permitId, to: shop, amount: 10_000000n });
// …y lo que supera el umbral espera la huella del usuario.
const { requestId } = await aval.permits.requestSpend({ permitId, to: shop, amount: 80_000000n });
await userAval.permits.approve(requestId); // pide la huella y ejecuta el pago
```

Referencia completa en [`packages/sdk/README.md`](packages/sdk/README.md).

## Estructura

| Carpeta | Qué es |
|---|---|
| [`contracts/`](contracts/README.md) | Contratos en Solidity (Foundry): `PasskeyRegistry`, `AgentPermit`, `ReputationReader`, `TestUSD`. Verificación P256/WebAuthn con OpenZeppelin y el precompile de Monad. |
| [`packages/sdk/`](packages/sdk/README.md) | **`@aval/sdk`**: SDK en TypeScript (viem). Permisos, aprobaciones con passkey, recibos, reputación verificada, agentes ERC-8004 y cliente del relayer. |
| [`apps/relayer/`](apps/relayer/README.md) | Relayer que envía las firmas del usuario y paga el gas, con un agente de demostración. Protegido con límites, saldo mínimo y reintento de nonce. |
| [`apps/demo/`](apps/demo/README.md) | La demo: onboarding, permisos, agente en acción, aprobaciones, actividad, reputación e inspector para jueces. |

## Cómo está hecho

- **Cuenta del usuario:** [Mera](https://mera.category.xyz). La passkey (con la extensión PRF) deriva una cuenta EVM: sin seed phrase, sin servidor de custodia. La clave pública P256 de la misma passkey se captura en la **misma ceremonia** y se guarda onchain.
- **Aprobación humana:** una aserción WebAuthn firmada sobre el hash exacto del pago (EIP-712), verificada por `WebAuthn` y `P256` de OpenZeppelin, que usan el precompile `0x0100` de Monad.
- **Sin gas para el usuario:** todo lo que el usuario hace se firma (EIP-712 o ERC-2612) y lo envía el relayer.
- **Estado reconstruible desde la cadena:** los RPC públicos de Monad limitan `eth_getLogs` a 100 bloques, así que los contratos guardan índices por usuario y un libro de recibos. Con la misma passkey, en cualquier dispositivo, todo reaparece sin guardar nada en el navegador.
- **Agentes y reputación:** registros oficiales de ERC-8004 en Monad testnet, con un lector que filtra las reseñas por quienes pagaron.

## Pruebas

```bash
npm run test:sdk       # SDK: criptografía y flujo completo sobre una copia local de Monad testnet (anvil)
npm run test:relayer   # relayer: flujo sin MON, límites, reintentos, agente
npm run test:demo      # lógica de la interfaz
cd contracts && forge test    # contratos (y `--fork-url monad_testnet` para usar el precompile real)
```

Las pruebas de punta a punta levantan una copia local de Monad testnet con `anvil` y recorren el flujo contra los contratos desplegados; si `anvil` no está instalado, se saltan.

## Redes y direcciones

Monad testnet (chain ID 10143). Todo el dinero es de prueba.

| | Dirección |
|---|---|
| `PasskeyRegistry` | `0x0C46E673C0f852920e9F15902B0859358Eb53789` |
| `AgentPermit` | `0x00F0C1b1FB751c380dF0132001eab6ca110Fc2DA` |
| `ReputationReader` | `0x831EeA5808B40C2f1fE49d817B056D3d54E685D6` |
| `TestUSD` | `0xeD4Bb1e1926441461BcADA4BBF647Aba8574B3C5` |
| ERC-8004 Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Límites conocidos

Dicho con honestidad, porque importan:

- **Es un prototipo de testnet.** Los contratos no están auditados.
- **La reputación basada en pagos no es infalsificable:** un agente podría pagarse desde cuentas propias. Se encarece con un pago mínimo y se puede exigir un verificador de humanos, pero no se elimina.
- **ERC-8004 permite varias reseñas del mismo cliente** y promedia todas; hoy el lector no las deduplica.
- **El relayer** no tiene autenticación de usuario (confía en las firmas y en los límites) y sus límites por IP son aproximados cuando corre en varias instancias.
