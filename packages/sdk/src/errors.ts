import { BaseError, ContractFunctionRevertedError } from 'viem';

/** Error de Aval con un mensaje en español y el nombre del error del contrato, si lo hay. */
export class AvalError extends Error {
  readonly code: string;
  readonly args: readonly unknown[];
  constructor(code: string, message: string, args: readonly unknown[] = [], options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AvalError';
    this.code = code;
    this.args = args;
  }
}

const money = (v: unknown) => (typeof v === 'bigint' ? v.toString() : String(v));

const mensajes: Record<string, (a: readonly unknown[]) => string> = {
  InvalidTerms: () => 'Términos del permiso inválidos: revisa agente, token, límites y caducidad.',
  ExpiredSignature: () => 'La firma venció: genera otra con una fecha límite más lejana.',
  InvalidSignature: () => 'La firma no es válida, ya se usó o no corresponde a estos datos.',
  NotOwner: () => 'Solo el dueño del permiso puede hacer esto.',
  NotAgent: () => 'Solo el agente del permiso puede hacer esto.',
  PermitInactive: () => 'El permiso está revocado, vencido o no existe.',
  RecipientNotAllowed: () => 'El destinatario no está en la lista permitida del permiso.',
  ExceedsPerSpendLimit: (a) => `El monto (${money(a[0])}) supera el máximo por gasto (${money(a[1])}).`,
  ExceedsTotalLimit: (a) => `El monto (${money(a[0])}) supera lo que queda del permiso (${money(a[1])}).`,
  NeedsApproval: (a) => `El monto (${money(a[0])}) supera el umbral (${money(a[1])}): usa requestSpend y pide la aprobación del usuario.`,
  RequestNotPending: () => 'El pedido ya se ejecutó o no existe.',
  InvalidApproval: () => 'La aprobación con passkey no es válida para este pedido.',
  InvalidPublicKey: () => 'La clave pública no es un punto válido de la curva P-256.',
  FaucetLimitExceeded: () => 'El faucet entrega como máximo 1.000 tUSD por llamada.',
  ERC20InsufficientBalance: () => 'El dueño del permiso no tiene saldo suficiente del token.',
  ERC20InsufficientAllowance: () => 'El dueño debe autorizar al contrato AgentPermit a mover su token (approve o permit).',
};

/** Convierte cualquier error de viem en un `AvalError` legible. Los que no son de contrato pasan igual. */
export function explainError(error: unknown): unknown {
  if (error instanceof AvalError) return error;
  if (!(error instanceof BaseError)) return error;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    const nombre = revert.data?.errorName ?? revert.reason ?? 'Revert';
    const args = revert.data?.args ?? [];
    const texto = mensajes[nombre]?.(args) ?? `El contrato rechazó la operación (${nombre}).`;
    return new AvalError(nombre, texto, args, { cause: error });
  }
  return error;
}
