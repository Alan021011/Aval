// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Identity Registry mínimo: solo la billetera de cada agente.
contract MockIdentityRegistry {
    mapping(uint256 agentId => address) public getAgentWallet;

    function setAgentWallet(uint256 agentId, address wallet) external {
        getAgentWallet[agentId] = wallet;
    }
}

/// Reputation Registry mínimo que imita lo observado en Monad testnet: cualquiera puede reseñar, `getSummary`
/// devuelve el promedio entero y revierte si la lista de clientes está vacía.
contract MockReputationRegistry {
    address public immutable identityRegistry;

    mapping(uint256 agentId => mapping(address client => int128[])) private _values;

    constructor(address identityRegistry_) {
        identityRegistry = identityRegistry_;
    }

    function getIdentityRegistry() external view returns (address) {
        return identityRegistry;
    }

    function giveFeedback(uint256 agentId, int128 value) external {
        _values[agentId][msg.sender].push(value);
    }

    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata, string calldata)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        require(clientAddresses.length > 0, "clientAddresses required");
        int256 sum;
        for (uint256 i; i < clientAddresses.length; ++i) {
            int128[] storage values = _values[agentId][clientAddresses[i]];
            for (uint256 j; j < values.length; ++j) {
                sum += values[j];
                ++count;
            }
        }
        if (count > 0) summaryValue = int128(sum / int256(uint256(count)));
        return (count, summaryValue, 0);
    }
}
