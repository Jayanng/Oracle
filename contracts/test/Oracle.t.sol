// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CupEventOracle} from "../src/CupEventOracle.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract OracleTest is Test {
    CupEventOracle oracle;
    address admin = address(0xA11CE);
    address feeder = address(0xFEED);
    address stranger = address(0xB0B);

    function setUp() public {
        oracle = new CupEventOracle(admin);
        bytes32 feederRole = oracle.FEEDER_ROLE();
        vm.prank(admin);
        oracle.grantRole(feederRole, feeder);
    }

    function testOnlyFeederCanAdd() public {
        vm.prank(stranger);
        vm.expectRevert();
        oracle.addEvent(1, 10, "football", "goal", "{}");

        vm.prank(feeder);
        uint256 idx = oracle.addEvent(1, 10, "football", "goal", '{"team":"ARG"}');
        assertEq(idx, 0);
        assertEq(oracle.eventCount(1), 1);
    }

    function testAppendOrderAndLatest() public {
        vm.startPrank(feeder);
        oracle.addEvent(42, 12, "football", "goal", '{"team":"ARG"}');
        oracle.addEvent(42, 34, "football", "card", '{"team":"FRA"}');
        oracle.addEvent(42, 90, "football", "final", '{"home":1,"away":1}');
        vm.stopPrank();

        assertEq(oracle.eventCount(42), 3);
        CupEventOracle.Event memory latest = oracle.getLatestEvent(42);
        assertEq(latest.eventType, "final");
        assertEq(latest.minute, 90);

        CupEventOracle.Event[] memory all = oracle.getEvents(42);
        assertEq(all[0].eventType, "goal");
        assertEq(all[1].eventType, "card");
        assertEq(all[2].eventType, "final");
    }

    function testMatchIdsTracked() public {
        vm.prank(feeder);
        oracle.addEvent(7, 1, "football", "kickoff", "{}");
        vm.prank(feeder);
        oracle.addEvent(8, 1, "football", "kickoff", "{}");
        uint256[] memory ids = oracle.allMatchIds();
        assertEq(ids.length, 2);
        assertEq(ids[0], 7);
        assertEq(ids[1], 8);
        assertTrue(oracle.knownMatch(7));
    }

    function testLatestRevertsWhenEmpty() public {
        vm.expectRevert("no events");
        oracle.getLatestEvent(999);
    }
}
