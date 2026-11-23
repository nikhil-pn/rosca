// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaBase} from "./RoscaBase.t.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPqcPrecompile} from "./mocks/MockPqcPrecompile.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Drives a circle with random members, bids and timing for the invariant fuzzer.
contract CircleHandler is Test {
    RoscaCircle internal circle;
    MockERC20 internal fusd;
    address[] internal people;
    MockPqcPrecompile internal verifier = MockPqcPrecompile(0x0000000000000000000000000000000000000a01);

    constructor(RoscaCircle c, MockERC20 t, address[] memory p) {
        circle = c;
        fusd = t;
        people = p;
    }

    function pay(uint256 who) external {
        address m = people[who % people.length];
        if (circle.phase() != RoscaCircle.Phase.Running) return;
        uint256 r = circle.currentRound();
        if (circle.paid(r, m) || block.timestamp > circle.getRound(r).bidEnd) return;
        vm.prank(m);
        circle.pay();
    }

    function bid(uint256 who, uint256 discount) external {
        address m = people[who % people.length];
        if (circle.phase() != RoscaCircle.Phase.Running) return;
        uint256 r = circle.currentRound();
        RoscaCircle.Round memory rd = circle.getRound(r);
        if (rd.closed || block.timestamp > rd.bidEnd || !circle.isEligible(m, r)) return;
        discount = bound(discount, rd.bestDiscount + 1, circle.maxDiscount() + 1);
        if (discount > circle.maxDiscount()) return;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = verifier.mockSign(keyOf(m), circle.bidMessage(r, m, discount, deadline));
        vm.prank(m);
        circle.bid(discount, deadline, sig);
    }

    function advance(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }

    function close() external {
        if (circle.phase() != RoscaCircle.Phase.Running) return;
        RoscaCircle.Round memory rd = circle.getRound(circle.currentRound());
        if (rd.closed || block.timestamp <= rd.bidEnd) return;
        vm.prank(people[0]);
        try circle.closeAuction() {} catch {}
    }

    function approveAndRelease() external {
        if (circle.phase() != RoscaCircle.Phase.Running) return;
        uint256 r = circle.currentRound();
        RoscaCircle.Round memory rd = circle.getRound(r);
        if (!rd.closed || rd.released) return;
        for (uint256 i; i < people.length; ++i) {
            if (!circle.approved(r, people[i])) {
                vm.prank(people[i]);
                circle.approveRelease();
            }
        }
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory message = circle.payoutMessage(r, rd.winner, deadline);
        circle.release(rd.winner, deadline, verifier.mockSign(keyOf(rd.winner), message));
    }

    function keyOf(address a) internal pure returns (bytes memory pk) {
        pk = new bytes(2592);
        bytes32 seed = keccak256(abi.encode("mldsa87", a));
        assembly {
            mstore(add(pk, 32), seed)
        }
    }

    function withdraw(uint256 who) external {
        address m = people[who % people.length];
        if (circle.withdrawable(m) == 0) return;
        vm.prank(m);
        circle.withdraw();
    }

    function dissolve(uint256 who) external {
        if (!circle.isStalled()) return;
        vm.prank(people[who % people.length]);
        circle.dissolve();
    }
}

contract InvariantTest is RoscaBase {
    CircleHandler internal handler;

    function setUp() public override {
        super.setUp();
        fill();
        handler = new CircleHandler(circle, fusd, people);
        targetContract(address(handler));
    }

    /// The pot always holds at least what it owes members as dividends and security.
    function invariant_potCoversWhatItOwes() public view {
        assertGe(fusd.balanceOf(address(circle)), circle.totalClaimable() + circle.totalSecurity());
    }

    /// No money appears or disappears: members, organiser and pot always add up to the start.
    function invariant_moneyIsConserved() public view {
        uint256 total = fusd.balanceOf(address(circle)) + fusd.balanceOf(organiser);
        for (uint256 i; i < people.length; ++i) total += fusd.balanceOf(people[i]);
        assertEq(total, 10_000e18 * people.length);
    }

    /// Nobody wins more than once.
    function invariant_winnersNeverExceedRounds() public view {
        uint256 winners;
        for (uint256 i; i < people.length; ++i) if (circle.hasWon(people[i])) winners++;
        assertLe(winners, circle.currentRound());
    }
}
