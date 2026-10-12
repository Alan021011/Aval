# Indexador de Aval

Indexador de [Envio HyperIndex](https://docs.envio.dev) para Aval. Lee los eventos de los contratos de Aval y del Reputation Registry de ERC-8004 en Monad testnet y los deja en una base consultable por **GraphQL**. Su pieza principal es el **puntaje verificado** de cada agente: la reputación contando solo a quienes **de verdad le pagaron**.

## Por qué hace falta

El contrato `ReputationReader` ya filtra reseñas por pago, pero en la cadena solo puede mirar a 200 pagadores y no puede aplicar reglas más finas sin gastar gas en cada consulta. El indexador calcula el puntaje completo fuera de la cadena, con reglas más estrictas, y deja **todos los datos en bruto** para que cualquiera pueda comprobarlo.

## Qué indexa

| Contrato | Eventos | Para qué |
|---|---|---|
| `AgentPermit` | `PermitGranted`, `PermitRevoked`, `SpendRequested`, `Spent` | Permisos, pedidos de aprobación y **recibos** (quién le pagó a quién) |
| `PasskeyRegistry` | `PasskeyRegistered` | Clave de la huella de cada cuenta |
| `TestUSD` | `Transfer` | **Origen de los fondos**: quién fondeó primero a cada cuenta |
| Reputation Registry (ERC-8004) | `NewFeedback` | Las reseñas |

Además consulta (una lectura por reseña) el **Identity Registry** para saber qué billetera cobra por cada agente.

## Entidades

`Account` · `Permit` · `SpendRequest` · `Payment` · `PaidRelation` (cuánto le pagó cada cuenta a cada servicio) · `Agent` · `Feedback` · **`AgentScore`**. Están documentadas en [`schema.graphql`](schema.graphql).

## El puntaje verificado

Se calcula con una función pura, [`src/score.ts`](src/score.ts), con estas reglas:

1. **Solo cuenta quien pagó.** Una reseña de una cuenta sin recibo en Aval no cuenta, y tampoco la de quien pagó menos del mínimo (`minPaid`, 1 tUSD).
2. **No cuenta quien está relacionado con el servicio.** Si el propio servicio fue quien fondeó primero a esa cuenta (o es el servicio mismo), es un autopago: se descarta. Es la tercera capa de defensa contra reputación fabricada.
3. **Una reseña por persona.** El dueño de un permiso y su agente son la misma persona, y cada persona cuenta una vez, con su reseña más reciente. Mandar muchas reseñas no pesa más.
4. **Mínimo de personas distintas.** Con menos de `minHumans` (3) el estado es `Insufficient` (provisional); con tres o más, `Verified`.

Cada `AgentScore` guarda además lo que **no** se contó y por qué (`excludedNotPaid`, `excludedBelowMinPaid`, `excludedRelated`), el promedio sin ningún filtro (`rawAverage`, lo que mostraría ERC-8004 a secas) y la **concentración** (`topClientShare`: qué parte del dinero viene de una sola persona).

Se recalcula **desde cero** con cada reseña o pago nuevo, así queda bien aunque lleguen en cualquier orden (por ejemplo, alguien que reseña antes de pagar empieza a contar cuando paga).

### Comprobar al indexador

No hay que creerle: el SDK trae la misma función y la prueba con los mismos casos (`test/vectors.json`).

```ts
import { createIndexerClient } from '@aval/sdk';

const indexer = createIndexerClient({ url: 'https://<tu-indexador>/v1/graphql' });

const score = await indexer.agentScore(2090n);          // lo que dice el indexador
const check = await indexer.verifyAgentScore(2090n);    // recalcula con las reseñas y pagos en bruto
console.log(check?.matches, check?.differences);        // true, []
```

## Qué no cubre (limitaciones)

- **Fondeo de varios saltos.** Detecta que el servicio fondeó *directamente* a un cliente. Si lo hace por una cadena de cuentas intermedias, no lo ve.
- **Reseñas revocadas.** No procesa `FeedbackRevoked` (la firma de ese evento no se pudo verificar porque el contrato no está verificado en Sourcify).
- **Billetera del agente.** Se lee del Identity Registry al llegar cada reseña. Si el agente la cambia después, se refleja en la siguiente reseña, no antes.
- **Escala.** Recalcular el puntaje lee todas las reseñas del agente: está bien para miles, no para millones.

## Ejecutar

Envio **no funciona en Windows nativo**: hay que usar WSL 2. Necesita Node 22+, pnpm y Docker (para su base de datos).

```bash
cp .env.example .env     # y pon tu ENVIO_API_TOKEN (gratis en https://envio.dev/app/api-tokens)
pnpm install
pnpm codegen             # genera los tipos desde config.yaml y schema.graphql
pnpm test                # pruebas con eventos simulados
pnpm dev                 # corre contra Monad testnet; GraphQL en http://localhost:8080 (contraseña: testing)
```

Un ejemplo de consulta:

```graphql
{
  AgentScore(order_by: { updatedAt: desc }) {
    agentId status verifiedAverage verifiedHumans rawAverage excludedNotPaid excludedRelated topClientShare
  }
  Payment(order_by: { timestamp: desc }, limit: 5) { permit_id payee amount approvedByUser }
}
```

## Pruebas

`pnpm test`: 9 casos del puntaje (los mismos del SDK) y 3 de punta a punta con eventos simulados (permiso, pago con aprobación, autopago descartado y reseña que llega antes que el pago). La única llamada de red es la billetera del agente #2090 en el Identity Registry de Monad testnet.

Además hay una prueba **con datos reales** (`test/live.test.ts`): procesa desde HyperSync todos los bloques de Monad testnet desde el despliegue de los contratos y comprueba que cada pago pertenece a un permiso indexado y que lo gastado por permiso coincide con la suma de sus pagos. No necesita Docker pero sí `ENVIO_API_TOKEN` (sin token se salta):

```bash
set -a && . ./.env && set +a && pnpm vitest run test/live.test.ts
```

## Despliegue

Se despliega en **Envio Cloud** (organización `alan021011`, indexador `aval-indexer`, plan de desarrollo, acceso público) con despliegue automático desde la rama `main`, carpeta `indexer`. Cada push que cambie algo ahí genera una versión nueva. Para ver el estado y los logs:

```bash
npx envio-cloud indexer get aval-indexer
npx envio-cloud deployment status aval-indexer <commit>
npx envio-cloud deployment logs aval-indexer <commit>
```

## Contratos

Las direcciones y los bloques de inicio están en [`config.yaml`](config.yaml) y salen de [`contracts/deployments/monad-testnet.json`](../contracts/deployments/monad-testnet.json). Si se redespliega `AgentPermit`, hay que actualizar la dirección y el bloque ahí.
