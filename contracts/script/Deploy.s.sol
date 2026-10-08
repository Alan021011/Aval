// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentPermit} from "../src/AgentPermit.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";
import {IReputationRegistry, ReputationReader} from "../src/ReputationReader.sol";
import {TestUSD} from "../src/TestUSD.sol";

/// Despliega Aval en Monad testnet.
/// Uso: forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
/// Lee la clave del desplegador de `PRIVATE_KEY` en `contracts/.env` (no se sube a git).
contract Deploy is Script {
    /// Reputation Registry de ERC-8004 en Monad testnet.
    address internal constant ERC8004_REPUTATION = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    function run() external {
        require(block.chainid == 10143, "Este script es solo para Monad testnet");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        PasskeyRegistry passkeys = new PasskeyRegistry();
        AgentPermit permits = new AgentPermit(passkeys);
        TestUSD usd = new TestUSD();
        ReputationReader reader = new ReputationReader(IReputationRegistry(ERC8004_REPUTATION), permits);

        vm.stopBroadcast();

        console.log("PasskeyRegistry  ", address(passkeys));
        console.log("AgentPermit      ", address(permits));
        console.log("TestUSD          ", address(usd));
        console.log("ReputationReader ", address(reader));
    }
}
