// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface ICupEventOracle {
    struct Event {
        uint256 matchId;
        uint64 timestamp;
        uint32 minute;
        string category;
        string eventType;
        string details;
        address updater;
    }

    function getLatestEvent(uint256) external view returns (Event memory);
}

/// @title CupRewards — prediction-market-lite settled by the event oracle
/// @notice Prefer settleWithOutcome for demos; settle() parses oracle JSON.
contract CupRewards is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    enum Outcome {
        UNSET,
        HOME,
        DRAW,
        AWAY
    }

    struct Market {
        uint256 matchId;
        uint64 closesAt;
        Outcome resolved;
        uint256 totalHome;
        uint256 totalDraw;
        uint256 totalAway;
        bool settled;
    }

    IERC20 public immutable usdc;
    ICupEventOracle public immutable oracle;
    mapping(uint256 => Market) public markets;
    // matchId => user => (home, draw, away)
    mapping(uint256 => mapping(address => uint256[3])) public stakes;

    /// @dev Intent log for CCTP cross-chain withdrawals (simulator-friendly)
    event CrossChainWithdrawIntent(
        uint256 indexed matchId,
        address indexed user,
        uint32 dstDomain,
        uint256 amount,
        bytes32 recipient
    );

    event MarketOpened(uint256 indexed matchId, uint64 closesAt);
    event Staked(uint256 indexed matchId, address indexed user, Outcome pick, uint256 amount);
    event Settled(uint256 indexed matchId, Outcome outcome);
    event Claimed(uint256 indexed matchId, address indexed user, uint256 payout);

    constructor(address admin, address _usdc, address _oracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLER_ROLE, admin);
        usdc = IERC20(_usdc);
        oracle = ICupEventOracle(_oracle);
    }

    /// @notice Permissionless — anyone can open a market (feeder auto-opens).
    ///         Cannot overwrite an existing market or set a past close time.
    function openMarket(uint256 matchId, uint64 closesAt) external {
        require(markets[matchId].closesAt == 0, "exists");
        require(closesAt > block.timestamp, "past close");
        markets[matchId] = Market(matchId, closesAt, Outcome.UNSET, 0, 0, 0, false);
        emit MarketOpened(matchId, closesAt);
    }

    function stake(uint256 matchId, Outcome pick, uint256 amount) external {
        Market storage m = markets[matchId];
        require(m.closesAt > 0 && block.timestamp < m.closesAt, "closed");
        require(pick == Outcome.HOME || pick == Outcome.DRAW || pick == Outcome.AWAY, "bad pick");
        require(amount > 0, "zero");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        stakes[matchId][msg.sender][uint256(pick) - 1] += amount;
        if (pick == Outcome.HOME) m.totalHome += amount;
        else if (pick == Outcome.DRAW) m.totalDraw += amount;
        else m.totalAway += amount;
        emit Staked(matchId, msg.sender, pick, amount);
    }

    /// @notice Anyone can call once oracle has posted a "final" event.
    function settle(uint256 matchId) external {
        Market storage m = markets[matchId];
        require(!m.settled, "done");
        require(m.closesAt > 0, "no market");
        ICupEventOracle.Event memory e = oracle.getLatestEvent(matchId);
        require(keccak256(bytes(e.eventType)) == keccak256("final"), "not final");
        Outcome o = _parseOutcome(e.details);
        m.resolved = o;
        m.settled = true;
        emit Settled(matchId, o);
    }

    /// @notice Reliable admin path — avoid brittle on-chain JSON for demos.
    function settleWithOutcome(uint256 matchId, Outcome outcome) external onlyRole(SETTLER_ROLE) {
        Market storage m = markets[matchId];
        require(!m.settled, "done");
        require(m.closesAt > 0, "no market");
        require(outcome != Outcome.UNSET, "bad outcome");
        m.resolved = outcome;
        m.settled = true;
        emit Settled(matchId, outcome);
    }

    function claim(uint256 matchId) external {
        Market storage m = markets[matchId];
        require(m.settled, "unsettled");
        uint256[3] storage s = stakes[matchId][msg.sender];
        uint256 idx = uint256(m.resolved) - 1;
        uint256 mine = s[idx];
        require(mine > 0, "nothing");
        s[idx] = 0;
        uint256 winnerPool = _pool(m, m.resolved);
        uint256 totalPool = m.totalHome + m.totalDraw + m.totalAway;
        require(winnerPool > 0, "no winners");
        uint256 payout = (mine * totalPool) / winnerPool;
        usdc.safeTransfer(msg.sender, payout);
        emit Claimed(matchId, msg.sender, payout);
    }

    /// @notice Emit intent for CCTP (frontend performs actual depositForBurn).
    function logCrossChainWithdraw(
        uint256 matchId,
        uint32 dstDomain,
        uint256 amount,
        bytes32 recipient
    ) external {
        emit CrossChainWithdrawIntent(matchId, msg.sender, dstDomain, amount, recipient);
    }

    function _pool(Market storage m, Outcome o) internal view returns (uint256) {
        if (o == Outcome.HOME) return m.totalHome;
        if (o == Outcome.DRAW) return m.totalDraw;
        return m.totalAway;
    }

    /// @dev Minimal JSON parse: expects `"home":N,"away":M`.
    function _parseOutcome(string memory j) internal pure returns (Outcome) {
        bytes memory b = bytes(j);
        (uint256 h, uint256 a) = (0, 0);
        bool found;
        for (uint256 i = 0; i + 7 < b.length; i++) {
            if (
                b[i] == '"' && b[i + 1] == bytes1("h") && b[i + 2] == bytes1("o") && b[i + 3] == bytes1("m")
                    && b[i + 4] == bytes1("e") && b[i + 5] == '"' && b[i + 6] == bytes1(":")
            ) {
                (h,) = _readNum(b, i + 7);
                found = true;
                break;
            }
        }
        require(found, "bad json");
        found = false;
        for (uint256 i = 0; i + 7 < b.length; i++) {
            if (
                b[i] == '"' && b[i + 1] == bytes1("a") && b[i + 2] == bytes1("w") && b[i + 3] == bytes1("a")
                    && b[i + 4] == bytes1("y") && b[i + 5] == '"' && b[i + 6] == bytes1(":")
            ) {
                (a,) = _readNum(b, i + 7);
                found = true;
                break;
            }
        }
        require(found, "bad json");
        if (h > a) return Outcome.HOME;
        if (h < a) return Outcome.AWAY;
        return Outcome.DRAW;
    }

    function _readNum(bytes memory b, uint256 start) internal pure returns (uint256 n, uint256 end) {
        for (uint256 i = start; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c < 48 || c > 57) {
                return (n, i);
            }
            n = n * 10 + (c - 48);
        }
        return (n, b.length);
    }
}
