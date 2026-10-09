// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentPermit} from "../src/AgentPermit.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";
import {IReputationRegistry, ReputationReader} from "../src/ReputationReader.sol";

/// Vuelve a desplegar solo `AgentPermit` y `ReputationReader`, reutilizando el `PasskeyRegistry` y el `TestUSD` que ya
/// existen en Monad testnet (para que las passkeys ya registradas y los saldos se conserven).
/// Uso: forge script script/DeployPermits.s.sol --rpc-url monad_testnet --broadcast
contract DeployPermits is Script {
    /// PasskeyRegistry ya desplegado en Monad testnet.
    address internal constant PASSKEY_REGISTRY = 0x0C46E673C0f852920e9F15902B0859358Eb53789;
    /// Reputation Registry de ERC-8004 en Monad testnet.
    address internal constant ERC8004_REPUTATION = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    function run() external {
        require(block.chainid == 10143, "Este script es solo para Monad testnet");
        require(PASSKEY_REGISTRY.code.length > 0, "No hay PasskeyRegistry en esa direccion");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        AgentPermit permits = new AgentPermit(PasskeyRegistry(PASSKEY_REGISTRY));
        ReputationReader reader = new ReputationReader(IReputationRegistry(ERC8004_REPUTATION), permits);

        vm.stopBroadcast();

        console.log("AgentPermit      ", address(permits));
        console.log("ReputationReader ", address(reader));
    }
}
