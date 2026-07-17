// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CupRewards} from "../src/CupRewards.sol";

/// @notice Redeploy ONLY CupRewards pointing to an existing oracle + USDC.
///         Grants SETTLER_ROLE to FEEDER_ADDRESS if provided.
contract DeployRewardsOnly is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);
        address usdc = vm.envAddress("USDC_TESTNET_ADDRESS");
        address oracle = vm.envAddress("ORACLE_ADDRESS");

        vm.startBroadcast(pk);

        CupRewards rewards = new CupRewards(admin, usdc, oracle);

        try vm.envAddress("FEEDER_ADDRESS") returns (address feeder) {
            if (feeder != address(0)) {
                rewards.grantRole(rewards.SETTLER_ROLE(), feeder);
                console2.log("Granted SETTLER_ROLE to feeder:", feeder);
            }
        } catch {}

        try vm.envAddress("AGENT_ADDRESS") returns (address agent) {
            if (agent != address(0)) {
                rewards.grantRole(rewards.SETTLER_ROLE(), agent);
                console2.log("Granted SETTLER_ROLE to agent:", agent);
            }
        } catch {}

        vm.stopBroadcast();

        console2.log("New Rewards:", address(rewards));
        console2.log("Oracle (existing):", oracle);
        console2.log("USDC:", usdc);
        console2.log("Admin:", admin);
    }
}
