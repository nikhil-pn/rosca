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
        // A call to an address with no code "succeeds" with empty return data, so a token that is
        // not a contract would let pay() record money that never arrived.
        if (p.token.code.length == 0) revert BadParams("token");
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

    // ---------------------------------------------------------------- joining

    event Joined(address indexed member, uint256 index);
    event RoundStarted(uint256 indexed round, uint64 start, uint64 bidEnd);

    /// @notice Join the circle. Only accounts with a registered ML-DSA-87 key (with proof of
    /// possession) can join, because only they can sign a payout.
    function join() external inPhase(Phase.Forming) {
        if (isMember[msg.sender]) revert AlreadyMember(msg.sender);
        if (_members.length >= size) revert CircleFull();
        if (!PqcGate.hasUsableKey(msg.sender)) revert NeedsPqcKey(msg.sender);

        isMember[msg.sender] = true;
        _members.push(msg.sender);
        emit Joined(msg.sender, _members.length - 1);

        if (_members.length == size) {
            phase = Phase.Running;
            _startRound(1);
        }
    }

    function _startRound(uint256 r) internal {
        currentRound = r;
        uint64 start = uint64(block.timestamp);
        uint64 bidEnd = start + roundLength;
        _rounds[r].start = start;
        _rounds[r].bidEnd = bidEnd;
        emit RoundStarted(r, start, bidEnd);
    }

    // ---------------------------------------------------------------- paying

    event Paid(uint256 indexed round, address indexed member, uint256 amount);

    /// @notice Pay this round's share. Allowed until the auction ends.
    function pay() external nonReentrant inPhase(Phase.Running) onlyMember {
        uint256 r = currentRound;
        Round storage rd = _rounds[r];
        if (paid[r][msg.sender]) revert AlreadyPaid(r);
        if (rd.closed || block.timestamp > rd.bidEnd) revert TooLate(r);

        paid[r][msg.sender] = true;
        rd.collected += share;
        paidIn[msg.sender] += share;
        onTimeRounds[msg.sender] += 1;

        _pull(msg.sender, share);
        emit Paid(r, msg.sender, share);
    }

    /// @dev Both token helpers check the call succeeded and, if the token returns a value, that it
    /// is true. The token always has code (checked in the constructor). Every function that moves
    /// money is nonReentrant and finishes its state changes before calling the token.
    function _pull(address from, uint256 amount) internal {
        (bool ok, bytes memory ret) =
            address(token).call(abi.encodeCall(IERC20Minimal.transferFrom, (from, address(this), amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCallFailed();
    }

    function _push(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCallFailed();
    }

    // ---------------------------------------------------------------- auction

    event Bid(uint256 indexed round, address indexed member, uint256 discount);
    event SecurityApplied(uint256 indexed round, address indexed member, uint256 amount);
    event AuctionClosed(uint256 indexed round, address indexed winner, uint256 discount, uint256 collected);

    /// @notice Bid the discount you accept to take this round's pot. A higher discount wins,
    /// as in a chit fund auction. Only members who paid this round and have not won before can bid.
    function bid(uint256 discount) external inPhase(Phase.Running) onlyMember {
        uint256 r = currentRound;
        Round storage rd = _rounds[r];
        if (rd.closed || block.timestamp > rd.bidEnd) revert TooLate(r);
        if (hasWon[msg.sender] || !paid[r][msg.sender]) revert NotEligible(msg.sender);
        uint256 cap = maxDiscount();
        if (discount > cap) revert DiscountTooHigh(discount, cap);
        if (rd.bestBidder != address(0) && discount <= rd.bestDiscount) revert BidNotHigher(discount, rd.bestDiscount);

        rd.bestBidder = msg.sender;
        rd.bestDiscount = discount;
        emit Bid(r, msg.sender, discount);
    }

    /// @notice Close the auction once the bidding time is over. Any member can call it, so no
    /// single member can hold a round up. The winner follows fixed rules, whoever calls.
    /// Past winners who did not pay are covered from the security held back from their payout.
    /// With no bid, the earliest-joined eligible member takes the pot at no discount.
    /// The loop below runs over the members, at most MAX_MEMBERS (50), so its gas is bounded.
    function closeAuction() external inPhase(Phase.Running) onlyMember {
        uint256 r = currentRound;
        Round storage rd = _rounds[r];
        if (rd.closed) revert AlreadyClosed(r);
        if (block.timestamp <= rd.bidEnd) revert TooEarly(r);

        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            address m = _members[i];
            if (!paid[r][m] && hasWon[m] && security[m] >= share) {
                security[m] -= share;
                totalSecurity -= share;
                paid[r][m] = true;
                paidIn[m] += share;
                rd.collected += share;
                emit SecurityApplied(r, m, share);
            }
        }

        address winner = rd.bestBidder;
        uint256 discount = rd.bestDiscount;
        if (winner == address(0)) {
            for (uint256 i; i < n; ++i) {
                address m = _members[i];
                if (!hasWon[m] && paid[r][m]) {
                    winner = m;
                    break;
                }
            }
            discount = 0;
        }
        if (winner == address(0)) revert NoWinner(r);

        rd.closed = true;
        rd.closedAt = uint64(block.timestamp);
        rd.winner = winner;
        rd.discount = discount;
        hasWon[winner] = true;
        emit AuctionClosed(r, winner, discount, rd.collected);
    }

    // ---------------------------------------------------------------- release

    event Approved(uint256 indexed round, address indexed member, uint16 approvals);
    event Released(
        uint256 indexed round,
        address indexed winner,
        address recipient,
        uint256 payout,
        uint256 discount,
        uint256 fee,
        uint256 securityHeld
    );
    event Completed();

    /// @notice What a release of round `r` pays out, split into its parts.
    /// @dev Solidity 0.8 reverts on overflow. Every term is bounded by the pot (share × size) and a
    /// basis-point fraction of it, so no realistic share size comes near the limit.
    function quotePayout(uint256 r)
        public
        view
        returns (uint256 payout, uint256 fee, uint256 dividend, uint256 securityHeld)
    {
        Round storage rd = _rounds[r];
        if (!rd.closed) revert NotClosed(r);
        uint256 pot = rd.collected;
        uint256 discount = rd.discount;
        fee = (pot * feeBps) / 10000;
        if (fee > discount) fee = discount;
        dividend = discount - fee;
        uint256 gross = pot - discount;
        uint256 futureDues = share * (uint256(size) - r);
        securityHeld = (gross * securityBps) / 10000;
        if (securityHeld > futureDues) securityHeld = futureDues;
        payout = gross - securityHeld;
    }

    /// @notice The exact bytes the winner signs with their ML-DSA-87 key to release round `r`
    /// to `recipient` before `deadline`.
    function payoutMessage(uint256 r, address recipient, uint256 deadline) public view returns (bytes memory) {
        (uint256 payout,,,) = quotePayout(r);
        return abi.encode(PAYOUT_TAG, block.chainid, address(this), r, recipient, payout, deadline);
    }

    /// @notice Approve the release of the current round's pot to its winner.
    function approveRelease() external inPhase(Phase.Running) onlyMember {
        uint256 r = currentRound;
        Round storage rd = _rounds[r];
        if (!rd.closed) revert NotClosed(r);
        if (rd.released) revert AlreadyReleased(r);
        if (approved[r][msg.sender]) revert AlreadyApproved(r);
        approved[r][msg.sender] = true;
        rd.approvals += 1;
        emit Approved(r, msg.sender, rd.approvals);
    }

    /// @notice Release the current round's pot. Anyone may submit it, but it needs a majority of
    /// approvals and the winner's ML-DSA-87 signature over `payoutMessage`. A leaked classical
    /// (ECDSA) key cannot produce that signature, so it cannot redirect the pot.
    function release(address recipient, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
        inPhase(Phase.Running)
    {
        uint256 r = currentRound;
        Round storage rd = _rounds[r];
        if (!rd.closed) revert NotClosed(r);
        if (rd.released) revert AlreadyReleased(r);
        if (recipient == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert Expired(deadline);
        uint16 needed = quorumNeeded();
        if (rd.approvals < needed) revert NoQuorum(rd.approvals, needed);

        address winner = rd.winner;
        PqcGate.requireSignedBy(winner, payoutMessage(r, recipient, deadline), signature);

        (uint256 payout, uint256 fee, uint256 dividend, uint256 held) = quotePayout(r);
        rd.released = true;
        paidOut[winner] += payout;
        if (held != 0) {
            security[winner] += held;
            totalSecurity += held;
        }
        _shareDividend(dividend, winner);

        _push(recipient, payout);
        _push(organiser, fee);
        emit Released(r, winner, recipient, payout, rd.discount, fee, held);

        if (r == size) {
            phase = Phase.Completed;
            emit Completed();
        } else {
            _startRound(r + 1);
        }
    }

    function _shareDividend(uint256 dividend, address winner) internal {
        if (dividend == 0) return;
        uint256 n = _members.length;
        uint256 each = dividend / n;
        for (uint256 i; i < n; ++i) {
            claimable[_members[i]] += each;
        }
        claimable[winner] += dividend - each * n;
        totalClaimable += dividend;
    }

    // ---------------------------------------------------------------- withdrawing and dissolving

    event Withdrawn(address indexed member, uint256 amount);
    event Dissolved(uint256 indexed round, uint256 refundPool, uint256 refundBase);

    /// @notice True if the current round has stalled long enough for members to dissolve the circle.
    function isStalled() public view returns (bool) {
        if (phase != Phase.Running) return false;
        Round storage rd = _rounds[currentRound];
        if (!rd.closed) return block.timestamp > uint256(rd.bidEnd) + graceLength;
        return !rd.released && block.timestamp > uint256(rd.closedAt) + graceLength;
    }

    /// @notice What a member put in minus what they took out (never below zero).
    function netContribution(address m) public view returns (uint256) {
        uint256 inAmt = paidIn[m];
        uint256 outAmt = paidOut[m];
        return inAmt > outAmt ? inAmt - outAmt : 0;
    }

    /// @notice A member's share of the refund pool after the circle was dissolved.
    function refundShare(address m) public view returns (uint256) {
        if (phase != Phase.Dissolved || refunded[m] || refundBase == 0) return 0;
        return (refundPool * netContribution(m)) / refundBase;
    }

    /// @notice What `m` can withdraw now: dividends, plus security once the circle has ended,
    /// plus a refund share if it was dissolved.
    function withdrawable(address m) public view returns (uint256 amount) {
        amount = claimable[m];
        if (phase == Phase.Completed || phase == Phase.Dissolved) amount += security[m];
        amount += refundShare(m);
    }

    /// @notice Withdraw your own dividends, security and refund. Money only ever goes to the caller.
    function withdraw() external nonReentrant onlyMember {
        uint256 amount = claimable[msg.sender];
        if (amount != 0) {
            claimable[msg.sender] = 0;
            totalClaimable -= amount;
        }
        if (phase == Phase.Completed || phase == Phase.Dissolved) {
            uint256 sec = security[msg.sender];
            if (sec != 0) {
                security[msg.sender] = 0;
                totalSecurity -= sec;
                amount += sec;
            }
        }
        uint256 refund = refundShare(msg.sender);
        if (refund != 0) {
            refunded[msg.sender] = true;
            amount += refund;
        }
        if (amount == 0) revert NothingToWithdraw();
        _push(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Dissolve a stalled circle. Any member can call it once the round has stalled for
    /// the grace period. The money that is left goes back to members in proportion to what each
    /// put in minus what each took out.
    function dissolve() external onlyMember inPhase(Phase.Running) {
        if (!isStalled()) revert NotStalled();
        uint256 balance = token.balanceOf(address(this));
        uint256 owed = totalClaimable + totalSecurity;
        refundPool = balance > owed ? balance - owed : 0;
        uint256 base;
        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            base += netContribution(_members[i]);
        }
        refundBase = base;
        phase = Phase.Dissolved;
        emit Dissolved(currentRound, refundPool, base);
    }
}
