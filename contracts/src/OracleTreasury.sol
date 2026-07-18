// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title OracleTreasury — x402 revenue accumulation and pro-rata feeder distribution
/// @notice x402 payments are settled here. Feeders earn pro-rata share of revenue
///         based on events they submitted. Withdrawals support same-chain and
///         cross-chain (CCTP).
contract OracleTreasury is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant X402_SETTLER_ROLE = keccak256("X402_SETTLER_ROLE");
    bytes32 public constant FEEDER_TRACKER_ROLE = keccak256("FEEDER_TRACKER_ROLE");

    IERC20 public immutable usdc;
    address public immutable tokenMessenger;

    uint256 public totalRevenue;        // lifetime USDC ever settled in
    uint256 public totalPaidOut;        // lifetime USDC withdrawn by feeders
    uint256 public totalEventCount;     // sum of events attributed across all feeders
    mapping(address => uint256) public feederEventCount;  // events attributed to feeder
    mapping(address => uint256) public feederPaidOut;      // USDC already withdrawn

    event RevenueRecorded(uint256 amount, address indexed settler);
    event FeederEventRecorded(address indexed feeder);
    event FeederWithdrew(address indexed feeder, uint256 amount, address to);
    event FeederWithdrewCrossChain(
        address indexed feeder,
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        uint64 nonce
    );

    constructor(address admin, address _usdc, address _tokenMessenger) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        // Admin can grant the other roles after deploy
        usdc = IERC20(_usdc);
        tokenMessenger = _tokenMessenger;
    }

    /// @notice Called by CupEventOracle.addEvent() to attribute an event to a feeder.
    function recordEvent(address feeder) external onlyRole(FEEDER_TRACKER_ROLE) {
        feederEventCount[feeder]++;
        totalEventCount++;
        emit FeederEventRecorded(feeder);
    }

    /// @notice Called by the x402 endpoint after pulling USDC from the agent.
    /// @dev USDC must already be transferred to this contract before calling.
    function recordRevenue(uint256 amount) external onlyRole(X402_SETTLER_ROLE) {
        totalRevenue += amount;
        emit RevenueRecorded(amount, msg.sender);
    }

    /// @notice Pull USDC from payer (agent) after x402 verification.
    ///         Convenience: performs the transferFrom AND records revenue.
    ///         Caller must have X402_SETTLER_ROLE.
    function pullPayment(address payer, uint256 amount) external onlyRole(X402_SETTLER_ROLE) {
        usdc.safeTransferFrom(payer, address(this), amount);
        totalRevenue += amount;
        emit RevenueRecorded(amount, msg.sender);
    }

    /// @notice Pro-rata earnings for a feeder based on events contributed.
    function earnedBy(address feeder) public view returns (uint256) {
        if (totalEventCount == 0) return 0;
        uint256 total = (totalRevenue * feederEventCount[feeder]) / totalEventCount;
        if (total <= feederPaidOut[feeder]) return 0;
        return total - feederPaidOut[feeder];
    }

    /// @notice Same-chain withdrawal.
    function withdraw(uint256 amount, address to) external {
        require(amount <= earnedBy(msg.sender), "exceeds earned");
        feederPaidOut[msg.sender] += amount;
        totalPaidOut += amount;
        usdc.safeTransfer(to, amount);
        emit FeederWithdrew(msg.sender, amount, to);
    }

    /// @notice Cross-chain withdrawal via CCTP.
    function withdrawToChain(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient
    ) external returns (uint64 nonce) {
        require(amount <= earnedBy(msg.sender), "exceeds earned");
        feederPaidOut[msg.sender] += amount;
        totalPaidOut += amount;

        usdc.approve(tokenMessenger, amount);
        // CCTP v2 depositForBurn: amount, destDomain, mintRecipient, burnToken,
        //                          destinationCaller (0=anyone), maxFee (0=standard), minFinalityThreshold (2000=finalized)
        // CCTP v2 depositForBurn returns void; the nonce is derived off-chain
        // from the MessageSent event / Circle attestation.
        (bool success, ) = tokenMessenger.call(
            abi.encodeWithSignature(
                "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
                amount,
                destinationDomain,
                mintRecipient,
                address(usdc),
                bytes32(0),
                uint256(0),
                uint32(2000)
            )
        );
        require(success, "CCTP burn failed");
        nonce = 0;

        emit FeederWithdrewCrossChain(msg.sender, amount, destinationDomain, mintRecipient, nonce);
    }
}
