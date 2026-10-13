// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MemoryVault} from "../src/MemoryVault.sol";

/// Despliega `MemoryVault` (almacenamiento remoto no confiable de la memoria cifrada) en Monad testnet.
/// Uso: forge script script/DeployMemory.s.sol --rpc-url monad_testnet --broadcast
contract DeployMemory is Script {
    function run() external {
        require(block.chainid == 10143, "Este script es solo para Monad testnet");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        MemoryVault vault = new MemoryVault();
        vm.stopBroadcast();
        console.log("MemoryVault ", address(vault));
    }
}
