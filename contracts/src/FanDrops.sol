// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface ICupEventOracleForDrops {
    struct Event {
        uint256 matchId;
        uint64 timestamp;
        uint32 minute;
        string category;
        string eventType;
        string details;
        address updater;
    }

    function getEvents(uint256) external view returns (Event[] memory);
}

/// @title FanDrops — sponsor-funded fan drops triggered by oracle events
/// @notice Sponsors fund USDC drops. Agent whitelists eligible wallets.
///         Fans claim when oracle events match. Payouts go same-chain or
///         cross-chain via CCTP.
contract FanDrops is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant SPONSOR_ROLE = keccak256("SPONSOR_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    struct Drop {
        uint256 matchId;
        string eventType;       // e.g. "goal", "final", "halftime"
        uint32 minuteFrom;      // inclusive
        uint32 minuteTo;        // inclusive; 0xFFFFFFFF for open-ended
        uint256 perWinnerAmount; // USDC 6dp
        uint32 maxWinners;
        uint32 claimedCount;
        uint256 funded;          // total USDC deposited for this drop
        address sponsor;
        bool active;
    }

    IERC20 public immutable usdc;
    ICupEventOracleForDrops public immutable oracle;
    address public immutable tokenMessenger;

    mapping(uint256 => Drop) public drops;
    // dropId => wallet => eligible
    mapping(uint256 => mapping(address => bool)) public eligible;
    // dropId => wallet => claimed
    mapping(uint256 => mapping(address => bool)) public claimed;
    uint256 public nextDropId;

    event DropCreated(
        uint256 indexed dropId,
        uint256 indexed matchId,
        string eventType,
        uint256 perWinnerAmount,
        uint32 maxWinners,
        address indexed sponsor
    );
    event Claimed(uint256 indexed dropId, address indexed winner, uint256 amount);
    event ClaimedCrossChain(
        uint256 indexed dropId,
        address indexed winner,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        uint64 nonce
    );
    event DropCancelled(uint256 indexed dropId, address indexed sponsor, uint256 refunded);
    event Whitelisted(uint256 indexed dropId, address[] wallets);

    constructor(address admin, address _usdc, address _oracle, address _tokenMessenger) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SPONSOR_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
        usdc = IERC20(_usdc);
        oracle = ICupEventOracleForDrops(_oracle);
        tokenMessenger = _tokenMessenger;
    }

    /// @notice Create a sponsor-funded drop. Pulls perWinnerAmount * maxWinners USDC.
    /// Anyone with enough USDC can create a drop — SPONSOR_ROLE is not required so the
    /// hackathon demo stays frictionless.
    function createDrop(
        uint256 matchId,
        string calldata eventType,
        uint32 minuteFrom,
        uint32 minuteTo,
        uint256 perWinnerAmount,
        uint32 maxWinners
    ) external returns (uint256 dropId) {
        require(maxWinners > 0, "maxWinners zero");
        require(perWinnerAmount > 0, "perWinnerAmount zero");
        uint256 total = perWinnerAmount * maxWinners;
        usdc.safeTransferFrom(msg.sender, address(this), total);

        dropId = nextDropId++;
        drops[dropId] = Drop({
            matchId: matchId,
            eventType: eventType,
            minuteFrom: minuteFrom,
            minuteTo: minuteTo,
            perWinnerAmount: perWinnerAmount,
            maxWinners: maxWinners,
            claimedCount: 0,
            funded: total,
            sponsor: msg.sender,
            active: true
        });

        emit DropCreated(dropId, matchId, eventType, perWinnerAmount, maxWinners, msg.sender);
    }

    /// @notice Agent whitelists wallets for a drop.
    function whitelist(uint256 dropId, address[] calldata wallets) external onlyRole(AGENT_ROLE) {
        Drop storage d = drops[dropId];
        require(d.active, "drop not active");
        require(d.claimedCount + wallets.length <= d.maxWinners, "exceeds maxWinners");

        for (uint256 i = 0; i < wallets.length; i++) {
            eligible[dropId][wallets[i]] = true;
        }
        emit Whitelisted(dropId, wallets);
    }

    /// @notice Oracle eligibility check — does a matching oracle event exist?
    function _oracleMatches(Drop memory d) internal view returns (bool) {
        ICupEventOracleForDrops.Event[] memory arr = oracle.getEvents(d.matchId);
        for (uint256 i = 0; i < arr.length; i++) {
            if (
                keccak256(bytes(arr[i].eventType)) == keccak256(bytes(d.eventType)) &&
                arr[i].minute >= d.minuteFrom &&
                arr[i].minute <= d.minuteTo
            ) {
                return true;
            }
        }
        return false;
    }

    /// @notice Claim — caller must be whitelisted, oracle must have matching event.
    /// @dev Uses msg.sender as the recipient.
    function claim(uint256 dropId) external {
        Drop storage d = drops[dropId];
        require(d.active, "drop not active");
        require(eligible[dropId][msg.sender], "not eligible");
        require(!claimed[dropId][msg.sender], "already claimed");
        require(_oracleMatches(d), "oracle event not yet fired");

        claimed[dropId][msg.sender] = true;
        d.claimedCount++;
        if (d.claimedCount == d.maxWinners) {
            d.active = false;
        }

        usdc.safeTransfer(msg.sender, d.perWinnerAmount);
        emit Claimed(dropId, msg.sender, d.perWinnerAmount);
    }

    /// @notice Agent can claim on behalf of a whitelisted wallet (same-chain).
    function claimFor(uint256 dropId, address recipient) external onlyRole(AGENT_ROLE) {
        Drop storage d = drops[dropId];
        require(d.active, "drop not active");
        require(eligible[dropId][recipient], "not eligible");
        require(!claimed[dropId][recipient], "already claimed");
        require(_oracleMatches(d), "oracle event not yet fired");

        claimed[dropId][recipient] = true;
        d.claimedCount++;
        if (d.claimedCount == d.maxWinners) {
            d.active = false;
        }

        usdc.safeTransfer(recipient, d.perWinnerAmount);
        emit Claimed(dropId, recipient, d.perWinnerAmount);
    }

    /// @notice Claim cross-chain via CCTP.
    function claimToChain(
        uint256 dropId,
        uint32 destinationDomain,
        bytes32 mintRecipient
    ) external {
        Drop storage d = drops[dropId];
        require(d.active, "drop not active");
        require(eligible[dropId][msg.sender], "not eligible");
        require(!claimed[dropId][msg.sender], "already claimed");
        require(_oracleMatches(d), "oracle event not yet fired");

        claimed[dropId][msg.sender] = true;
        d.claimedCount++;
        if (d.claimedCount == d.maxWinners) {
            d.active = false;
        }

        // Approve and burn via TokenMessenger (CCTP v2).
        // CCTP v2 depositForBurn returns void; the nonce is derived off-chain
        // from the MessageSent event / Circle attestation.
        usdc.approve(tokenMessenger, d.perWinnerAmount);
        (bool success, ) = tokenMessenger.call(
            abi.encodeWithSignature(
                "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
                d.perWinnerAmount,
                destinationDomain,
                mintRecipient,
                address(usdc),
                bytes32(0),
                uint256(0),
                uint32(2000)
            )
        );
        require(success, "CCTP burn failed");

        emit ClaimedCrossChain(dropId, msg.sender, destinationDomain, mintRecipient, 0);
    }

    /// @notice Agent can trigger cross-chain claim on behalf of a whitelisted wallet.
    function claimForToChain(
        uint256 dropId,
        address recipient,
        uint32 destinationDomain,
        bytes32 mintRecipient
    ) external onlyRole(AGENT_ROLE) {
        Drop storage d = drops[dropId];
        require(d.active, "drop not active");
        require(eligible[dropId][recipient], "not eligible");
        require(!claimed[dropId][recipient], "already claimed");
        require(_oracleMatches(d), "oracle event not yet fired");

        claimed[dropId][recipient] = true;
        d.claimedCount++;
        if (d.claimedCount == d.maxWinners) {
            d.active = false;
        }

        // Approve and burn via TokenMessenger (CCTP v2).
        // CCTP v2 depositForBurn returns void; the nonce is derived off-chain
        // from the MessageSent event / Circle attestation.
        usdc.approve(tokenMessenger, d.perWinnerAmount);
        (bool success, ) = tokenMessenger.call(
            abi.encodeWithSignature(
                "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
                d.perWinnerAmount,
                destinationDomain,
                mintRecipient,
                address(usdc),
                bytes32(0),
                uint256(0),
                uint32(2000)
            )
        );
        require(success, "CCTP burn failed");

        emit ClaimedCrossChain(dropId, recipient, destinationDomain, mintRecipient, 0);
    }

    /// @notice Check if a drop is active.
    function isActive(uint256 dropId) external view returns (bool) {
        return drops[dropId].active;
    }

    /// @notice Sponsor or admin can cancel a drop and refund unspent USDC.
    function cancelDrop(uint256 dropId) external {
        Drop storage d = drops[dropId];
        require(d.active, "drop not active");
        require(msg.sender == d.sponsor || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "not drop sponsor or admin");

        d.active = false;
        uint256 unclaimed = d.maxWinners - d.claimedCount;
        uint256 refund = unclaimed * d.perWinnerAmount;

        usdc.safeTransfer(d.sponsor, refund);
        emit DropCancelled(dropId, d.sponsor, refund);
    }
}
