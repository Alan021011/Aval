import type { Address } from 'viem';

/** Direcciones de los contratos de Aval en una red. */
export type AvalAddresses = {
  chainId: number;
  passkeyRegistry: Address;
  agentPermit: Address;
  reputationReader: Address;
  /** Dólar de prueba, el token por defecto para los permisos. Opcional en otras redes. */
  testUsd?: Address;
};

/** Registros ERC-8004 oficiales de Monad testnet. */
export const erc8004MonadTestnet = {
  identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
} as const satisfies Record<string, Address>;

/** Despliegue de Aval en Monad testnet (chain ID 10143). Verificado en Sourcify. */
export const monadTestnet: AvalAddresses = {
  chainId: 10143,
  passkeyRegistry: '0x0C46E673C0f852920e9F15902B0859358Eb53789',
  agentPermit: '0x6d2A62614AF055921308c01745343413FCF8AA2C',
  reputationReader: '0x52231e5FC27CBe9B0D466b9A4EecF19B9705A7d3',
  testUsd: '0xeD4Bb1e1926441461BcADA4BBF647Aba8574B3C5',
};

/** Precompile P256 de Monad (EIP-7951). */
export const P256_PRECOMPILE: Address = '0x0000000000000000000000000000000000000100';
