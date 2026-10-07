// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";

contract PasskeyRegistryTest is Test {
    uint256 private constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    bytes1 private constant UP_UV = 0x05;
    bytes1 private constant UP_ONLY = 0x01;
    bytes32 private constant REGISTER_TYPEHASH =
        keccak256("Register(address owner,bytes32 x,bytes32 y,uint256 nonce,uint256 deadline)");

    PasskeyRegistry private registry;
    uint256 private passkeyPk = 0xA11CE;
    bytes32 private qx;
    bytes32 private qy;
    address private owner;
    uint256 private ownerPk;

    function setUp() public {
        registry = new PasskeyRegistry();
        (uint256 x, uint256 y) = vm.publicKeyP256(passkeyPk);
        qx = bytes32(x);
        qy = bytes32(y);
        (owner, ownerPk) = makeAddrAndKey("mera-owner");
    }

    // ---------- registro ----------

    function test_Register() public {
        vm.expectEmit(address(registry));
        emit PasskeyRegistry.PasskeyRegistered(owner, qx, qy);
        vm.prank(owner);
        registry.register(qx, qy);

        (bytes32 x, bytes32 y) = registry.keyOf(owner);
        assertEq(x, qx);
        assertEq(y, qy);
        assertTrue(registry.hasKey(owner));
    }

    function test_RevertWhen_KeyIsNotOnCurve() public {
        vm.prank(owner);
        vm.expectRevert(PasskeyRegistry.InvalidPublicKey.selector);
        registry.register(bytes32(uint256(1)), bytes32(uint256(2)));
    }

    function test_RegisterFor_RelayerPaysGas() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signRegister(ownerPk, owner, 0, deadline);

        vm.prank(makeAddr("relayer"));
        registry.registerFor(owner, qx, qy, deadline, sig);

        (bytes32 x,) = registry.keyOf(owner);
        assertEq(x, qx);
        assertEq(registry.nonces(owner), 1);
    }

    function test_RevertWhen_RegisterForIsReplayed() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signRegister(ownerPk, owner, 0, deadline);
        registry.registerFor(owner, qx, qy, deadline, sig);

        vm.expectRevert(PasskeyRegistry.InvalidSignature.selector);
        registry.registerFor(owner, qx, qy, deadline, sig);
    }

    function test_RevertWhen_RegisterForIsExpired() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signRegister(ownerPk, owner, 0, deadline);
        vm.warp(deadline + 1);

        vm.expectRevert(abi.encodeWithSelector(PasskeyRegistry.ExpiredSignature.selector, deadline));
        registry.registerFor(owner, qx, qy, deadline, sig);
    }

    function test_RevertWhen_RegisterForIsSignedByAnotherAccount() public {
        (, uint256 attackerPk) = makeAddrAndKey("attacker");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signRegister(attackerPk, owner, 0, deadline);

        vm.expectRevert(PasskeyRegistry.InvalidSignature.selector);
        registry.registerFor(owner, qx, qy, deadline, sig);
    }

    // ---------- aprobaciones con passkey ----------

    function test_VerifyApproval() public {
        _registerOwner();
        bytes memory challenge = abi.encodePacked(keccak256("Pagar 30 USDC al agente #1"));
        assertTrue(registry.verifyApproval(owner, challenge, _assertion(passkeyPk, challenge, UP_UV)));
    }

    function testFuzz_VerifyApproval(bytes32 actionHash) public {
        _registerOwner();
        bytes memory challenge = abi.encodePacked(actionHash);
        assertTrue(registry.verifyApproval(owner, challenge, _assertion(passkeyPk, challenge, UP_UV)));
    }

    function test_VerifyApproval_FailsForAnotherAction() public {
        _registerOwner();
        bytes memory signed = abi.encodePacked(keccak256("Pagar 30 USDC"));
        bytes memory other = abi.encodePacked(keccak256("Pagar 3000 USDC"));
        assertFalse(registry.verifyApproval(owner, other, _assertion(passkeyPk, signed, UP_UV)));
    }

    function test_VerifyApproval_FailsWithoutUserVerification() public {
        _registerOwner();
        bytes memory challenge = abi.encodePacked(keccak256("accion"));
        assertFalse(registry.verifyApproval(owner, challenge, _assertion(passkeyPk, challenge, UP_ONLY)));
    }

    function test_VerifyApproval_FailsWithAnotherPasskey() public {
        _registerOwner();
        bytes memory challenge = abi.encodePacked(keccak256("accion"));
        assertFalse(registry.verifyApproval(owner, challenge, _assertion(0xB0B, challenge, UP_UV)));
    }

    function test_VerifyApproval_RejectsHighS() public {
        _registerOwner();
        bytes memory challenge = abi.encodePacked(keccak256("accion"));
        WebAuthn.WebAuthnAuth memory auth = _assertion(passkeyPk, challenge, UP_UV);
        // La misma firma en su forma "alta" también es válida en ECDSA; se rechaza para evitar maleabilidad.
        auth.s = bytes32(N - uint256(auth.s));
        assertFalse(registry.verifyApproval(owner, challenge, auth));
    }

    function test_VerifyApproval_FailsForUnregisteredOwner() public view {
        bytes memory challenge = abi.encodePacked(keccak256("accion"));
        assertFalse(registry.verifyApproval(owner, challenge, _assertion(passkeyPk, challenge, UP_UV)));
    }

    // ---------- utilidades ----------

    function _registerOwner() private {
        vm.prank(owner);
        registry.register(qx, qy);
    }

    function _signRegister(uint256 signerPk, address account, uint256 nonce, uint256 deadline)
        private
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(REGISTER_TYPEHASH, account, qx, qy, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Arma una aserción como la que produce un navegador: authenticatorData, clientDataJSON y firma P256
    /// sobre sha256(authenticatorData ‖ sha256(clientDataJSON)), normalizada a s bajo.
    function _assertion(uint256 pk, bytes memory challenge, bytes1 flags)
        private
        pure
        returns (WebAuthn.WebAuthnAuth memory)
    {
        string memory clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(challenge),
            '","origin":"http://localhost:5173","crossOrigin":false}'
        );
        bytes memory authenticatorData = abi.encodePacked(sha256("localhost"), flags, uint32(0));
        bytes32 digest = sha256(abi.encodePacked(authenticatorData, sha256(bytes(clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(pk, digest);
        if (uint256(s) > N / 2) s = bytes32(N - uint256(s));

        return WebAuthn.WebAuthnAuth({
            r: r,
            s: s,
            challengeIndex: 23,
            typeIndex: 1,
            authenticatorData: authenticatorData,
            clientDataJSON: clientDataJSON
        });
    }
}
