// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {AvalRiskGuard, IReceiver} from "../src/AvalRiskGuard.sol";

contract AvalRiskGuardTest is Test {
    AvalRiskGuard private guard;
    address private forwarder = makeAddr("forwarder");
    address private agent = makeAddr("agent");
    address private workflowOwner = makeAddr("workflow-owner");

    function setUp() public {
        guard = new AvalRiskGuard(forwarder);
    }

    function _metadata(address owner) private pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(1)), bytes10("vigilante"), owner, bytes2(0x0001));
    }

    function _report(uint8 level, uint64 observedAt, string memory reason) private view returns (bytes memory) {
        return abi.encode(agent, level, observedAt, reason);
    }

    function test_ForwarderDeliversAnAlert() public {
        vm.expectEmit(address(guard));
        emit AvalRiskGuard.AlertUpdated(agent, 2, 100, "pagos divididos");
        vm.prank(forwarder);
        guard.onReport(_metadata(workflowOwner), _report(2, 100, "pagos divididos"));

        AvalRiskGuard.Alert memory alert = guard.alertOf(agent);
        assertEq(alert.level, 2);
        assertEq(alert.observedAt, 100);
        assertEq(alert.reason, "pagos divididos");
        assertTrue(guard.isBlocked(agent));
    }

    function test_LevelOneOnlyWarns() public {
        vm.prank(forwarder);
        guard.onReport(_metadata(workflowOwner), _report(1, 100, "vigilar"));
        assertFalse(guard.isBlocked(agent));
    }

    function test_RevertWhen_CallerIsNotTheForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(AvalRiskGuard.InvalidSender.selector, address(this)));
        guard.onReport(_metadata(workflowOwner), _report(2, 100, "x"));
    }

    function test_OnlyTheExpectedWorkflowOwnerIsAccepted() public {
        guard.setExpectedWorkflowOwner(workflowOwner);
        address other = makeAddr("otro");
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(AvalRiskGuard.InvalidWorkflowOwner.selector, other));
        guard.onReport(_metadata(other), _report(2, 100, "x"));

        vm.prank(forwarder);
        guard.onReport(_metadata(workflowOwner), _report(2, 100, "x"));
        assertTrue(guard.isBlocked(agent));
    }

    function test_RevertWhen_MetadataIsTooShortAndOwnerIsChecked() public {
        guard.setExpectedWorkflowOwner(workflowOwner);
        vm.prank(forwarder);
        vm.expectRevert(AvalRiskGuard.InvalidMetadata.selector);
        guard.onReport(hex"01", _report(2, 100, "x"));
    }

    function test_StaleReportsAreIgnored() public {
        vm.startPrank(forwarder);
        guard.onReport(_metadata(workflowOwner), _report(2, 200, "nuevo"));
        guard.onReport(_metadata(workflowOwner), _report(0, 150, "viejo"));
        vm.stopPrank();
        assertEq(guard.alertOf(agent).reason, "nuevo");
        assertTrue(guard.isBlocked(agent));
    }

    function test_ANewerReportCanClearTheAlert() public {
        vm.startPrank(forwarder);
        guard.onReport(_metadata(workflowOwner), _report(2, 200, "riesgo"));
        guard.onReport(_metadata(workflowOwner), _report(0, 300, "normal"));
        vm.stopPrank();
        assertFalse(guard.isBlocked(agent));
    }

    function test_RevertWhen_LevelIsInvalid() public {
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(AvalRiskGuard.InvalidLevel.selector, 3));
        guard.onReport(_metadata(workflowOwner), _report(3, 100, "x"));
    }

    function test_OnlyOwnerConfigures() public {
        vm.prank(makeAddr("intruso"));
        vm.expectRevert();
        guard.setForwarder(address(1));
    }

    function test_SupportsIReceiverAndERC165() public view {
        assertTrue(guard.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(guard.supportsInterface(type(IERC165).interfaceId));
        assertFalse(guard.supportsInterface(0xdeadbeef));
    }
}
