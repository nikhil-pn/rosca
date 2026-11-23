// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaBase} from "./RoscaBase.t.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";
import {PqcGate} from "../src/libraries/PqcGate.sol";
import {MockPqcPrecompile} from "./mocks/MockPqcPrecompile.sol";

/// Bids carry the bidder's ML-DSA-87 signature, and only members who paid every round can take a pot.
contract EligibilityTest is RoscaBase {
    function setUp() public override {
        super.setUp();
        fill();
    }

    function payAllBut(address skipper) internal {
        for (uint256 i; i < people.length; ++i) {
            if (people[i] == skipper) continue;
            vm.prank(people[i]);
            circle.pay();
        }
    }

    /// A thief with a member's classical key can send transactions as that member, but cannot make
    /// the member's ML-DSA-87 signature, so cannot bid them into a costly discount.
    function test_bid_stolenClassicalKeyCannotBid() public {
        payAll();
        address victim = people[2];
        uint256 cap = circle.maxDiscount();
        uint256 deadline = block.timestamp + 1 hours;
        // The thief signs with their own post-quantum key, not the victim's.
        bytes memory forged = MockPqcPrecompile(PQC_VERIFY).mockSign(
            pubkeyOf(makeAddr("thief")), circle.bidMessage(1, victim, cap, deadline)
        );
        vm.prank(victim);
        vm.expectRevert(abi.encodeWithSelector(PqcGate.BadPqcSignature.selector, victim));
        circle.bid(cap, deadline, forged);
        assertEq(circle.getRound(1).bestBidder, address(0), "no bid recorded");
    }

    /// A member's real bid signature can't be replayed by another member or for another discount.
    function test_bid_signatureBoundToBidderAndDiscount() public {
        payAll();
        (uint256 dl, bytes memory sig) = bidSig(circle, people[1], 10e18);
        vm.prank(people[3]);
        vm.expectRevert(abi.encodeWithSelector(PqcGate.BadPqcSignature.selector, people[3]));
        circle.bid(10e18, dl, sig);
        vm.prank(people[1]);
        vm.expectRevert(abi.encodeWithSelector(PqcGate.BadPqcSignature.selector, people[1]));
        circle.bid(20e18, dl, sig);
    }

    function test_bid_expiredSignatureReverts() public {
        payAll();
        (uint256 dl, bytes memory sig) = bidSig(circle, people[1], 10e18);
        vm.warp(dl + 1); // an hour on: the signature has expired, bidding (a day) is still open
        vm.prank(people[1]);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.Expired.selector, dl));
        circle.bid(10e18, dl, sig);
    }

    /// Skipping a share and paying later does not make you eligible: you must pay every round.
    function test_skipper_cannotBidInALaterRound() public {
        address skipper = people[4];
        payAllBut(skipper);
        bidAs(people[1], 50e18);
        endBidding();
        vm.prank(people[0]);
        circle.closeAuction();
        approveBy(circle.quorumNeeded());
        releaseTo(people[1]);

        payAll(); // the skipper pays round 2
        assertFalse(circle.isEligible(skipper, 2));
        (uint256 dl, bytes memory sig) = bidSig(circle, skipper, 10e18);
        vm.prank(skipper);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NotEligible.selector, skipper));
        circle.bid(10e18, dl, sig);
    }

    /// With no bids, the pot goes to the earliest member who paid every round, never to a skipper.
    function test_skipper_isNeverPickedByDefault() public {
        address skipper = people[0]; // the earliest member, first in line by default
        payAllBut(skipper);
        endBidding();
        vm.prank(people[1]);
        circle.closeAuction();
        assertEq(circle.getRound(1).winner, people[1], "the next eligible member wins");
        assertFalse(circle.hasWon(skipper));
    }

    /// The discount is shared only among the members who paid the round.
    function test_dividend_onlyToMembersWhoPaid() public {
        address skipper = people[4];
        payAllBut(skipper);
        bidAs(people[1], 40e18);
        endBidding();
        vm.prank(people[0]);
        circle.closeAuction();
        approveBy(circle.quorumNeeded());
        releaseTo(people[1]);
        assertEq(circle.claimable(skipper), 0, "no dividend for a skipped round");
        (,, uint256 dividend,) = circle.quotePayout(1);
        assertEq(circle.claimable(people[2]), dividend / 4, "split among the four payers");
    }
}
