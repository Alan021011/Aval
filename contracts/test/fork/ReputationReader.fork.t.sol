// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentPermit} from "../../src/AgentPermit.sol";
import {PasskeyRegistry} from "../../src/PasskeyRegistry.sol";
import {IIdentityRegistry, IReputationRegistry, ReputationReader} from "../../src/ReputationReader.sol";
import {TestUSD} from "../../src/TestUSD.sol";

interface IIdentityRegistryWrite {
    function register() external returns (uint256 agentId);
}

interface IReputationRegistryWrite {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

/// Prueba contra los registros ERC-8004 reales de Monad testnet, sobre una copia local de la red.
/// Se salta si no corre sobre Monad testnet. Para correrla:
/// `forge test --fork-url monad_testnet --mc ReputationReaderForkTest`.
contract ReputationReaderForkTest is Test {
    uint256 private constant MONAD_TESTNET = 10143;
    address private constant IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address private constant REPUTATION = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    AgentPermit private permits;
    TestUSD private usd;
    ReputationReader private reader;

    function setUp() public {
        if (block.chainid != MONAD_TESTNET) vm.skip(true);

        permits = new AgentPermit(new PasskeyRegistry());
        usd = new TestUSD();
        reader = new ReputationReader(IReputationRegistry(REPUTATION), permits);
    }

    function test_VerifiedSummaryAgainstRealRegistries() public {
        assertEq(address(reader.identity()), IDENTITY);

        // Un agente de servicio se registra en el Identity Registry real.
        address serviceWallet = makeAddr("agente-de-servicio");
        vm.prank(serviceWallet);
        uint256 agentId = IIdentityRegistryWrite(IDENTITY).register();
        assertEq(IIdentityRegistry(IDENTITY).getAgentWallet(agentId), serviceWallet);

        // Un cliente paga al agente a través de un permiso y su agente deja una reseña de 95.
        address owner = makeAddr("cliente");
        address clientAgent = makeAddr("cliente-agente");
        usd.faucet(owner, 50e6);
        vm.startPrank(owner);
        usd.approve(address(permits), 50e6);
        uint256 permitId = permits.grant(
            AgentPermit.Terms({
                agent: clientAgent,
                agentId: 0,
                token: address(usd),
                maxPerSpend: 50e6,
                maxTotal: 50e6,
                approvalThreshold: type(uint128).max,
                expiresAt: uint64(block.timestamp + 1 days)
            }),
            new address[](0)
        );
        vm.stopPrank();
        vm.prank(clientAgent);
        permits.spend(permitId, serviceWallet, 50e6, "servicio");

        vm.prank(clientAgent);
        IReputationRegistryWrite(REPUTATION).giveFeedback(agentId, 95, 0, "calidad", "", "", "", bytes32(0));

        // Dos cuentas falsas reseñan con 0 sin haber pagado.
        for (uint256 i; i < 2; ++i) {
            vm.prank(makeAddr(string.concat("sybil-", vm.toString(i))));
            IReputationRegistryWrite(REPUTATION).giveFeedback(agentId, 0, 0, "calidad", "", "", "", bytes32(0));
        }

        ReputationReader.Summary memory s = reader.verifiedSummary(agentId, "calidad", "", 0);
        assertEq(s.count, 1);
        assertEq(s.value, 95);
        assertEq(s.verifiedClients, 2);
    }
}
