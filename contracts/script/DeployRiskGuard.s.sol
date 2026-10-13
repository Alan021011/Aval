// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AvalRiskGuard} from "../src/AvalRiskGuard.sol";

/// Despliega `AvalRiskGuard` en Monad testnet, apuntando al forwarder de Chainlink CRE.
/// Por defecto usa el de simulación (MockKeystoneForwarder), que es el que llama a `onReport` cuando se corre
/// `cre workflow simulate --broadcast`. Para producción: `RISK_GUARD_FORWARDER=0xF8344CFd5c43616a4366C34E3EEE75af79a74482`.
/// Uso: forge script script/DeployRiskGuard.s.sol --rpc-url monad_testnet --broadcast
contract DeployRiskGuard is Script {
    address internal constant SIMULATION_FORWARDER = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;

    function run() external {
        require(block.chainid == 10143, "Este script es solo para Monad testnet");
        address forwarder = vm.envOr("RISK_GUARD_FORWARDER", SIMULATION_FORWARDER);
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        AvalRiskGuard guard = new AvalRiskGuard(forwarder);
        vm.stopBroadcast();
        console.log("AvalRiskGuard ", address(guard));
        console.log("forwarder     ", forwarder);
    }
}
