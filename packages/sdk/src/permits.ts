import {
  type Address,
  type Hex,
  concat,
  hexToBytes,
  isHex,
  keccak256,
  pad,
  parseEventLogs,
  stringToHex,
} from 'viem';
import { agentPermitAbi } from './abi.js';
import { type Ctx, type Sent, read, requireWallet, send } from './context.js';
import { AvalError } from './errors.js';
import { type WebAuthnAuth, buildAuth } from './webauthn.js';

const MAX_UINT128 = (1n << 128n) - 1n;

/** Límites que el usuario le da a un agente. Los montos van en unidades del token (6 decimales en tUSD). */
export type GrantInput = {
  /** Dirección con la que firma el agente. */
  agent: Address;
  /** ID del agente en ERC-8004 (informativo). */
  agentId?: bigint;
  /** Token que se puede gastar. Por defecto, el dólar de prueba del despliegue. */
  token?: Address;
  maxPerSpend: bigint;
  maxTotal: bigint;
  /** Los gastos mayores a esto esperan la aprobación con passkey del usuario. `null` = nunca piden aprobación. */
  approvalThreshold: bigint | null;
  /** Caducidad como fecha UNIX en segundos, o `expiresIn` en segundos desde ahora. */
  expiresAt?: bigint;
  expiresIn?: number;
  /** Destinatarios permitidos. Vacío o ausente = cualquiera. */
  recipients?: Address[];
};

export type Permit = {
  owner: Address;
  revoked: boolean;
  anyRecipient: boolean;
  spent: bigint;
  terms: {
    agent: Address;
    agentId: bigint;
    token: Address;
    maxPerSpend: bigint;
    maxTotal: bigint;
    approvalThreshold: bigint;
    expiresAt: bigint;
  };
};

export type SpendRequest = {
  permitId: bigint;
  to: Address;
  amount: bigint;
  /** 0 = ninguno, 1 = pendiente, 2 = ejecutado. */
  status: number;
  ref: Hex;
};

/** Permiso firmado por el usuario, listo para que un relayer lo envíe y pague el gas. */
export type SignedGrant = {
  owner: Address;
  input: ResolvedGrant;
  deadline: bigint;
  signature: Hex;
};

export type SignedRevoke = { permitId: bigint; deadline: bigint; signature: Hex };

type ResolvedGrant = {
  agent: Address;
  agentId: bigint;
  token: Address;
  maxPerSpend: bigint;
  maxTotal: bigint;
  approvalThreshold: bigint;
  expiresAt: bigint;
  recipients: Address[];
};

