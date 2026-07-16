// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CupEventOracle} from "../src/CupEventOracle.sol";
import {CupRewards} from "../src/CupRewards.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract RewardsTest is Test {
    CupEventOracle oracle;
    CupRewards rewards;
    MockUSDC usdc;

    address admin = address(0xA11CE);
    address feeder = address(0xFEED);
    address alice = address(0xA11);
    address bob = address(0xB0B);
    address charlie = address(0xC4A);

    uint256 constant MATCH = 2026001;

    function setUp() public {
        usdc = new MockUSDC();
        oracle = new CupEventOracle(admin);
        rewards = new CupRewards(admin, address(usdc), address(oracle));
        bytes32 feederRole = oracle.FEEDER_ROLE();
        vm.prank(admin);
        oracle.grantRole(feederRole, feeder);

        usdc.mint(alice, 1000e6);
        usdc.mint(bob, 1000e6);
        usdc.mint(charlie, 1000e6);

        vm.prank(admin);
        rewards.openMarket(MATCH, uint64(block.timestamp + 1 days));
    }

    function _stake(address user, CupRewards.Outcome pick, uint256 amount) internal {
        vm.startPrank(user);
        usdc.approve(address(rewards), amount);
        rewards.stake(MATCH, pick, amount);
        vm.stopPrank();
    }

    function testStakeSettleClaimSplit() public {
        // Alice + Bob on HOME (winner), Charlie on AWAY
        _stake(alice, CupRewards.Outcome.HOME, 100e6);
        _stake(bob, CupRewards.Outcome.HOME, 100e6);
        _stake(charlie, CupRewards.Outcome.AWAY, 200e6);

        // Post final 2-1 home win via oracle
        vm.prank(feeder);
        oracle.addEvent(MATCH, 90, "football", "final", '{"home":2,"away":1}');

        rewards.settle(MATCH);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        rewards.claim(MATCH);
        // total pool 400, winner pool 200 → alice gets 100 * 400 / 200 = 200
        assertEq(usdc.balanceOf(alice) - aliceBefore, 200e6);

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        rewards.claim(MATCH);
        assertEq(usdc.balanceOf(bob) - bobBefore, 200e6);

        // Charlie has nothing to claim
        vm.prank(charlie);
        vm.expectRevert("nothing");
        rewards.claim(MATCH);
    }

    function testCannotClaimTwice() public {
        _stake(alice, CupRewards.Outcome.HOME, 50e6);
        vm.prank(feeder);
        oracle.addEvent(MATCH, 90, "football", "final", '{"home":1,"away":0}');
        rewards.settle(MATCH);

        vm.prank(alice);
        rewards.claim(MATCH);
        vm.prank(alice);
        vm.expectRevert("nothing");
        rewards.claim(MATCH);
    }

    function testCannotSettleBeforeFinal() public {
        _stake(alice, CupRewards.Outcome.HOME, 10e6);
        vm.prank(feeder);
        oracle.addEvent(MATCH, 12, "football", "goal", '{"team":"ARG"}');
        vm.expectRevert("not final");
        rewards.settle(MATCH);
    }

    function testSettleWithOutcomeAdmin() public {
        _stake(alice, CupRewards.Outcome.DRAW, 100e6);
        _stake(bob, CupRewards.Outcome.HOME, 100e6);

        vm.prank(admin);
        rewards.settleWithOutcome(MATCH, CupRewards.Outcome.DRAW);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        rewards.claim(MATCH);
        // total 200, winner pool 100 → 200
        assertEq(usdc.balanceOf(alice) - before, 200e6);
    }

    function testDrawOutcomeFromJson() public {
        _stake(alice, CupRewards.Outcome.DRAW, 50e6);
        vm.prank(feeder);
        oracle.addEvent(MATCH, 90, "football", "final", '{"home":1,"away":1}');
        rewards.settle(MATCH);
        vm.prank(alice);
        rewards.claim(MATCH);
        assertEq(usdc.balanceOf(alice), 1000e6); // got stake back as sole winner of full pool
    }
}
