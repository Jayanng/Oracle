// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CupEventOracle} from "../src/CupEventOracle.sol";
import {FanDrops} from "../src/FanDrops.sol";
import {OracleTreasury} from "../src/OracleTreasury.sol";

/// @notice Redeploy ONLY FanDrops + OracleTreasury (CCTP v2 depositForBurn fix),
///         reusing the existing Oracle + USDC + TokenMessenger so all recorded
///         oracle events are preserved. Re-wires the oracle -> new treasury.
contract RedeployDropsTreasury is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);

        address usdc = vm.envAddress("USDC_TESTNET_ADDRESS");
        address oracleAddr = vm.envAddress("ORACLE_ADDRESS");
        address tokenMessenger = vm.envAddress("TOKEN_MESSENGER_ADDRESS");

        vm.startBroadcast(pk);

        OracleTreasury treasury = new OracleTreasury(admin, usdc, tokenMessenger);
        FanDrops drops = new FanDrops(admin, usdc, oracleAddr, tokenMessenger);

        // Re-wire the existing oracle to the new treasury + grant tracker role
        CupEventOracle oracle = CupEventOracle(oracleAddr);
        bytes32 trackerRole = treasury.FEEDER_TRACKER_ROLE();
        treasury.grantRole(trackerRole, oracleAddr);
        oracle.setTreasury(address(treasury));

        // Grant X402_SETTLER_ROLE to the x402 endpoint signer
        try vm.envAddress("X402_SETTLER_ADDRESS") returns (address settler) {
            if (settler != address(0)) {
                treasury.grantRole(treasury.X402_SETTLER_ROLE(), settler);
                console2.log("Granted X402_SETTLER_ROLE to:", settler);
            }
        } catch {}

        // Grant AGENT_ROLE on new drops to the agent
        try vm.envAddress("AGENT_ADDRESS") returns (address agent) {
            if (agent != address(0)) {
                drops.grantRole(drops.AGENT_ROLE(), agent);
                console2.log("Granted AGENT_ROLE to:", agent);
            }
        } catch {}

        vm.stopBroadcast();

        console2.log("NEW Treasury:", address(treasury));
        console2.log("NEW Drops:", address(drops));
        console2.log("Reused Oracle:", oracleAddr);
        console2.log("USDC:", usdc);
        console2.log("TokenMessenger:", tokenMessenger);
    }
}
