// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CupEventOracle} from "../src/CupEventOracle.sol";
import {FanDrops} from "../src/FanDrops.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract FanDropsTest is Test {
    CupEventOracle oracle;
    FanDrops drops;
    MockUSDC usdc;

    address admin = address(0xA11CE);
    address sponsor = address(0x50F);
    address agent = address(0xA6E);
    address feeder = address(0xFEED);
    address alice = address(0xA11);
    address bob = address(0xB0B);

    uint256 constant MATCH = 2026001;

    function setUp() public {
        usdc = new MockUSDC();
        oracle = new CupEventOracle(admin);

        // Wire treasury — deploy a minimal one for FanDrop tests
        // For FanDrops tests we don't need the treasury, just the oracle
        drops = new FanDrops(admin, address(usdc), address(oracle), address(0xDEAD));

        bytes32 feederRole = oracle.FEEDER_ROLE();
        vm.prank(admin);
        oracle.grantRole(feederRole, feeder);

        bytes32 sponsorRole = drops.SPONSOR_ROLE();
        vm.prank(admin);
        drops.grantRole(sponsorRole, sponsor);

        bytes32 agentRole = drops.AGENT_ROLE();
        vm.prank(admin);
        drops.grantRole(agentRole, agent);

        // Fund sponsor with USDC
        usdc.mint(sponsor, 10_000e6);
    }

    // --- Test helpers ---

    function _createDrop() internal returns (uint256 dropId) {
        vm.prank(sponsor);
        usdc.approve(address(drops), 500e6);
        vm.prank(sponsor);
        return drops.createDrop(MATCH, "goal", 1, 120, 100e6, 5);
    }

    function _whitelist(uint256 dropId, address[] memory wallets) internal {
        vm.prank(agent);
        drops.whitelist(dropId, wallets);
    }

    function _addGoalEvent() internal {
        vm.prank(feeder);
        oracle.addEvent(MATCH, 67, "football", "goal", '{"team":"ARG","player":"Messi"}');
    }

    // --- Tests ---

    function testOnlySponsorCanCreateDrop() public {
        vm.prank(alice);
        vm.expectRevert();
        drops.createDrop(MATCH, "goal", 1, 120, 100e6, 5);
    }

    function testSponsorUsdcEscrowedOnCreation() public {
        uint256 sponsorBefore = usdc.balanceOf(sponsor);
        uint256 dropsBefore = usdc.balanceOf(address(drops));

        _createDrop();

        assertEq(usdc.balanceOf(sponsor), sponsorBefore - 500e6);
        assertEq(usdc.balanceOf(address(drops)), dropsBefore + 500e6);
    }

    function testNonWhitelistedCannotClaim() public {
        uint256 dropId = _createDrop();

        vm.prank(alice);
        vm.expectRevert("not eligible");
        drops.claim(dropId);
    }

    function testCannotClaimBeforeOracleEvent() public {
        uint256 dropId = _createDrop();
        address[] memory wallets = new address[](1);
        wallets[0] = alice;
        _whitelist(dropId, wallets);

        vm.prank(alice);
        vm.expectRevert("oracle event not yet fired");
        drops.claim(dropId);
    }

    function testWhitelistedCanClaimAfterOracleEvent() public {
        uint256 dropId = _createDrop();
        address[] memory wallets = new address[](1);
        wallets[0] = alice;
        _whitelist(dropId, wallets);

        _addGoalEvent();

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        drops.claim(dropId);

        assertEq(usdc.balanceOf(alice), aliceBefore + 100e6);
    }

    function testCannotClaimTwice() public {
        uint256 dropId = _createDrop();
        address[] memory wallets = new address[](1);
        wallets[0] = alice;
        _whitelist(dropId, wallets);

        _addGoalEvent();

        vm.prank(alice);
        drops.claim(dropId);

        vm.prank(alice);
        vm.expectRevert("already claimed");
        drops.claim(dropId);
    }

    function testClaimedCountCannotExceedMaxWinners() public {
        uint256 dropId = _createDrop(); // maxWinners = 5

        // Try to whitelist 6 wallets
        address[] memory wallets = new address[](6);
        for (uint256 i = 0; i < 6; i++) {
            wallets[i] = address(uint160(0x1000 + i));
        }

        vm.prank(agent);
        vm.expectRevert("exceeds maxWinners");
        drops.whitelist(dropId, wallets);
    }

    function testCancelDropRefundsCorrectly() public {
        uint256 dropId = _createDrop();
        address[] memory wallets = new address[](2);
        wallets[0] = alice;
        wallets[1] = bob;
        _whitelist(dropId, wallets);

        _addGoalEvent();

        // Alice claims
        vm.prank(alice);
        drops.claim(dropId);

        // Cancel remaining — 4 unclaimed * 100 = 400 refund
        uint256 sponsorBefore = usdc.balanceOf(sponsor);
        vm.prank(sponsor);
        drops.cancelDrop(dropId);

        assertEq(usdc.balanceOf(sponsor), sponsorBefore + 400e6);
    }

    function testClaimForAgentCanPushToRecipient() public {
        uint256 dropId = _createDrop();
        address[] memory wallets = new address[](1);
        wallets[0] = alice;
        _whitelist(dropId, wallets);

        _addGoalEvent();

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(agent);
        drops.claimFor(dropId, alice);

        assertEq(usdc.balanceOf(alice), aliceBefore + 100e6);
    }

    function testDropDeactivatesWhenMaxReached() public {
        uint256 dropId = _createDrop(); // maxWinners = 5

        // Whitelist 5 wallets
        address[] memory wallets = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            wallets[i] = address(uint160(0x1000 + i));
            // Fund them with INJ for no reason — they just need to claim
        }
        _whitelist(dropId, wallets);

        _addGoalEvent();

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(wallets[i]);
            drops.claim(dropId);
        }

        // Drop should now be inactive
        assertFalse(drops.isActive(dropId));
    }

    function testOnlySponsorOrAdminCanCancel() public {
        uint256 dropId = _createDrop();

        vm.prank(alice);
        vm.expectRevert();
        drops.cancelDrop(dropId);

        vm.prank(sponsor);
        drops.cancelDrop(dropId); // should work
    }

    function testClaimToChainRevertsOnNoTokenMessenger() public {
        // Deploy drops with zero-address tokenMessenger
        FanDrops noBridge = new FanDrops(admin, address(usdc), address(oracle), address(0));

        bytes32 sponsorRole = noBridge.SPONSOR_ROLE();
        vm.prank(admin);
        noBridge.grantRole(sponsorRole, sponsor);

        bytes32 agentRole = noBridge.AGENT_ROLE();
        vm.prank(admin);
        noBridge.grantRole(agentRole, agent);

        usdc.mint(sponsor, 1000e6);
        vm.prank(sponsor);
        usdc.approve(address(noBridge), 500e6);
        vm.prank(sponsor);
        uint256 dropId = noBridge.createDrop(MATCH, "goal", 1, 120, 100e6, 1);

        address[] memory wallets = new address[](1);
        wallets[0] = alice;
        vm.prank(agent);
        noBridge.whitelist(dropId, wallets);

        _addGoalEvent();

        vm.prank(alice);
        vm.expectRevert();
        noBridge.claimToChain(dropId, 0, bytes32(uint256(uint160(alice))));
    }

    function testOracleEventMatchedByMinuteRange() public {
        // Create drop for minute range 80-90
        vm.prank(sponsor);
        usdc.approve(address(drops), 500e6);
        vm.prank(sponsor);
        uint256 dropId = drops.createDrop(MATCH, "goal", 80, 90, 100e6, 1);

        address[] memory wallets = new address[](1);
        wallets[0] = alice;
        _whitelist(dropId, wallets);

        // Add a goal at minute 67 — should NOT match 80-90 range
        _addGoalEvent();

        vm.prank(alice);
        vm.expectRevert("oracle event not yet fired");
        drops.claim(dropId);

        // Add a goal at minute 85 — should match
        vm.prank(feeder);
        oracle.addEvent(MATCH, 85, "football", "goal", '{"team":"FRA","player":"Mbappe"}');

        vm.prank(alice);
        drops.claim(dropId); // should succeed
    }
}
