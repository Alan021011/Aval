// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentPermit} from "../src/AgentPermit.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";
import {IClientVerifier, IReputationRegistry, ReputationReader} from "../src/ReputationReader.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {MockClientVerifier, MockIdentityRegistry, MockReputationRegistry} from "./utils/MockERC8004.sol";

contract ReputationReaderTest is Test {
    uint256 private constant SERVICE_AGENT_ID = 42;

    MockIdentityRegistry private identity;
    MockReputationRegistry private reputation;
    AgentPermit private permits;
    TestUSD private usd;
    ReputationReader private reader;

    address private serviceWallet = makeAddr("agente-de-servicio");

    function setUp() public {
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry(address(identity));
        permits = new AgentPermit(new PasskeyRegistry());
        usd = new TestUSD();
        reader = new ReputationReader(IReputationRegistry(address(reputation)), permits);
        identity.setAgentWallet(SERVICE_AGENT_ID, serviceWallet);
    }

    function test_ReadsIdentityRegistryFromReputationRegistry() public view {
        assertEq(address(reader.identity()), address(identity));
    }

    function test_ZeroWhenNobodyPaid() public {
        vm.prank(makeAddr("sybil"));
        reputation.giveFeedback(SERVICE_AGENT_ID, 100);

        ReputationReader.Summary memory s = reader.verifiedSummary(SERVICE_AGENT_ID, "", "", 0);
        assertEq(s.count, 0);
        assertEq(s.verifiedClients, 0);
    }

    function test_ZeroWhenAgentHasNoWallet() public view {
        ReputationReader.Summary memory s = reader.verifiedSummary(999, "", "", 0);
        assertEq(s.count, 0);
    }

    /// Un cliente real pagó y dejó 40. Tres cuentas falsas dejaron 100 sin pagar. El resumen crudo diría 85;
    /// el verificado dice 40.
    function test_IgnoresFeedbackFromAccountsThatNeverPaid() public {
        (address client, address clientAgent) = _pay("cliente", 30e6);
        vm.prank(client);
        reputation.giveFeedback(SERVICE_AGENT_ID, 40);

        for (uint256 i; i < 3; ++i) {
            vm.prank(makeAddr(string.concat("sybil-", vm.toString(i))));
            reputation.giveFeedback(SERVICE_AGENT_ID, 100);
        }

        ReputationReader.Summary memory s = reader.verifiedSummary(SERVICE_AGENT_ID, "", "", 0);
        assertEq(s.count, 1);
        assertEq(s.value, 40);
        assertEq(s.verifiedClients, 2, "el dueno y su agente cuentan como clientes");

        address[] memory clients = reader.verifiedClients(SERVICE_AGENT_ID, 0);
        assertEq(clients[0], client);
        assertEq(clients[1], clientAgent);
    }

    function test_FeedbackFromThePayingAgentCounts() public {
        (, address clientAgent) = _pay("cliente", 30e6);
        vm.prank(clientAgent);
        reputation.giveFeedback(SERVICE_AGENT_ID, 75);

        assertEq(reader.verifiedSummary(SERVICE_AGENT_ID, "", "", 0).value, 75);
    }

    function test_MinPaidFiltersSmallPayers() public {
        (address small,) = _pay("pequeno", 1e6);
        (address big,) = _pay("grande", 90e6);
        vm.prank(small);
        reputation.giveFeedback(SERVICE_AGENT_ID, 0);
        vm.prank(big);
        reputation.giveFeedback(SERVICE_AGENT_ID, 80);

        assertEq(reader.verifiedSummary(SERVICE_AGENT_ID, "", "", 0).value, 40);
        ReputationReader.Summary memory s = reader.verifiedSummary(SERVICE_AGENT_ID, "", "", 50e6);
        assertEq(s.count, 1);
        assertEq(s.value, 80);
    }

    function test_PaymentToAnotherAddressDoesNotCount() public {
        address elsewhere = makeAddr("otra-direccion");
        (address client,) = _payTo("cliente", elsewhere, 30e6);
        vm.prank(client);
        reputation.giveFeedback(SERVICE_AGENT_ID, 90);

        assertEq(reader.verifiedSummary(SERVICE_AGENT_ID, "", "", 0).count, 0);
    }

    // ---------------------------------------------------------------- capa 2: humanos verificados

    /// Autopago: un atacante sin verificar crea tres cuentas, le paga a su propio agente y deja 100. Una
    /// persona verificada paga y su agente deja 60. Sin verificador el promedio sale 90; con verificador, 60.
    function test_Verifier_ExcludesSelfDealingAccounts() public {
        MockClientVerifier verifier = new MockClientVerifier();
        (address human, address humanAgent) = _pay("persona-real", 20e6);
        verifier.verify(human);
        vm.prank(humanAgent);
        reputation.giveFeedback(SERVICE_AGENT_ID, 60);

        for (uint256 i; i < 3; ++i) {
            (address fake,) = _pay(string.concat("cuenta-falsa-", vm.toString(i)), 20e6);
            vm.prank(fake);
            reputation.giveFeedback(SERVICE_AGENT_ID, 100);
        }

        assertEq(reader.verifiedSummary(SERVICE_AGENT_ID, "", "", 0).value, 90);

        ReputationReader.Summary memory s =
            reader.verifiedSummary(SERVICE_AGENT_ID, "", "", 0, IClientVerifier(address(verifier)));
        assertEq(s.count, 1);
        assertEq(s.value, 60);
        assertEq(s.verifiedClients, 2, "la persona y su agente");
    }

    function test_Verifier_AgentCountsThroughItsVerifiedOwner() public {
        MockClientVerifier verifier = new MockClientVerifier();
        (address human, address humanAgent) = _pay("persona-real", 20e6);
        verifier.verify(human);

        address[] memory clients = reader.verifiedClients(SERVICE_AGENT_ID, 0, IClientVerifier(address(verifier)));
        assertEq(clients.length, 2);
        assertEq(clients[1], humanAgent);
        assertEq(permits.payerOwner(serviceWallet, humanAgent), human);
    }

    function test_Verifier_ZeroWhenNobodyIsVerified() public {
        MockClientVerifier verifier = new MockClientVerifier();
        (address client,) = _pay("cliente", 20e6);
        vm.prank(client);
        reputation.giveFeedback(SERVICE_AGENT_ID, 90);

        ReputationReader.Summary memory s =
            reader.verifiedSummary(SERVICE_AGENT_ID, "", "", 0, IClientVerifier(address(verifier)));
        assertEq(s.count, 0);
        assertEq(s.verifiedClients, 0);
    }

    function test_Verifier_CombinesWithMinPaid() public {
        MockClientVerifier verifier = new MockClientVerifier();
        (address small,) = _pay("verificado-pequeno", 1e6);
        (address big,) = _pay("verificado-grande", 90e6);
        verifier.verify(small);
        verifier.verify(big);
        vm.prank(small);
        reputation.giveFeedback(SERVICE_AGENT_ID, 0);
        vm.prank(big);
        reputation.giveFeedback(SERVICE_AGENT_ID, 80);

        ReputationReader.Summary memory s =
            reader.verifiedSummary(SERVICE_AGENT_ID, "", "", 50e6, IClientVerifier(address(verifier)));
        assertEq(s.count, 1);
        assertEq(s.value, 80);
    }

    // ---------------------------------------------------------------- utilidades

    function _pay(string memory name, uint128 amount) private returns (address owner, address agent) {
        return _payTo(name, serviceWallet, amount);
    }

    /// Un usuario crea un permiso para su propio agente, y ese agente le paga a `to`.
    function _payTo(string memory name, address to, uint128 amount) private returns (address owner, address agent) {
        owner = makeAddr(name);
        agent = makeAddr(string.concat(name, "-agente"));
        usd.faucet(owner, amount);

        vm.startPrank(owner);
        usd.approve(address(permits), amount);
        uint256 id = permits.grant(
            AgentPermit.Terms({
                agent: agent,
                agentId: 0,
                token: address(usd),
                maxPerSpend: amount,
                maxTotal: amount,
                approvalThreshold: type(uint128).max,
                expiresAt: uint64(block.timestamp + 1 days)
            }),
            new address[](0)
        );
        vm.stopPrank();

        vm.prank(agent);
        permits.spend(id, to, amount, "servicio");
    }
}
