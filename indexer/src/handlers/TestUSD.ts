import { indexer } from "envio";
import { newAccount } from "../accounts";
import { ZERO_ADDRESS } from "../constants";

/**
 * Origen de los fondos: se guarda quién le mandó tUSD por primera vez a cada cuenta. Un servicio que se manda dinero
 * a sí mismo para fabricar clientes deja esa huella (el cliente fue fondeado por el propio servicio).
 */
indexer.onEvent({ contract: "TestUSD", event: "Transfer", fields: { block: ["timestamp"] } }, async ({ event, context }) => {
  const { from, to } = event.params;
  if (to === ZERO_ADDRESS) return; // quemar tokens no fondea a nadie
  const account = await context.Account.getOrCreate(newAccount(to));
  if (account.firstFundedBy) return;
  context.Account.set({ ...account, firstFundedBy: from, firstFundedAt: BigInt(event.block.timestamp) });
});
