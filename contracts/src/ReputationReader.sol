// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentPermit} from "./AgentPermit.sol";

/// Parte del Reputation Registry de ERC-8004 que se usa aquí.
interface IReputationRegistry {
    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);

    function getIdentityRegistry() external view returns (address);
}

/// Parte del Identity Registry de ERC-8004 que se usa aquí.
interface IIdentityRegistry {
    function getAgentWallet(uint256 agentId) external view returns (address);
}

/// @title ReputationReader
/// @notice Reputación verificada de agentes ERC-8004: resume solo las reseñas de cuentas que de verdad le
/// pagaron al agente a través de `AgentPermit`. Cualquiera puede escribir una reseña en ERC-8004; este lector
/// ignora las que no vienen de un cliente con recibo.
/// @dev El pago cuenta si fue a la billetera que el agente tiene registrada en el Identity Registry.
/// Para no tener un costo sin límite, se consideran como máximo `MAX_CLIENTS` pagadores (los primeros en
/// pagar). Para agentes con más clientes, el indexador calcula el puntaje completo fuera de la cadena.
/// Limitación conocida: un agente podría pagarse a sí mismo desde cuentas propias; `minPaid` encarece ese
/// fraude, pero no lo elimina.
contract ReputationReader {
    uint256 public constant MAX_CLIENTS = 200;

    IReputationRegistry public immutable reputation;
    IIdentityRegistry public immutable identity;
    AgentPermit public immutable permits;

    struct Summary {
        uint64 count; // número de reseñas consideradas
        int128 value; // promedio que calcula ERC-8004, con `decimals` decimales
        uint8 decimals;
        uint256 verifiedClients; // clientes con recibo que entraron en la consulta
    }

    constructor(IReputationRegistry reputation_, AgentPermit permits_) {
        reputation = reputation_;
        identity = IIdentityRegistry(reputation_.getIdentityRegistry());
        permits = permits_;
    }

    /// @notice Resumen de reseñas del agente, contando solo a clientes que le pagaron al menos `minPaid`.
    /// @param tag1 Filtro de etiqueta de ERC-8004 ("" para todas).
    /// @param tag2 Segundo filtro de etiqueta ("" para todas).
    function verifiedSummary(uint256 agentId, string calldata tag1, string calldata tag2, uint256 minPaid)
        external
        view
        returns (Summary memory summary)
    {
        address[] memory clients = verifiedClients(agentId, minPaid);
        // ERC-8004 rechaza la consulta sin clientes; sin clientes verificados el resumen es cero.
        if (clients.length == 0) return summary;

        (summary.count, summary.value, summary.decimals) = reputation.getSummary(agentId, clients, tag1, tag2);
        summary.verifiedClients = clients.length;
    }

    /// @notice Cuentas que le pagaron al agente al menos `minPaid`, hasta `MAX_CLIENTS`.
    function verifiedClients(uint256 agentId, uint256 minPaid) public view returns (address[] memory clients) {
        address wallet = identity.getAgentWallet(agentId);
        if (wallet == address(0)) return clients;

        address[] memory candidates = permits.payers(wallet, 0, MAX_CLIENTS);
        clients = new address[](candidates.length);
        uint256 found;
        for (uint256 i; i < candidates.length; ++i) {
            if (permits.paidAmount(wallet, candidates[i]) >= minPaid) clients[found++] = candidates[i];
        }
        assembly ("memory-safe") {
            mstore(clients, found)
        }
    }
}
