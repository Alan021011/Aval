// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// Interfaz que exige el forwarder de Chainlink CRE para entregar reportes.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title AvalRiskGuard
/// @notice Recibe, a través de Chainlink CRE, las alertas de un "vigilante" que observa los pagos de los agentes de Aval
/// en Monad. El vigilante (un workflow de CRE) lee la cadena, detecta patrones riesgosos (por ejemplo, pagos divididos
/// para esquivar un límite), le pide a un LLM una explicación y entrega aquí un reporte firmado por la red de Chainlink.
/// @dev El guardián **solo restringe**: guarda un nivel de riesgo por agente que los agentes y el relayer respetan antes
/// de pagar. No mueve fondos ni da permisos. Solo el forwarder configurado puede escribir, y opcionalmente solo un
/// workflow de un dueño concreto. Los reportes más viejos que el último guardado se descartan.
contract AvalRiskGuard is IReceiver, Ownable {
    /// Niveles: 0 = sin alerta, 1 = vigilar (se avisa al usuario), 2 = bloquear (el agente no paga).
    uint8 public constant BLOCK_LEVEL = 2;

    struct Alert {
        uint8 level;
        uint64 observedAt;
        string reason;
    }

    /// Forwarder de Chainlink: el de simulación (MockKeystoneForwarder) o el de producción (KeystoneForwarder).
    address public forwarder;
    /// Dueño del workflow de CRE cuyos reportes se aceptan (cero = cualquiera que pase por el forwarder).
    address public expectedWorkflowOwner;

    mapping(address agent => Alert) private _alerts;

    event AlertUpdated(address indexed agent, uint8 level, uint64 observedAt, string reason);
    event ForwarderUpdated(address forwarder);
    event ExpectedWorkflowOwnerUpdated(address owner);
    event StaleReportIgnored(address indexed agent, uint64 observedAt, uint64 current);

    error InvalidSender(address sender);
    error InvalidWorkflowOwner(address received);
    error InvalidLevel(uint8 level);
    error InvalidMetadata();

    constructor(address forwarder_) Ownable(msg.sender) {
        forwarder = forwarder_;
        emit ForwarderUpdated(forwarder_);
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert InvalidSender(msg.sender);
        if (expectedWorkflowOwner != address(0)) {
            // metadata = workflowId (32) ‖ workflowName (10) ‖ workflowOwner (20) [‖ reportId (2) en producción]
            if (metadata.length < 62) revert InvalidMetadata();
            address workflowOwner = address(bytes20(metadata[42:62]));
            if (workflowOwner != expectedWorkflowOwner) revert InvalidWorkflowOwner(workflowOwner);
        }

        (address agent, uint8 level, uint64 observedAt, string memory reason) =
            abi.decode(report, (address, uint8, uint64, string));
        if (level > BLOCK_LEVEL) revert InvalidLevel(level);

        Alert storage current = _alerts[agent];
        if (observedAt <= current.observedAt) {
            emit StaleReportIgnored(agent, observedAt, current.observedAt);
            return;
        }
        _alerts[agent] = Alert(level, observedAt, reason);
        emit AlertUpdated(agent, level, observedAt, reason);
    }

    /// @notice La alerta vigente de un agente (nivel 0 si no tiene).
    function alertOf(address agent) external view returns (Alert memory) {
        return _alerts[agent];
    }

    /// @notice ¿Debe el agente abstenerse de pagar?
    function isBlocked(address agent) external view returns (bool) {
        return _alerts[agent].level >= BLOCK_LEVEL;
    }

    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderUpdated(forwarder_);
    }

    function setExpectedWorkflowOwner(address owner_) external onlyOwner {
        expectedWorkflowOwner = owner_;
        emit ExpectedWorkflowOwnerUpdated(owner_);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
