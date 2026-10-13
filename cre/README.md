# Vigilante de Aval (Chainlink CRE)

Un workflow de **Chainlink Runtime Environment (CRE)** que hace de **capa de orquestación de riesgo** para los agentes de Aval en Monad. En cada pago de un agente:

1. **Disparo:** el evento `Spent` de `AgentPermit` en Monad testnet (EVM log trigger).
2. **Lectura en la cadena:** los recibos recientes del dueño del permiso (`receiptsOf`) y el máximo por pago (`getPermit`).
3. **Detección determinista** ([`vigilante/analysis.ts`](vigilante/analysis.ts)), igual en todos los nodos:
   - **pagos divididos:** dos o más pagos del mismo permiso al mismo destinatario en 10 minutos que juntos superan el máximo por pago (lo que hizo un agente real con Qwen al toparse con el límite: partir 150 en 50 + 100) → nivel 2, **bloquear**;
   - **ráfaga:** tres o más pagos del mismo permiso en 10 minutos → nivel 1, **vigilar**.
4. **LLM:** **Qwen 3.8 Max** redacta la alerta en lenguaje claro (HTTP capability; los nodos comparten la respuesta en caché para llegar a consenso). Si Qwen falla, queda la explicación determinista: la decisión nunca depende del LLM.
5. **Escritura:** un **reporte firmado por la red de Chainlink** llega, a través del forwarder, a [`AvalRiskGuard`](../contracts/src/AvalRiskGuard.sol) en Monad.

El **agente de demostración respeta la alerta**: si está marcado para bloquear, no paga ni pide pagos (`AgentBlockedByGuard`). El vigilante **solo restringe**: no mueve fondos ni da permisos.

## Despliegue y prueba en Monad testnet

| | |
|---|---|
| `AvalRiskGuard` | `0xF31D199340894918f61A7C80864bA4E9332F28c7` (verificado), con el forwarder de simulación de CRE `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |
| Caso real | permiso #21: el agente pagó **60 + 60 tUSD** al mismo servicio con un máximo de 100 (`apps/relayer/scripts/split-payments.mjs`) |
| Simulación | `cre workflow simulate --broadcast` sobre el segundo pago → nivel 2, alerta redactada por Qwen y reporte escrito: tx `0x624b53f0148000584ccbdd5197b71fdc5a56ef3a49e729014df863f374fe311c` |
| Resultado onchain | `AvalRiskGuard.isBlocked(agente) = true`, con el motivo guardado |

## Ejecutar

Requisitos: CRE CLI (v1.30+ para Monad testnet), Bun 1.2.21+ y una cuenta de CRE (`cre login`).

```bash
cd cre
cp .env.example .env            # CRE_ETH_PRIVATE_KEY (testnet, con MON) y QWEN_API_KEY_ALL
bun install --cwd ./vigilante
cd vigilante && bun test && cd ..   # detección: 7 casos

# Simular sobre un pago real (hash e índice del evento que imprime split-payments.mjs)
cre workflow simulate vigilante --target staging-settings --non-interactive --trigger-index 0 \
  --evm-tx-hash <hash> --evm-event-index 0 --broadcast
```

Sin `--broadcast`, la simulación hace todo menos enviar la transacción del reporte.

**RPC:** `project.yaml` usa `https://rpc.ankr.com/monad_testnet` porque el RPC público de Monad estuvo caído durante las pruebas.

## Para producción

Desplegar `AvalRiskGuard` con el forwarder de producción (`RISK_GUARD_FORWARDER=0xF8344CFd5c43616a4366C34E3EEE75af79a74482`), fijar `setExpectedWorkflowOwner` con el dueño del workflow, guardar `QWEN_API_KEY` en el Vault DON y desplegar el workflow (`cre account access` para pedir acceso). En el relayer, `RISK_GUARD_ADDRESS` activa la comprobación del agente.
