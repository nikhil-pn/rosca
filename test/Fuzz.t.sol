// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaBase} from "./RoscaBase.t.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";

contract FuzzTest is RoscaBase {
    function setUp() public override {
        super.setUp();
        fill();
        payAll();
    }

    /// Any allowed discount splits the pot exactly: nothing is created or lost.
    function testFuzz_quoteAlwaysAddsUpToThePot(uint256 discount) public {
        discount = bound(discount, 0, circle.maxDiscount());
        if (discount > 0) {
            vm.prank(people[1]);
            circle.bid(discount);
        }
        endBidding();
        circle.closeAuction();
        (uint256 payout, uint256 fee, uint256 dividend, uint256 held) = circle.quotePayout(1);
        assertEq(payout + fee + dividend + held, SHARE * SIZE);
        assertLe(fee, (SHARE * SIZE * 500) / 10000, "fee never above 5%");
    }

    /// No bid above the cap is ever accepted.
    function testFuzz_bidAboveCapAlwaysReverts(uint256 discount) public {
        uint256 cap = circle.maxDiscount();
        discount = bound(discount, cap + 1, type(uint128).max);
        vm.prank(people[1]);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.DiscountTooHigh.selector, discount, cap));
        circle.bid(discount);
    }

    /// A random signer can never release the pot, whoever they are.
    function testFuzz_onlyTheWinnersKeyReleases(address signer) public {
        vm.prank(people[1]);
        circle.bid(10e18);
        endBidding();
        circle.closeAuction();
        approveBy(3);
        vm.assume(signer != people[1]);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = signPayout(signer, 1, signer, deadline);
        vm.expectRevert();
        circle.release(signer, deadline, sig);
    }
}
