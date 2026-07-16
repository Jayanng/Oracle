// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CupEventOracle} from "../src/CupEventOracle.sol";
import {CupRewards} from "../src/CupRewards.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice Deploy oracle + rewards. Uses USDC_TESTNET_ADDRESS if set, else deploys MockUSDC.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);

        address usdc;
        try vm.envAddress("USDC_TESTNET_ADDRESS") returns (address u) {
            usdc = u;
        } catch {
            usdc = address(0);
        }

        bool useMock = vm.envOr("USE_MOCK_USDC", false);

        vm.startBroadcast(pk);

        if (useMock || usdc == address(0)) {
            MockUSDC mock = new MockUSDC();
            usdc = address(mock);
            mock.mint(admin, 1_000_000e6);
            console2.log("MockUSDC:", usdc);
        }

        CupEventOracle oracle = new CupEventOracle(admin);
        CupRewards rewards = new CupRewards(admin, usdc, address(oracle));

        // Grant feeder role if FEEDER_ADDRESS provided
        try vm.envAddress("FEEDER_ADDRESS") returns (address feeder) {
            if (feeder != address(0)) {
                oracle.grantRole(oracle.FEEDER_ROLE(), feeder);
                console2.log("Granted FEEDER_ROLE to:", feeder);
            }
        } catch {}

        try vm.envAddress("AGENT_ADDRESS") returns (address agent) {
            if (agent != address(0)) {
                rewards.grantRole(rewards.SETTLER_ROLE(), agent);
                console2.log("Granted SETTLER_ROLE to:", agent);
            }
        } catch {}

        vm.stopBroadcast();

        console2.log("Oracle:", address(oracle));
        console2.log("Rewards:", address(rewards));
        console2.log("USDC:", usdc);
        console2.log("Admin:", admin);
    }
}
