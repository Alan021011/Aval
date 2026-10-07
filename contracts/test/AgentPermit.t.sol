// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {AgentPermit} from "../src/AgentPermit.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {PasskeyTestBase} from "./utils/PasskeyTestBase.sol";

contract AgentPermitTest is PasskeyTestBase {
    bytes32 private constant GRANT_TYPEHASH = keccak256(
        "Grant(address owner,address agent,uint256 agentId,address token,uint128 maxPerSpend,uint128 maxTotal,uint128 approvalThreshold,uint64 expiresAt,bytes32 recipientsHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant REVOKE_TYPEHASH = keccak256("Revoke(uint256 permitId,uint256 nonce,uint256 deadline)");
    bytes32 private constant TOKEN_PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    PasskeyRegistry private registry;
    AgentPermit private permits;
    TestUSD private usd;

    uint256 private passkeyPk = 0xA11CE;
    address private owner;
    uint256 private ownerPk;
    address private agent = makeAddr("agent");
    address private shop = makeAddr("shop");
    address private relayer = makeAddr("relayer");

    function setUp() public {
        registry = new PasskeyRegistry();
        permits = new AgentPermit(registry);
        usd = new TestUSD();
        (owner, ownerPk) = makeAddrAndKey("mera-owner");

        (bytes32 x, bytes32 y) = _passkeyPublicKey(passkeyPk);
        vm.prank(owner);
        registry.register(x, y);

        usd.faucet(owner, 1_000e6);
        vm.prank(owner);
        usd.approve(address(permits), type(uint256).max);
    }

    // ---------------------------------------------------------------- crear y revocar

    function test_Grant() public {
        uint256 id = _grantDefault();

        AgentPermit.Permit memory p = permits.getPermit(id);
        assertEq(p.owner, owner);
        assertEq(p.terms.agent, agent);
        assertEq(p.terms.agentId, 7);
        assertFalse(p.anyRecipient);
        assertTrue(permits.isAllowedRecipient(id, shop));
        assertFalse(permits.isAllowedRecipient(id, makeAddr("otro")));
        assertEq(permits.remaining(id), 300e6);
    }

    function test_RevertWhen_TermsAreInvalid() public {
        AgentPermit.Terms memory t = _terms();
        t.maxPerSpend = t.maxTotal + 1;
        _expectInvalidTerms(t);

        t = _terms();
        t.expiresAt = uint64(block.timestamp);
        _expectInvalidTerms(t);

        t = _terms();
        t.agent = address(0);
        _expectInvalidTerms(t);

        t = _terms();
        t.agent = owner;
        _expectInvalidTerms(t);
    }

    /// Flujo sin gas para el usuario: firma la autorización del token (ERC-2612) y el permiso (EIP-712), y un
    /// relayer envía ambas transacciones.
    function test_GrantBySig_GaslessFlow() public {
        address freshOwner;
        uint256 freshPk;
        (freshOwner, freshPk) = makeAddrAndKey("nuevo-usuario");
        usd.faucet(freshOwner, 500e6);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signTokenPermit(freshPk, freshOwner, 300e6, deadline);
        AgentPermit.Terms memory t = _terms();
        bytes memory sig = _signGrant(freshPk, freshOwner, t, _shopOnly(), 0, deadline);

        vm.startPrank(relayer);
        usd.permit(freshOwner, address(permits), 300e6, deadline, v, r, s);
        uint256 id = permits.grantBySig(freshOwner, t, _shopOnly(), deadline, sig);
        vm.stopPrank();

        vm.prank(agent);
        permits.spend(id, shop, 40e6, "pedido-1");
        assertEq(usd.balanceOf(shop), 40e6);
        assertEq(freshOwner.balance, 0, "el usuario nunca necesito MON");
    }

    function test_RevertWhen_GrantBySigIsReplayed() public {
        uint256 deadline = block.timestamp + 1 hours;
        AgentPermit.Terms memory t = _terms();
        bytes memory sig = _signGrant(ownerPk, owner, t, _shopOnly(), 0, deadline);
        permits.grantBySig(owner, t, _shopOnly(), deadline, sig);

        vm.expectRevert(AgentPermit.InvalidSignature.selector);
        permits.grantBySig(owner, t, _shopOnly(), deadline, sig);
    }

    function test_RevertWhen_GrantBySigHasOtherRecipients() public {
        uint256 deadline = block.timestamp + 1 hours;
        AgentPermit.Terms memory t = _terms();
        bytes memory sig = _signGrant(ownerPk, owner, t, _shopOnly(), 0, deadline);
        address[] memory attacker = new address[](1);
        attacker[0] = makeAddr("atacante");

        vm.expectRevert(AgentPermit.InvalidSignature.selector);
        permits.grantBySig(owner, t, attacker, deadline, sig);
    }

    function test_Revoke() public {
        uint256 id = _grantDefault();
        vm.prank(owner);
        permits.revoke(id);

        assertEq(permits.remaining(id), 0);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentPermit.PermitInactive.selector, id));
        permits.spend(id, shop, 10e6, "");
    }

    function test_RevertWhen_RevokeIsNotOwner() public {
        uint256 id = _grantDefault();
        vm.prank(agent);
        vm.expectRevert(AgentPermit.NotOwner.selector);
        permits.revoke(id);
    }

    function test_RevokeBySig() public {
        uint256 id = _grantDefault();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = _digest(permits.DOMAIN_SEPARATOR(), keccak256(abi.encode(REVOKE_TYPEHASH, id, 0, deadline)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);

        vm.prank(relayer);
        permits.revokeBySig(id, deadline, abi.encodePacked(r, s, v));
        assertTrue(permits.getPermit(id).revoked);
    }

    // ---------------------------------------------------------------- gastar dentro de los límites

    function test_Spend() public {
        uint256 id = _grantDefault();

        vm.expectEmit(address(permits));
        emit AgentPermit.Spent(id, agent, shop, owner, address(usd), 30e6, "pedido-1", 0);
        vm.prank(agent);
        permits.spend(id, shop, 30e6, "pedido-1");

        assertEq(usd.balanceOf(shop), 30e6);
        assertEq(permits.remaining(id), 270e6);
        assertEq(permits.paidAmount(shop, owner), 30e6);
        assertEq(permits.paidAmount(shop, agent), 30e6);

        assertEq(permits.payerCount(shop), 2);
        address[] memory page = permits.payers(shop, 0, 10);
        assertEq(page.length, 2);
        assertEq(page[0], owner);
        assertEq(page[1], agent);

        // Un segundo pago no duplica a los pagadores.
        vm.prank(agent);
        permits.spend(id, shop, 10e6, "pedido-2");
        assertEq(permits.payerCount(shop), 2);
        assertEq(permits.paidAmount(shop, owner), 40e6);
    }

    function test_RevertWhen_CallerIsNotAgent() public {
        uint256 id = _grantDefault();
        vm.prank(makeAddr("intruso"));
        vm.expectRevert(AgentPermit.NotAgent.selector);
        permits.spend(id, shop, 10e6, "");
    }

    function test_RevertWhen_RecipientIsNotAllowed() public {
        uint256 id = _grantDefault();
        address other = makeAddr("otro");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentPermit.RecipientNotAllowed.selector, other));
        permits.spend(id, other, 10e6, "");
    }

    function test_AnyRecipientWhenListIsEmpty() public {
        vm.prank(owner);
        uint256 id = permits.grant(_terms(), new address[](0));
        address other = makeAddr("otro");

        vm.prank(agent);
        permits.spend(id, other, 10e6, "");
        assertEq(usd.balanceOf(other), 10e6);
    }

    function test_RevertWhen_AboveThresholdWithoutApproval() public {
        uint256 id = _grantDefault();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentPermit.NeedsApproval.selector, 80e6, 50e6));
        permits.spend(id, shop, 80e6, "");
    }

    function test_RevertWhen_ExceedsPerSpendLimit() public {
        uint256 id = _grantDefault();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentPermit.ExceedsPerSpendLimit.selector, 101e6, 100e6));
        permits.spend(id, shop, 101e6, "");
    }

    function test_RevertWhen_ExceedsTotalLimit() public {
        uint256 id = _grantDefault();
        vm.startPrank(agent);
        for (uint256 i; i < 6; ++i) {
            permits.spend(id, shop, 50e6, "");
        }
        vm.expectRevert(abi.encodeWithSelector(AgentPermit.ExceedsTotalLimit.selector, 1e6, 0));
        permits.spend(id, shop, 1e6, "");
        vm.stopPrank();
    }

    function test_RevertWhen_PermitExpired() public {
        uint256 id = _grantDefault();
        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentPermit.PermitInactive.selector, id));
        permits.spend(id, shop, 10e6, "");
    }

    /// Por más que el agente intente, nunca gasta más que el total ni mueve más de lo registrado.
    function testFuzz_SpentNeverExceedsTotal(uint128[8] memory amounts) public {
        uint256 id = _grantDefault();
        for (uint256 i; i < amounts.length; ++i) {
            vm.prank(agent);
            try permits.spend(id, shop, amounts[i] % 120e6, "") {} catch {}
        }
        AgentPermit.Permit memory p = permits.getPermit(id);
        assertLe(p.spent, p.terms.maxTotal);
        assertEq(usd.balanceOf(shop), p.spent);
    }

    // ---------------------------------------------------------------- aprobación con passkey

    function test_RequestAndApproveSpend() public {
        uint256 id = _grantDefault();
        vm.prank(agent);
        uint256 requestId = permits.requestSpend(id, shop, 80e6, "pedido-grande");
        assertEq(uint8(permits.getRequest(requestId).status), uint8(AgentPermit.RequestStatus.Pending));

        WebAuthn.WebAuthnAuth memory auth = _approve(passkeyPk, requestId);
        vm.prank(relayer);
        permits.approveSpend(requestId, auth);

        assertEq(usd.balanceOf(shop), 80e6);
        assertEq(uint8(permits.getRequest(requestId).status), uint8(AgentPermit.RequestStatus.Executed));
    }

    function test_RevertWhen_ApprovalIsReused() public {
        uint256 id = _grantDefault();
        vm.prank(agent);
        uint256 requestId = permits.requestSpend(id, shop, 80e6, "");
        WebAuthn.WebAuthnAuth memory auth = _approve(passkeyPk, requestId);
        permits.approveSpend(requestId, auth);

        vm.expectRevert(abi.encodeWithSelector(AgentPermit.RequestNotPending.selector, requestId));
        permits.approveSpend(requestId, auth);
    }

    function test_RevertWhen_ApprovalComesFromAnotherPasskey() public {
        uint256 id = _grantDefault();
        vm.prank(agent);
        uint256 requestId = permits.requestSpend(id, shop, 80e6, "");

        WebAuthn.WebAuthnAuth memory auth = _approve(0xB0B, requestId);
        vm.expectRevert(AgentPermit.InvalidApproval.selector);
        permits.approveSpend(requestId, auth);
    }

    function test_RevertWhen_ApprovalBelongsToAnotherRequest() public {
        uint256 id = _grantDefault();
        vm.startPrank(agent);
        uint256 small = permits.requestSpend(id, shop, 60e6, "");
        uint256 big = permits.requestSpend(id, shop, 100e6, "");
        vm.stopPrank();

        WebAuthn.WebAuthnAuth memory authForSmall = _approve(passkeyPk, small);
        vm.expectRevert(AgentPermit.InvalidApproval.selector);
        permits.approveSpend(big, authForSmall);
    }

    function test_RevertWhen_ApprovedAfterRevoke() public {
        uint256 id = _grantDefault();
        vm.prank(agent);
        uint256 requestId = permits.requestSpend(id, shop, 80e6, "");
        WebAuthn.WebAuthnAuth memory auth = _approve(passkeyPk, requestId);
        vm.prank(owner);
        permits.revoke(id);

        vm.expectRevert(abi.encodeWithSelector(AgentPermit.PermitInactive.selector, id));
        permits.approveSpend(requestId, auth);
    }

    // ---------------------------------------------------------------- utilidades

    function _terms() private view returns (AgentPermit.Terms memory) {
        return AgentPermit.Terms({
            agent: agent,
            agentId: 7,
            token: address(usd),
            maxPerSpend: 100e6,
            maxTotal: 300e6,
            approvalThreshold: 50e6,
            expiresAt: uint64(block.timestamp + 1 days)
        });
    }

    function _shopOnly() private view returns (address[] memory recipients) {
        recipients = new address[](1);
        recipients[0] = shop;
    }

    function _grantDefault() private returns (uint256) {
        vm.prank(owner);
        return permits.grant(_terms(), _shopOnly());
    }

    function _expectInvalidTerms(AgentPermit.Terms memory t) private {
        vm.prank(owner);
        vm.expectRevert(AgentPermit.InvalidTerms.selector);
        permits.grant(t, _shopOnly());
    }

    function _approve(uint256 pk, uint256 requestId) private view returns (WebAuthn.WebAuthnAuth memory) {
        return _assertion(pk, abi.encodePacked(permits.approvalChallenge(requestId)), UP_UV);
    }

    function _signGrant(
        uint256 pk,
        address account,
        AgentPermit.Terms memory t,
        address[] memory recipients,
        uint256 nonce,
        uint256 deadline
    ) private view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                GRANT_TYPEHASH,
                account,
                t.agent,
                t.agentId,
                t.token,
                t.maxPerSpend,
                t.maxTotal,
                t.approvalThreshold,
                t.expiresAt,
                keccak256(abi.encodePacked(recipients)),
                nonce,
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(permits.DOMAIN_SEPARATOR(), structHash));
        return abi.encodePacked(r, s, v);
    }

    function _signTokenPermit(uint256 pk, address account, uint256 value, uint256 deadline)
        private
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(TOKEN_PERMIT_TYPEHASH, account, address(permits), value, usd.nonces(account), deadline)
        );
        return vm.sign(pk, _digest(usd.DOMAIN_SEPARATOR(), structHash));
    }

    function _digest(bytes32 domainSeparator, bytes32 structHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }
}
