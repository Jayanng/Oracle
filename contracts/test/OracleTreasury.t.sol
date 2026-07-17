// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CupEventOracle} from "../src/CupEventOracle.sol";
import {OracleTreasury} from "../src/OracleTreasury.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract OracleTreasuryTest is Test {
    CupEventOracle oracle;
    OracleTreasury treasury;
    MockUSDC usdc;

    address admin = address(0xA11CE);
    address feeder1 = address(0xF1);
    address feeder2 = address(0xF2);
    address settler = address(0x5E7);
    address alice = address(0xA11);

    function setUp() public {
        usdc = new MockUSDC();
        oracle = new CupEventOracle(admin);
        treasury = new OracleTreasury(admin, address(usdc), address(0xDEAD));

        // Wire the oracle to the treasury
        vm.prank(admin);
        oracle.setTreasury(address(treasury));

        // Grant FEEDER_TRACKER_ROLE to oracle
        bytes32 trackerRole = treasury.FEEDER_TRACKER_ROLE();
        vm.prank(admin);
        treasury.grantRole(trackerRole, address(oracle));

        // Grant X402_SETTLER_ROLE to settler
        bytes32 settlerRole = treasury.X402_SETTLER_ROLE();
        vm.prank(admin);
        treasury.grantRole(settlerRole, settler);

        // Grant FEEDER_ROLE to feeders
        bytes32 feederRole = oracle.FEEDER_ROLE();
        vm.prank(admin);
        oracle.grantRole(feederRole, feeder1);
        vm.prank(admin);
        oracle.grantRole(feederRole, feeder2);

        // Fund settler with USDC for revenue recording
        usdc.mint(settler, 1000e6);
    }

    // --- Tests ---

    function testOnlyOracleCanRecordEvents() public {
        vm.prank(alice);
        vm.expectRevert();
        treasury.recordEvent(feeder1);
    }

    function testOnlySettlerCanRecordRevenue() public {
        vm.prank(alice);
        vm.expectRevert();
        treasury.recordRevenue(100e6);
    }

    function testOracleRecordsEventOnAddEvent() public {
        vm.prank(feeder1);
        oracle.addEvent(1, 10, "football", "goal", "{}");

        assertEq(treasury.feederEventCount(feeder1), 1);
        assertEq(treasury.totalEventCount(), 1);
    }

    function testMultipleFeedersTracked() public {
        vm.prank(feeder1);
        oracle.addEvent(1, 10, "football", "goal", "{}");
        vm.prank(feeder2);
        oracle.addEvent(1, 20, "football", "goal", "{}");
        vm.prank(feeder1);
        oracle.addEvent(1, 30, "football", "goal", "{}");

        assertEq(treasury.feederEventCount(feeder1), 2);
        assertEq(treasury.feederEventCount(feeder2), 1);
        assertEq(treasury.totalEventCount(), 3);
    }

    function testProRataMath() public {
        // Feeder1: 60 events, Feeder2: 40 events = 100 total
        for (uint256 i = 0; i < 60; i++) {
            vm.prank(feeder1);
            oracle.addEvent(1, uint32(i), "football", "event", "{}");
        }
        for (uint256 i = 0; i < 40; i++) {
            vm.prank(feeder2);
            oracle.addEvent(1, uint32(100 + i), "football", "event", "{}");
        }

        // Revenue: 100 USDC
        usdc.mint(settler, 1000e6);
        vm.prank(settler);
        usdc.approve(address(treasury), 100e6);
        vm.prank(settler);
        treasury.pullPayment(settler, 100e6);

        // Feeder1 should earn 60 USDC
        assertEq(treasury.earnedBy(feeder1), 60e6);
        // Feeder2 should earn 40 USDC
        assertEq(treasury.earnedBy(feeder2), 40e6);
    }

    function testWithdrawIncrementsPaidOutAndDecrementsAvailable() public {
        vm.prank(feeder1);
        oracle.addEvent(1, 10, "football", "goal", "{}");

        usdc.mint(settler, 100e6);
        vm.prank(settler);
        usdc.approve(address(treasury), 100e6);
        vm.prank(settler);
        treasury.pullPayment(settler, 100e6);

        uint256 earned = treasury.earnedBy(feeder1);
        assertEq(earned, 100e6);

        uint256 feederBefore = usdc.balanceOf(feeder1);
        vm.prank(feeder1);
        treasury.withdraw(earned, feeder1);

        assertEq(usdc.balanceOf(feeder1), feederBefore + earned);
        assertEq(treasury.feederPaidOut(feeder1), earned);
        assertEq(treasury.earnedBy(feeder1), 0);
    }

    function testCannotWithdrawMoreThanEarned() public {
        vm.prank(feeder1);
        oracle.addEvent(1, 10, "football", "goal", "{}");

        // No revenue yet — earned is 0
        vm.prank(feeder1);
        vm.expectRevert("exceeds earned");
        treasury.withdraw(1e6, feeder1);
    }

    function testPullPaymentRecordsRevenue() public {
        usdc.mint(settler, 100e6);
        vm.prank(settler);
        usdc.approve(address(treasury), 100e6);

        assertEq(treasury.totalRevenue(), 0);

        vm.prank(settler);
        treasury.pullPayment(settler, 100e6);

        assertEq(treasury.totalRevenue(), 100e6);
        assertEq(usdc.balanceOf(address(treasury)), 100e6);
    }

    function testRecordRevenueDirect() public {
        usdc.mint(settler, 100e6);
        vm.prank(settler);
        usdc.transfer(address(treasury), 100e6);

        vm.prank(settler);
        treasury.recordRevenue(100e6);

        assertEq(treasury.totalRevenue(), 100e6);
    }

    function testTreasuryNotSetDoesNotRevert() public {
        // Deploy a separate oracle without treasury
        CupEventOracle oracleNoTreasury = new CupEventOracle(admin);
        bytes32 feederRole = oracleNoTreasury.FEEDER_ROLE();
        vm.prank(admin);
        oracleNoTreasury.grantRole(feederRole, feeder1);

        // Should not revert even though treasury is zero
        vm.prank(feeder1);
        oracleNoTreasury.addEvent(1, 10, "football", "goal", "{}");
    }

    function testSetTreasuryEmitsEvent() public {
        // Deploy a fresh oracle to test the TreasurySet event
        CupEventOracle newOracle = new CupEventOracle(admin);

        vm.expectEmit(true, true, true, true);
        emit CupEventOracle.TreasurySet(address(treasury));

        vm.prank(admin);
        newOracle.setTreasury(address(treasury));
    }

    function testMultipleRevenueStreams() public {
        vm.prank(feeder1);
        oracle.addEvent(1, 10, "football", "goal", "{}");

        usdc.mint(settler, 300e6);
        vm.prank(settler);
        usdc.approve(address(treasury), 300e6);

        vm.prank(settler);
        treasury.pullPayment(settler, 100e6);
        vm.prank(settler);
        treasury.pullPayment(settler, 200e6);

        assertEq(treasury.totalRevenue(), 300e6);
        assertEq(usdc.balanceOf(address(treasury)), 300e6);
    }
}
