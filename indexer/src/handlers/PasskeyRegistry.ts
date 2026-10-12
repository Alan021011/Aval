import { indexer } from "envio";
import { newAccount } from "../accounts";

indexer.onEvent({ contract: "PasskeyRegistry", event: "PasskeyRegistered", fields: { block: ["timestamp"] } }, async ({ event, context }) => {
  const { owner, x, y } = event.params;
  const account = await context.Account.getOrCreate(newAccount(owner));
  context.Account.set({
    ...account,
    hasPasskey: true,
    passkeyX: x,
    passkeyY: y,
    passkeyRegisteredAt: BigInt(event.block.timestamp),
  });
});
