# Aval

**Dale a tu agente de IA un permiso, no tus llaves.**

Aval es una capa de confianza para agentes de IA en [Monad](https://monad.xyz). La **passkey del usuario es la raíz** de todo: los permisos que le da a un agente, las aprobaciones de lo importante y la reputación de los agentes. Es un protocolo con su SDK, no una app de consumo. Hecho para el track *Trust, Identity & AI Infrastructure* de Monad Metropolis.

> ### For judges (EN) — try it in 3 minutes
> **Aval lets a user give an AI agent a spending *permit* instead of their keys.** Small payments go through within on-chain limits; big ones wait for the user's **fingerprint**, verified **on-chain with Monad's P256 precompile (`0x0100`)**; and an agent's reputation only counts reviews from clients who **actually paid** it (ERC-8004).
>
> 1. Open **https://aval-demo-alpha.vercel.app** on a device with a passkey (phone, or desktop Chrome with Google Password Manager / iCloud Keychain / 1Password). No passkey? Use the clearly labelled *test mode* on the landing page.
> 2. **"Empezar con mi huella"** → one passkey prompt creates the account, funds it with test dollars and registers the passkey. **No seed phrase, no extension, 0 MON needed** (gas is sponsored by the relayer).
> 3. **"Crear permiso"** (defaults are fine) → in *"Tu agente en acción"* press, in order: **Que pague** (passes within limits) · **Que lo intente** (blocked by the contract, explained in plain words) · **Que pida permiso** (goes to *Aprobaciones*) → **"Aprobar con mi huella"** (passkey prompt; the WebAuthn signature is verified on-chain) · **Que reseñe**.
> 4. **"Pídele algo a tu agente"** → **"Pedírselo a Qwen"**: Qwen 3.8 Max checks the permit, the verified reputation and your shared memory, tries to pay, reads the contract's rejection and asks for your approval. Each step and its reasoning are shown.
> 5. Optional: **"Memoria de tu agente"** → open it (no extra prompt if your passkey returned the memory key at login), save a private note and a shared one, press **"Que el agente la lea"**, then **"Revocar acceso"** and read again: the agent's old key no longer works.
> 6. Open **Inspector** (top right) to see what the user view hides: contracts, P256 key, tx hashes and timings. Then press **"Simular dispositivo nuevo"** and log in again with the same passkey: balance, permits and activity are **rebuilt from the chain**.
>
> Measured in production: account ready in **3.7 s with 1 passkey prompt**, first confirmed transaction in **2 s**, **0 MON** spent by the user. Contracts are verified (exact match) on Monad's Sourcify, visible in the [MonadVision](https://testnet.monadvision.com) explorer (addresses below). Bounty notes: see [Bounties](#bounties).

## Qué resuelve

Hoy, para que un agente de IA pague por ti, le das tu llave o tu tarjeta. Si se equivoca o lo hackean, pierdes todo; no hay límites ni forma de saber si ese agente merece confianza. Con Aval:

1. **El usuario le da al agente un permiso con límites:** máximo por pago, total, a quién puede pagar y cuándo vence. Los fondos **se quedan en la cuenta del usuario**; el contrato hace cumplir los límites.
2. **Lo grande espera la huella del usuario.** Un pago sobre el umbral queda pendiente hasta que el usuario lo aprueba con su passkey, y **la firma se verifica en la cadena** con el precompile P256 nativo de Monad.
3. **Cada pago deja un recibo, y la reputación solo cuenta a quienes pagaron.** Cualquiera puede escribir una reseña en ERC-8004, incluso con cuentas falsas; la reputación verificada ignora las de quienes nunca le pagaron al agente, y se puede exigir además que el humano detrás esté verificado.

## Probarlo

- **Demo en vivo:** https://aval-demo-alpha.vercel.app (código en `apps/demo`). Un botón crea una cuenta con una sola huella (sin frase secreta, sin extensión, sin necesitar MON) y se puede recorrer todo el flujo.
- **Relayer en vivo:** https://aval-relayer.vercel.app (`/health`, `/agent/info`).
- **Contratos verificados** (coincidencia exacta) en el Sourcify de Monad, visibles en el explorador [MonadVision](https://testnet.monadvision.com): ver [`contracts/README.md`](contracts/README.md).

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
| [`contracts/`](contracts/README.md) | Contratos en Solidity (Foundry): `PasskeyRegistry`, `AgentPermit`, `ReputationReader`, `MemoryVault`, `AvalRiskGuard`, `TestUSD`. Verificación P256/WebAuthn con OpenZeppelin y el precompile de Monad. |
| [`packages/sdk/`](packages/sdk/README.md) | **`@aval/sdk`**: SDK en TypeScript (viem). Permisos, aprobaciones con passkey, recibos, reputación verificada, agentes ERC-8004 y cliente del relayer. |
| [`apps/relayer/`](apps/relayer/README.md) | Relayer que envía las firmas del usuario y paga el gas, con un agente de demostración que piensa con **Qwen 3.8 Max**. Protegido con límites, saldo mínimo y reintento de nonce. |
| [`apps/demo/`](apps/demo/README.md) | La demo: onboarding, permisos, agente en acción, aprobaciones, actividad, reputación e inspector para jueces. |
| [`cre/`](cre/README.md) | **Vigilante con Chainlink CRE**: workflow en TypeScript que reacciona a los pagos, detecta riesgos, consulta a Qwen y escribe alertas firmadas en `AvalRiskGuard`. |
| [`indexer/`](indexer/README.md) | Indexador de **Envio HyperIndex**: permisos, pagos, reseñas y el **puntaje verificado** de cada agente (solo clientes que pagaron, sin autopagos, una reseña por persona). El SDK lo consulta y puede **recalcular el puntaje** para comprobarlo. |

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
cd indexer && pnpm test       # indexador (en WSL/Linux/macOS): eventos simulados y, con ENVIO_API_TOKEN, datos reales de Monad testnet
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
| `MemoryVault` | `0x58Ff042D37cd4Aa9477cd55A6c59C1e4b9418881` |
| `AvalRiskGuard` (Chainlink CRE) | `0xF31D199340894918f61A7C80864bA4E9332F28c7` |
| ERC-8004 Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Bounties

| Bounty | Qué demuestra Aval | Dónde verlo |
|---|---|---|
| **Mera · Best UX** | Cuenta nueva con **una sola ceremonia** de passkey (PRF): sin frase secreta, sin extensión, sin correo ni contraseña y **sin MON**. Medido en producción: lista en 3,7 s con 1 verificación; primera transacción en 2 s. La misma passkey firma la aprobación que se verifica en la cadena. | Demo en vivo; el cartel verde del tablero y las métricas del inspector. Código: `apps/demo/src/lib/passkey.ts` |
| **Mera · One Passkey, Many Keys** | La passkey hace **trabajo que no es de cuenta**: un segundo secreto PRF con su propio salt (`aval/memory/v1`), pedido en la **misma ceremonia** que la cuenta (`eval.second`), es la raíz de una **memoria del agente cifrada**. Con HKDF salen una clave privada y una **clave por agente y versión**: compartir es darle al agente la clave de su parte; **revocar** es volver a cifrar con la versión siguiente (la clave vieja deja de abrirla). AES-GCM en el dispositivo; lo cifrado vive en `MemoryVault` (almacenamiento remoto no confiable, en la cadena), así que otro dispositivo con la misma passkey lo descifra. Nada sensible en disco ni en el servidor. | Demo: tarjeta «Memoria de tu agente» y sección del inspector. Código: `packages/sdk/src/memory.ts`, `contracts/src/MemoryVault.sol`, `apps/demo/src/state/useMemory.ts` |
| **Qwen 3.8 Max · agentes** | Un agente con **Qwen 3.8 Max** (Qwen Cloud, modo *thinking*) que **planifica y ejecuta en varios pasos** con 6 herramientas reales sobre Monad: lee su permiso onchain, la reputación verificada, la memoria cifrada que el usuario le compartió, paga, pide aprobación y reseña. Los **rechazos del contrato vuelven a Qwen** con los montos en tUSD y Qwen cambia de plan (por ejemplo, ante `NeedsApproval` pide la huella del usuario en vez de insistir). La demo muestra su razonamiento y cada paso. | Demo: tarjeta «Pídele algo a tu agente». Código: `apps/relayer/src/brain.ts`, `apps/relayer/src/qwen.ts` |
| **Chainlink CRE** | Un workflow de CRE (`cre/`) que **orquesta el riesgo** de los agentes en Monad: se dispara con cada pago (`Spent`), lee recibos y límites en la cadena, detecta **pagos divididos** para esquivar el máximo (lo que hizo un agente real con Qwen), le pide a **Qwen 3.8 Max** que redacte la alerta y envía un **reporte firmado por la red de Chainlink** a `AvalRiskGuard`. El agente consulta ese contrato antes de pagar y se niega si está marcado. Simulado con `--broadcast` en Monad testnet sobre un caso real: la alerta quedó en la cadena. | [`cre/README.md`](cre/README.md), `contracts/src/AvalRiskGuard.sol` |
| **Envio · Best Use** | Indexador HyperIndex con entidades derivadas: relaciones de pago cliente-servicio, origen de fondos y el **`AgentScore`** (reputación solo de quienes pagaron, sin autopagos, una por persona, mínimo de personas distintas y concentración del volumen). El SDK puede **recalcular el puntaje** con los mismos datos (`verifyAgentScore`): no hay que creerle al indexador. | [`indexer/`](indexer/README.md). Probado con **datos reales de Monad testnet** vía HyperSync (`indexer/test/live.test.ts`: 335 eventos, 21 pagos). Ver la nota de despliegue abajo. |

**Nota sobre el despliegue en Envio Cloud:** el indexador llegó a desplegarse y a responder por GraphQL, pero se detuvo al llegar a las reseñas. Al intentar desplegar la versión corregida, Envio Cloud dejó de registrar los pushes de GitHub: solo recibió el primero, y lo mismo pasó con un indexador nuevo, una rama nueva, un repo nuevo y la app de GitHub reinstalada. Lo reportamos a Envio. El código y las pruebas con datos reales están en el repo, y se despliega con un push en cuanto la plataforma lo acepte. Detalles en [`indexer/README.md`](indexer/README.md).

## Límites conocidos

Dicho con honestidad, porque importan:

- **Es un prototipo de testnet.** Los contratos no están auditados. Pagar no cuesta nada (el faucet de tUSD es público), así que el pago mínimo de la reputación (1 tUSD por defecto en el SDK) no es una barrera económica real. Además, `spend` acepta montos en 0 y `MAX_CLIENTS = 200` toma solo a los primeros 200 pagadores: son cambios de contrato pendientes para después del hackathon.
- **La reputación basada en pagos no es infalsificable:** un agente podría pagarse desde cuentas propias. Se encarece con un pago mínimo, se puede exigir un verificador de humanos y el indexador descarta a los clientes que fondeó el propio servicio, pero no se elimina (por ejemplo, con una cadena de cuentas intermedias).
- **ERC-8004 permite varias reseñas del mismo cliente** y promedia todas. El contrato `ReputationReader` (el que usa la demo) no las deduplica; el **indexador sí** (una por persona, la más reciente).
- **Memoria cifrada:** al compartir, la clave de esa parte viaja al agente (es el propósito de compartir); el agente de demostración la usa en la consulta y no la guarda. Revocar protege lo que se escriba después, no lo que el agente ya leyó. Algunos autenticadores no devuelven el segundo secreto PRF en la ceremonia de la cuenta: en ese caso abrir la memoria pide una huella aparte. Cada casillero admite hasta 4 KB.
- **El agente con Qwen** depende de una API externa (Qwen Cloud): cada tarea tarda de 10 a 30 s y tiene un plazo de 50 s; si Qwen no responde, la demo lo dice. Sus reglas (por ejemplo, no dividir un pago para esquivar un límite) son una capa extra: la defensa real es el contrato.
- **El relayer** no tiene autenticación de usuario (confía en las firmas y en los límites). Las rutas del agente de demostración (`/agent/*`) solo reciben un `permitId` u `owner`, que son públicos en la cadena: cualquiera podría hacer que el agente de demo gaste un permiso ajeno dentro de sus límites o llene sus aprobaciones. Para producción deben exigir una firma EIP-712 del dueño y sus límites por IP son aproximados cuando corre en varias instancias. El faucet da 500 tUSD una vez por hora por dirección (hasta 10 por red).
