/** Cuenta sin datos todavía. Los campos opcionales se escriben explícitos porque el esquema los exige. */
export const newAccount = (id: string) => ({
  id,
  hasPasskey: false,
  passkeyX: undefined,
  passkeyY: undefined,
  passkeyRegisteredAt: undefined,
  firstFundedBy: undefined,
  firstFundedAt: undefined,
});
