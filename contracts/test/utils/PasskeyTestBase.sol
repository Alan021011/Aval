// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

/// Utilidades para simular una passkey en los tests.
abstract contract PasskeyTestBase is Test {
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    bytes1 internal constant UP_UV = 0x05;
    bytes1 internal constant UP_ONLY = 0x01;

    function _passkeyPublicKey(uint256 pk) internal pure returns (bytes32 x, bytes32 y) {
        (uint256 px, uint256 py) = vm.publicKeyP256(pk);
        return (bytes32(px), bytes32(py));
    }

    /// Arma una aserción como la que produce un navegador: authenticatorData, clientDataJSON y firma P256
    /// sobre sha256(authenticatorData ‖ sha256(clientDataJSON)), normalizada a s bajo.
    function _assertion(uint256 pk, bytes memory challenge, bytes1 flags)
        internal
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
        if (uint256(s) > P256_N / 2) s = bytes32(P256_N - uint256(s));

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
