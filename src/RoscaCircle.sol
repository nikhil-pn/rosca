// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";
import {PqcGate} from "./libraries/PqcGate.sol";

/// @title RoscaCircle
/// @notice One savings circle (a chit fund, kuri or kameti). Every round each member pays the same
/// share into the pot, members bid the discount they accept, and the highest discount takes the pot.
/// The pot has no owner: no key can move it except a release that carries the winner's ML-DSA-87
/// signature and the approval of a majority of members.
contract RoscaCircle {
    // ---------------------------------------------------------------- limits

    /// @notice At most 50 members, so every per-member loop stays cheap.
    uint8 public constant MAX_MEMBERS = 50;
    /// @notice The Chit Funds Act 1982 caps the discount at 40% of the chit amount.
    uint16 public constant MAX_DISCOUNT_CAP_BPS = 4000;
    /// @notice The same Act caps the foreman's commission at 5%.
    uint16 public constant MAX_FEE_BPS = 500;
    /// @notice Domain tag of the payout message a winner signs.
    bytes32 public constant PAYOUT_TAG = keccak256("ROSCA-PAYOUT-V1");

    // ---------------------------------------------------------------- types

    enum Phase {
        Forming,
        Running,
        Completed,
        Dissolved
    }

    struct Params {
        address token;
        uint256 share;
        uint8 size;
        uint32 roundLength;
        uint32 graceLength;
        uint16 maxDiscountBps;
        uint16 feeBps;
        uint16 quorumBps;
        uint16 securityBps;
        string name;
    }

    struct Round {
        uint64 start;
        uint64 bidEnd;
        uint64 closedAt;
        address bestBidder;
        uint256 bestDiscount;
        uint256 collected;
        address winner;
        uint256 discount;
        uint16 approvals;
        bool closed;
        bool released;
    }

    // ---------------------------------------------------------------- config

    IERC20Minimal public immutable token;
    address public immutable organiser;
    uint256 public immutable share;
    uint8 public immutable size;
    uint32 public immutable roundLength;
    uint32 public immutable graceLength;
    uint16 public immutable maxDiscountBps;
    uint16 public immutable feeBps;
    uint16 public immutable quorumBps;
    uint16 public immutable securityBps;
    string public name;

    // ---------------------------------------------------------------- state

    Phase public phase;
    uint256 public currentRound;
    address[] internal _members;

    mapping(address => bool) public isMember;
    mapping(address => bool) public hasWon;
    mapping(address => uint256) public paidIn;
    mapping(address => uint256) public paidOut;
    mapping(address => uint256) public claimable;
    mapping(address => uint256) public security;
    mapping(address => uint256) public onTimeRounds;

    uint256 public totalClaimable;
    uint256 public totalSecurity;

    mapping(uint256 => Round) internal _rounds;
    mapping(uint256 => mapping(address => bool)) public paid;
    mapping(uint256 => mapping(address => bool)) public approved;

    uint256 public refundPool;
    uint256 public refundBase;
    mapping(address => bool) public refunded;

    uint256 private _lock = 1;

    // ---------------------------------------------------------------- errors

    error BadParams(string what);
    error WrongPhase(Phase expected, Phase actual);
    error NotMember(address account);
    error AlreadyMember(address account);
    error CircleFull();
    error NeedsPqcKey(address account);
    error AlreadyPaid(uint256 round);
    error TooLate(uint256 round);
    error TooEarly(uint256 round);
    error NotEligible(address account);
    error DiscountTooHigh(uint256 discount, uint256 max);
    error BidNotHigher(uint256 discount, uint256 best);
    error AlreadyClosed(uint256 round);
    error NotClosed(uint256 round);
    error AlreadyApproved(uint256 round);
    error AlreadyReleased(uint256 round);
    error NoQuorum(uint16 approvals, uint16 needed);
    error Expired(uint256 deadline);
    error ZeroAddress();
    error NoWinner(uint256 round);
    error NotStalled();
    error NothingToWithdraw();
    error TokenCallFailed();
    error Reentrant();

    // ---------------------------------------------------------------- events

    event CircleOpened(address indexed organiser, address indexed token, uint256 share, uint8 size, string name);

    // ---------------------------------------------------------------- setup

    constructor(Params memory p, address organiser_) {
        if (p.token == address(0) || organiser_ == address(0)) revert ZeroAddress();
        if (p.share == 0) revert BadParams("share");
        if (p.size < 2 || p.size > MAX_MEMBERS) revert BadParams("size");
        if (p.roundLength < 60) revert BadParams("roundLength");
        if (p.graceLength < 60) revert BadParams("graceLength");
        if (p.maxDiscountBps > MAX_DISCOUNT_CAP_BPS) revert BadParams("maxDiscountBps");
        if (p.feeBps > MAX_FEE_BPS) revert BadParams("feeBps");
        if (p.quorumBps <= 5000 || p.quorumBps > 10000) revert BadParams("quorumBps");
        if (p.securityBps > 10000) revert BadParams("securityBps");
        if (bytes(p.name).length == 0 || bytes(p.name).length > 64) revert BadParams("name");

        token = IERC20Minimal(p.token);
        organiser = organiser_;
        share = p.share;
        size = p.size;
        roundLength = p.roundLength;
        graceLength = p.graceLength;
        maxDiscountBps = p.maxDiscountBps;
        feeBps = p.feeBps;
        quorumBps = p.quorumBps;
        securityBps = p.securityBps;
        name = p.name;

        emit CircleOpened(organiser_, p.token, p.share, p.size, p.name);
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier inPhase(Phase expected) {
        if (phase != expected) revert WrongPhase(expected, phase);
        _;
    }

    modifier onlyMember() {
        if (!isMember[msg.sender]) revert NotMember(msg.sender);
        _;
    }

    // ---------------------------------------------------------------- views

    /// @notice Members in the order they joined.
    function members() external view returns (address[] memory) {
        return _members;
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function getRound(uint256 r) external view returns (Round memory) {
        return _rounds[r];
    }

    /// @notice The chit amount: what the pot holds when everyone pays.
    function chitAmount() public view returns (uint256) {
        return share * size;
    }

    /// @notice The highest discount a bid may offer.
    function maxDiscount() public view returns (uint256) {
        return (chitAmount() * maxDiscountBps) / 10000;
    }

    /// @notice Approvals a release needs: more than half (or the configured quorum) of all members.
    function quorumNeeded() public view returns (uint16) {
        return uint16((uint256(size) * quorumBps + 9999) / 10000);
    }
}
