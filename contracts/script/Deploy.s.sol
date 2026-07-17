// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CupEventOracle} from "../src/CupEventOracle.sol";
import {FanDrops} from "../src/FanDrops.sol";
import {OracleTreasury} from "../src/OracleTreasury.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice Deploy oracle + treasury + drops. Uses USDC_TESTNET_ADDRESS if set, else deploys MockUSDC.
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

        // Deploy contracts
        CupEventOracle oracle = new CupEventOracle(admin);
        address tokenMessenger;
        try vm.envAddress("TOKEN_MESSENGER_ADDRESS") returns (address tm) {
            tokenMessenger = tm;
        } catch {
            tokenMessenger = vm.envOr("CCTP_TOKEN_MESSENGER", address(0));
        }
        OracleTreasury treasury = new OracleTreasury(admin, usdc, tokenMessenger);
        FanDrops drops = new FanDrops(admin, usdc, address(oracle), tokenMessenger);

        // Grant FEEDER_TRACKER_ROLE on treasury to the oracle contract
        bytes32 trackerRole = treasury.FEEDER_TRACKER_ROLE();
        treasury.grantRole(trackerRole, address(oracle));

        // Grant X402_SETTLER_ROLE to the x402 endpoint signer
        try vm.envAddress("X402_SETTLER_ADDRESS") returns (address settler) {
            if (settler != address(0)) {
                bytes32 settlerRole = treasury.X402_SETTLER_ROLE();
                treasury.grantRole(settlerRole, settler);
                console2.log("Granted X402_SETTLER_ROLE to:", settler);
            }
        } catch {}

        // Wire the oracle to the treasury
        oracle.setTreasury(address(treasury));

        // Grant feeder role if FEEDER_ADDRESS provided
        try vm.envAddress("FEEDER_ADDRESS") returns (address feeder) {
            if (feeder != address(0)) {
                oracle.grantRole(oracle.FEEDER_ROLE(), feeder);
                console2.log("Granted FEEDER_ROLE to:", feeder);
            }
        } catch {}

        // Grant agent roles
        try vm.envAddress("AGENT_ADDRESS") returns (address agent) {
            if (agent != address(0)) {
                bytes32 agentRole = drops.AGENT_ROLE();
                drops.grantRole(agentRole, agent);
                console2.log("Granted AGENT_ROLE to:", agent);
            }
        } catch {}

        // Grant sponsor role to deployer admin by default
        // (admin already has it from constructor)

        vm.stopBroadcast();

        console2.log("Oracle:", address(oracle));
        console2.log("Treasury:", address(treasury));
        console2.log("Drops:", address(drops));
        console2.log("USDC:", usdc);
        console2.log("TokenMessenger:", tokenMessenger);
        console2.log("Admin:", admin);
    }
}
