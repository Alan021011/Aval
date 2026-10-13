// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MemoryVault} from "../src/MemoryVault.sol";

contract MemoryVaultTest is Test {
    bytes32 private constant STORE_TYPEHASH =
        keccak256("Store(address owner,bytes32 slot,bytes32 dataHash,uint256 nonce,uint256 deadline)");

    MemoryVault private vault;
    address private owner;
    uint256 private ownerPk;
    bytes32 private constant SLOT = keccak256("aval/memory/private");
    bytes private constant CIPHERTEXT = hex"0011223344556677889900aabbccddeeff";

    function setUp() public {
        vault = new MemoryVault();
        (owner, ownerPk) = makeAddrAndKey("mera-owner");
    }

    function test_StoreAndGet() public {
        vm.expectEmit(address(vault));
        emit MemoryVault.Stored(owner, SLOT, CIPHERTEXT.length);
        vm.prank(owner);
        vault.store(SLOT, CIPHERTEXT);
        assertEq(vault.get(owner, SLOT), CIPHERTEXT);
    }

    function test_EachOwnerHasItsOwnSlots() public {
        vm.prank(owner);
        vault.store(SLOT, CIPHERTEXT);
        // Otra cuenta escribe en el "mismo" casillero: no pisa al dueño.
        vm.prank(makeAddr("otro"));
        vault.store(SLOT, hex"ff");
        assertEq(vault.get(owner, SLOT), CIPHERTEXT);
    }

    function test_EmptyDataClearsTheSlot() public {
        vm.startPrank(owner);
        vault.store(SLOT, CIPHERTEXT);
        vault.store(SLOT, "");
        vm.stopPrank();
        assertEq(vault.get(owner, SLOT).length, 0);
    }

    function test_RevertWhen_TooLarge() public {
        bytes memory big = new bytes(vault.MAX_BYTES() + 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MemoryVault.TooLarge.selector, big.length));
        vault.store(SLOT, big);
    }

    function test_StoreFor_RelayerPaysGas() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(ownerPk, owner, SLOT, CIPHERTEXT, 0, deadline);

        vm.prank(makeAddr("relayer"));
        vault.storeFor(owner, SLOT, CIPHERTEXT, deadline, sig);

        assertEq(vault.get(owner, SLOT), CIPHERTEXT);
        assertEq(vault.nonces(owner), 1);
    }

    function test_RevertWhen_RelayerChangesTheData() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(ownerPk, owner, SLOT, CIPHERTEXT, 0, deadline);

        vm.expectRevert(MemoryVault.InvalidSignature.selector);
        vault.storeFor(owner, SLOT, hex"deadbeef", deadline, sig);
    }

    function test_RevertWhen_RelayerChangesTheSlot() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(ownerPk, owner, SLOT, CIPHERTEXT, 0, deadline);

        vm.expectRevert(MemoryVault.InvalidSignature.selector);
        vault.storeFor(owner, keccak256("otro"), CIPHERTEXT, deadline, sig);
    }

    function test_RevertWhen_StoreForIsReplayed() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(ownerPk, owner, SLOT, CIPHERTEXT, 0, deadline);
        vault.storeFor(owner, SLOT, CIPHERTEXT, deadline, sig);

        vm.expectRevert(MemoryVault.InvalidSignature.selector);
        vault.storeFor(owner, SLOT, CIPHERTEXT, deadline, sig);
    }

    function test_RevertWhen_StoreForIsExpired() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(ownerPk, owner, SLOT, CIPHERTEXT, 0, deadline);
        vm.warp(deadline + 1);

        vm.expectRevert(abi.encodeWithSelector(MemoryVault.ExpiredSignature.selector, deadline));
        vault.storeFor(owner, SLOT, CIPHERTEXT, deadline, sig);
    }

    function test_RevertWhen_SignedByAnotherAccount() public {
        (, uint256 attackerPk) = makeAddrAndKey("attacker");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(attackerPk, owner, SLOT, CIPHERTEXT, 0, deadline);

        vm.expectRevert(MemoryVault.InvalidSignature.selector);
        vault.storeFor(owner, SLOT, CIPHERTEXT, deadline, sig);
    }

    function _sign(uint256 signerPk, address account, bytes32 slot, bytes memory data, uint256 nonce, uint256 deadline)
        private
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(STORE_TYPEHASH, account, slot, keccak256(data), nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _domainSeparator() private view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = vault.eip712Domain();
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
    }
}
