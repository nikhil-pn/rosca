// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaBase} from "./RoscaBase.t.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";

contract AuctionTest is RoscaBase {
    function setUp() public override {
        super.setUp();
        fill();
        payAll();
    }

    function test_bid_recordsBest() public {
        bidAs(people[1], 50e18);
        RoscaCircle.Round memory r = circle.getRound(1);
        assertEq(r.bestBidder, people[1]);
        assertEq(r.bestDiscount, 50e18);
    }

    function test_bid_mustBeHigher() public {
        bidAs(people[1], 50e18);
        (uint256 dl, bytes memory sig) = bidSig(circle, people[2], 50e18);
        vm.prank(people[2]);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.BidNotHigher.selector, 50e18, 50e18));
        circle.bid(50e18, dl, sig);
    }

    function test_bid_higherDiscountTakesTheLead() public {
        bidAs(people[1], 50e18);
        bidAs(people[2], 80e18);
        assertEq(circle.getRound(1).bestBidder, people[2]);
    }

    function test_bid_capIsFortyPercentAtMost() public {
        uint256 cap = circle.maxDiscount();
        assertEq(cap, (SHARE * SIZE * 3000) / 10000);
        (uint256 dl, bytes memory sig) = bidSig(circle, people[1], cap + 1);
        vm.prank(people[1]);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.DiscountTooHigh.selector, cap + 1, cap));
        circle.bid(cap + 1, dl, sig);
    }

    function test_bid_needsPaymentFirst() public {
        RoscaCircle fresh = openCircle(defaultParams());
        for (uint256 i; i < people.length; ++i) {
            vm.prank(people[i]);
            fresh.join();
        }
        (uint256 dl, bytes memory sig) = bidSig(fresh, people[0], 1e18);
        vm.prank(people[0]);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NotEligible.selector, people[0]));
        fresh.bid(1e18, dl, sig);
    }

    function test_bid_afterBiddingReverts() public {
        (uint256 dl, bytes memory sig) = bidSig(circle, people[1], 1e18);
        endBidding();
        vm.prank(people[1]);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.TooLate.selector, 1));
        circle.bid(1e18, dl, sig);
    }

    function test_close_tooEarlyReverts() public {
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.TooEarly.selector, 1));
        vm.prank(people[0]);
        circle.closeAuction();
    }

    function test_close_bestBidderWins() public {
        bidAs(people[3], 70e18);
        endBidding();
        vm.prank(people[0]);
        circle.closeAuction();
        RoscaCircle.Round memory r = circle.getRound(1);
        assertTrue(r.closed);
        assertEq(r.winner, people[3]);
        assertEq(r.discount, 70e18);
        assertTrue(circle.hasWon(people[3]));
    }

    function test_close_noBidGivesEarliestEligibleNoDiscount() public {
        endBidding();
        vm.prank(people[0]);
        circle.closeAuction();
        RoscaCircle.Round memory r = circle.getRound(1);
        assertEq(r.winner, people[0]);
        assertEq(r.discount, 0);
    }

    function test_close_twiceReverts() public {
        endBidding();
        vm.prank(people[0]);
        circle.closeAuction();
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.AlreadyClosed.selector, 1));
        vm.prank(people[0]);
        circle.closeAuction();
    }

    function test_bid_pastWinnerCannotBidAgain() public {
        bidAs(people[1], 40e18);
        endBidding();
        vm.prank(people[0]);
        circle.closeAuction();
        approveBy(circle.quorumNeeded());
        releaseTo(people[1]);
        payAll();
        (uint256 dl, bytes memory sig) = bidSig(circle, people[1], 10e18);
        vm.prank(people[1]);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NotEligible.selector, people[1]));
        circle.bid(10e18, dl, sig);
    }
}