const grantTypes = {
  Grant: [
    { name: 'owner', type: 'address' },
    { name: 'agent', type: 'address' },
    { name: 'agentId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'maxPerSpend', type: 'uint128' },
    { name: 'maxTotal', type: 'uint128' },
    { name: 'approvalThreshold', type: 'uint128' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'recipientsHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

const revokeTypes = {
  Revoke: [
    { name: 'permitId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** Un `ref` corto en texto se convierte a bytes32; un hex de 32 bytes pasa tal cual. */
export function toRef(ref?: string | Hex): Hex {
  if (ref === undefined || ref === '') return pad('0x', { size: 32 });
  if (isHex(ref) && ref.length === 66) return ref;
  if (new TextEncoder().encode(ref).length > 32) throw new AvalError('RefTooLong', 'La referencia debe caber en 32 bytes.');
  return stringToHex(ref, { size: 32 });
}

/** Igual que `keccak256(abi.encodePacked(address[]))` del contrato: cada dirección ocupa 32 bytes. */
export function recipientsHash(recipients: readonly Address[]): Hex {
  return keccak256(concat(recipients.map((a) => pad(a, { size: 32 }))));
}

export function createPermits(ctx: Ctx) {
  const address = ctx.addresses.agentPermit;
  const now = () => BigInt(Math.floor(Date.now() / 1000));

  const resolve = (input: GrantInput): ResolvedGrant => {
    const token = input.token ?? ctx.addresses.testUsd;
    if (!token) throw new AvalError('NoToken', 'Indica el `token` del permiso: esta red no tiene dólar de prueba.');
    if (input.expiresAt === undefined && input.expiresIn === undefined) {
      throw new AvalError('NoExpiry', 'Indica `expiresIn` (segundos) o `expiresAt` (fecha UNIX).');
    }
    return {
      agent: input.agent,
      agentId: input.agentId ?? 0n,
      token,
      maxPerSpend: input.maxPerSpend,
      maxTotal: input.maxTotal,
      approvalThreshold: input.approvalThreshold === null ? MAX_UINT128 : input.approvalThreshold,
      expiresAt: input.expiresAt ?? now() + BigInt(input.expiresIn as number),
      recipients: input.recipients ?? [],
    };
  };

  const termsOf = (g: ResolvedGrant) => ({
    agent: g.agent,
    agentId: g.agentId,
    token: g.token,
    maxPerSpend: g.maxPerSpend,
    maxTotal: g.maxTotal,
    approvalThreshold: g.approvalThreshold,
    expiresAt: g.expiresAt,
  });

  const domain = () => ({
    name: 'Aval AgentPermit',
    version: '1',
    chainId: ctx.addresses.chainId,
    verifyingContract: address,
  });

  const nonceOf = (owner: Address) =>
    read<bigint>(ctx, { address, abi: agentPermitAbi, functionName: 'nonces', args: [owner] });

  const idFrom = (sent: Sent): bigint => {
    const [log] = parseEventLogs({ abi: agentPermitAbi, logs: sent.receipt.logs, eventName: 'PermitGranted' });
    if (!log) throw new AvalError('NoEvent', 'No se encontró el evento PermitGranted en el recibo.');
    return log.args.permitId;
  };

  const challenge = (requestId: bigint) =>
    read<Hex>(ctx, { address, abi: agentPermitAbi, functionName: 'approvalChallenge', args: [requestId] });

  const signApproval = async (
    requestId: bigint,
    options: { credentialId?: string; rpId?: string } = {},
  ): Promise<WebAuthnAuth> => {
    const assertion = await ctx.assertionProvider({
      ...options,
      challenge: hexToBytes(await challenge(requestId)),
    });
    return buildAuth(assertion);
  };

  const submitApproval = (requestId: bigint, auth: WebAuthnAuth) =>
    send(ctx, { address, abi: agentPermitAbi, functionName: 'approveSpend', args: [requestId, auth] });

  return {
    // ----------------------------------------------------------- el usuario crea y revoca

    /** El usuario crea un permiso desde su cuenta. Devuelve el ID. */
    async grant(input: GrantInput): Promise<{ permitId: bigint } & Sent> {
      const g = resolve(input);
      const sent = await send(ctx, {
        address,
        abi: agentPermitAbi,
        functionName: 'grant',
        args: [termsOf(g), g.recipients],
      });
      return { permitId: idFrom(sent), ...sent };
    },

    /** El usuario firma el permiso sin enviar nada (no necesita MON). Un relayer lo envía con `relayGrant`. */
    async signGrant(input: GrantInput, options: { deadline?: bigint } = {}): Promise<SignedGrant> {
      const wallet = requireWallet(ctx);
      const g = resolve(input);
      const owner = wallet.account.address;
      const deadline = options.deadline ?? now() + 3600n;
      const signature = await wallet.signTypedData({
        account: wallet.account,
        domain: domain(),
        types: grantTypes,
        primaryType: 'Grant',
        message: {
          owner,
          agent: g.agent,
          agentId: g.agentId,
          token: g.token,
          maxPerSpend: g.maxPerSpend,
          maxTotal: g.maxTotal,
          approvalThreshold: g.approvalThreshold,
          expiresAt: g.expiresAt,
          recipientsHash: recipientsHash(g.recipients),
          nonce: await nonceOf(owner),
          deadline,
        },
      });
      return { owner, input: g, deadline, signature };
    },

    /** Un relayer envía el permiso firmado por el usuario y paga el gas. */
    async relayGrant(signed: SignedGrant): Promise<{ permitId: bigint } & Sent> {
      const sent = await send(ctx, {
        address,
        abi: agentPermitAbi,
        functionName: 'grantBySig',
        args: [signed.owner, termsOf(signed.input), signed.input.recipients, signed.deadline, signed.signature],
      });
      return { permitId: idFrom(sent), ...sent };
    },

    async revoke(permitId: bigint): Promise<Sent> {
      return send(ctx, { address, abi: agentPermitAbi, functionName: 'revoke', args: [permitId] });
    },

    async signRevoke(permitId: bigint, options: { deadline?: bigint } = {}): Promise<SignedRevoke> {
      const wallet = requireWallet(ctx);
      const deadline = options.deadline ?? now() + 3600n;
      const signature = await wallet.signTypedData({
        account: wallet.account,
        domain: domain(),
        types: revokeTypes,
        primaryType: 'Revoke',
        message: { permitId, nonce: await nonceOf(wallet.account.address), deadline },
      });
      return { permitId, deadline, signature };
    },

    async relayRevoke(signed: SignedRevoke): Promise<Sent> {
      return send(ctx, {
        address,
        abi: agentPermitAbi,
        functionName: 'revokeBySig',
        args: [signed.permitId, signed.deadline, signed.signature],
      });
    },

    // ----------------------------------------------------------- el agente gasta

    /** El agente gasta dentro de los límites y bajo el umbral. */
    async spend(input: { permitId: bigint; to: Address; amount: bigint; ref?: string | Hex }): Promise<Sent> {
      return send(ctx, {
        address,
        abi: agentPermitAbi,
        functionName: 'spend',
        args: [input.permitId, input.to, input.amount, toRef(input.ref)],
      });
    },

    /** El agente pide un gasto sobre el umbral. Devuelve el `requestId` que el usuario debe aprobar. */
    async requestSpend(input: {
      permitId: bigint;
      to: Address;
      amount: bigint;
      ref?: string | Hex;
    }): Promise<{ requestId: bigint } & Sent> {
      const sent = await send(ctx, {
        address,
        abi: agentPermitAbi,
        functionName: 'requestSpend',
        args: [input.permitId, input.to, input.amount, toRef(input.ref)],
      });
      const [log] = parseEventLogs({ abi: agentPermitAbi, logs: sent.receipt.logs, eventName: 'SpendRequested' });
      if (!log) throw new AvalError('NoEvent', 'No se encontró el evento SpendRequested en el recibo.');
      return { requestId: log.args.requestId, ...sent };
    },

    // ----------------------------------------------------------- el usuario aprueba con su passkey

    /** Hash que el usuario firma con su passkey para aprobar un pedido. */
    challenge,

    /** Pide la huella al usuario y devuelve la aprobación, sin enviarla. */
    signApproval,

    /** Envía una aprobación ya firmada. Puede hacerlo cualquiera (por ejemplo, un relayer). */
    submitApproval,

    /** Pide la huella y ejecuta el gasto pendiente. */
    async approve(requestId: bigint, options: { credentialId?: string; rpId?: string } = {}): Promise<Sent> {
      return submitApproval(requestId, await signApproval(requestId, options));
    },

    // ----------------------------------------------------------- consultas

    async get(permitId: bigint): Promise<Permit> {
      return read<Permit>(ctx, { address, abi: agentPermitAbi, functionName: 'getPermit', args: [permitId] });
    },

    async getRequest(requestId: bigint): Promise<SpendRequest> {
      return read<SpendRequest>(ctx, { address, abi: agentPermitAbi, functionName: 'getRequest', args: [requestId] });
    },

    /** Cuánto queda por gastar (0 si está revocado o vencido). */
    async remaining(permitId: bigint): Promise<bigint> {
      return read<bigint>(ctx, { address, abi: agentPermitAbi, functionName: 'remaining', args: [permitId] });
    },

    async isAllowedRecipient(permitId: bigint, to: Address): Promise<boolean> {
      return read<boolean>(ctx, { address, abi: agentPermitAbi, functionName: 'isAllowedRecipient', args: [permitId, to] });
    },

    /** Recibo acumulado: cuánto le pagó `client` a `payee` a través de permisos. */
    async paidAmount(payee: Address, client: Address): Promise<bigint> {
      return read<bigint>(ctx, { address, abi: agentPermitAbi, functionName: 'paidAmount', args: [payee, client] });
    },

  };
}

export type Permits = ReturnType<typeof createPermits>;
