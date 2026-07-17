// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface IOracleTreasury {
    function recordEvent(address feeder) external;
}

/// @title CupEventOracle — generic real-world event oracle
/// @notice Events are opaque strings so this contract can serve football,
///         tennis, esports, elections, etc. Categorisation happens off-chain.
///         Optionally notifies an OracleTreasury for feeder attribution.
contract CupEventOracle is AccessControl {
    bytes32 public constant FEEDER_ROLE = keccak256("FEEDER_ROLE");

    struct Event {
        uint256 matchId;
        uint64 timestamp; // unix seconds
        uint32 minute; // in-match clock; 0 if N/A
        string category; // "football", "tennis", ...
        string eventType; // "goal", "card", "sub", "final", ...
        string details; // JSON blob, opaque
        address updater;
    }

    // matchId => events (append-only)
    mapping(uint256 => Event[]) private _events;
    // matchId => registered?
    mapping(uint256 => bool) public knownMatch;
    uint256[] public matchIds;

    /// @notice Treasury contract for feeder revenue attribution (optional).
    IOracleTreasury public treasury;

    event EventAdded(
        uint256 indexed matchId,
        uint256 indexed index,
        string category,
        string eventType,
        uint64 timestamp
    );
    event TreasurySet(address indexed treasury);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FEEDER_ROLE, admin);
    }

    /// @notice Set the treasury contract. Admin only. Zero address disables.
    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = IOracleTreasury(_treasury);
        emit TreasurySet(_treasury);
    }

    function addEvent(
        uint256 matchId,
        uint32 minute,
        string calldata category,
        string calldata eventType,
        string calldata details
    ) external onlyRole(FEEDER_ROLE) returns (uint256 index) {
        if (!knownMatch[matchId]) {
            knownMatch[matchId] = true;
            matchIds.push(matchId);
        }
        Event memory e = Event({
            matchId: matchId,
            timestamp: uint64(block.timestamp),
            minute: minute,
            category: category,
            eventType: eventType,
            details: details,
            updater: msg.sender
        });
        _events[matchId].push(e);
        index = _events[matchId].length - 1;
        emit EventAdded(matchId, index, category, eventType, e.timestamp);

        // Notify treasury for feeder attribution
        if (address(treasury) != address(0)) {
            treasury.recordEvent(msg.sender);
        }
    }

    function getEvents(uint256 matchId) external view returns (Event[] memory) {
        return _events[matchId];
    }

    function getLatestEvent(uint256 matchId) external view returns (Event memory) {
        Event[] storage arr = _events[matchId];
        require(arr.length > 0, "no events");
        return arr[arr.length - 1];
    }

    function eventCount(uint256 matchId) external view returns (uint256) {
        return _events[matchId].length;
    }

    function allMatchIds() external view returns (uint256[] memory) {
        return matchIds;
    }
}
