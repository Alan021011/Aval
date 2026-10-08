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

/// @notice Fuente de verificación de humanos que elige quien consulta la reputación (por ejemplo, una app con
/// "1 documento = 1 cuenta" o un registro de identidad onchain).
interface IClientVerifier {
    /// @return true si `account` pertenece a una persona verificada.
    function isVerified(address account) external view returns (bool);
}

/// @title ReputationReader
/// @notice Reputación verificada de agentes ERC-8004. Defensa en capas contra reputación fabricada:
/// 1. Solo cuentan las reseñas de cuentas que de verdad le pagaron al agente a través de `AgentPermit`,
///    con un pago mínimo opcional (`minPaid`).
/// 2. Opcionalmente, solo cuentan si el humano detrás del pago está verificado por un `IClientVerifier`
///    que elige quien consulta. Así, crear muchas cuentas no sirve si cada una necesita una identidad real.
/// @dev El pago cuenta si fue a la billetera que el agente tiene registrada en el Identity Registry.
/// La reseña puede dejarla el dueño del permiso o su agente; el verificador se aplica al dueño.
/// Se consideran como máximo `MAX_CLIENTS` pagadores (los primeros en pagar); para más, el indexador calcula
/// el puntaje completo fuera de la cadena.
contract ReputationReader {
    uint256 public constant MAX_CLIENTS = 200;

    IReputationRegistry public immutable reputation;
    IIdentityRegistry public immutable identity;
    AgentPermit public immutable permits;

    struct Summary {
        uint64 count; // número de reseñas consideradas
        int128 value; // promedio que calcula ERC-8004, con `decimals` decimales
        uint8 decimals;
        uint256 verifiedClients; // clientes que pasaron los filtros y entraron en la consulta
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
        returns (Summary memory)
    {
        return verifiedSummary(agentId, tag1, tag2, minPaid, IClientVerifier(address(0)));
    }

    /// @notice Igual, pero además solo cuenta a clientes cuyo humano está verificado por `verifier`.
    /// Con `verifier` en la dirección cero no se exige verificación.
    function verifiedSummary(
        uint256 agentId,
        string calldata tag1,
        string calldata tag2,
        uint256 minPaid,
        IClientVerifier verifier
    ) public view returns (Summary memory summary) {
        address[] memory clients = verifiedClients(agentId, minPaid, verifier);
        // ERC-8004 rechaza la consulta sin clientes; sin clientes verificados el resumen es cero.
        if (clients.length == 0) return summary;

        (summary.count, summary.value, summary.decimals) = reputation.getSummary(agentId, clients, tag1, tag2);
        summary.verifiedClients = clients.length;
    }

    /// @notice Cuentas que le pagaron al agente al menos `minPaid`, hasta `MAX_CLIENTS`.
    function verifiedClients(uint256 agentId, uint256 minPaid) external view returns (address[] memory) {
        return verifiedClients(agentId, minPaid, IClientVerifier(address(0)));
    }

    /// @notice Igual, pero además filtra por humanos verificados si `verifier` no es la dirección cero.
    function verifiedClients(uint256 agentId, uint256 minPaid, IClientVerifier verifier)
        public
        view
        returns (address[] memory clients)
    {
        address wallet = identity.getAgentWallet(agentId);
        if (wallet == address(0)) return clients;

        address[] memory candidates = permits.payers(wallet, 0, MAX_CLIENTS);
        clients = new address[](candidates.length);
        uint256 found = 0;
        for (uint256 i; i < candidates.length; ++i) {
            if (_counts(wallet, candidates[i], minPaid, verifier)) clients[found++] = candidates[i];
        }
        assembly ("memory-safe") {
            mstore(clients, found)
        }
    }

    function _counts(address wallet, address client, uint256 minPaid, IClientVerifier verifier)
        private
        view
        returns (bool)
    {
        if (permits.paidAmount(wallet, client) < minPaid) return false;
        if (address(verifier) == address(0)) return true;
        return verifier.isVerified(permits.payerOwner(wallet, client));
    }
}
