// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaBase} from "./RoscaBase.t.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

/// @notice Audit stage 1, findings 1, 2 and 4: a token that re-enters the circle while it pays out,
/// a stranger closing an auction, and a token address with no code.
contract ReentrancyTest is RoscaBase {
    ReentrantToken internal evil;

    /// A circle whose token tries to re-enter, with all five members in and paid up for round 1.
    function openEvilCircle() internal {
        evil = new ReentrantToken();
        RoscaCircle.Params memory p = defaultParams();
        p.token = address(evil);
        circle = openCircle(p);
        for (uint256 i; i < people.length; ++i) {
            evil.mint(people[i], 10_000e18);
            vm.prank(people[i]);
            evil.approve(address(circle), type(uint256).max);
        }
        fill();
    }

    function test_release_reentryDuringPayoutFails() public {
        openEvilCircle();
        payAll();
        bidAs(people[1], 50e18);
        endBidding();
        vm.prank(people[0]);
        circle.closeAuction();
        approveBy(circle.quorumNeeded());

        // While the pot is being sent, the token tries to release the same round again.
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = signPayout(people[1], 1, people[1], deadline);
        evil.arm(address(circle), abi.encodeCall(RoscaCircle.release, (people[1], deadline, sig)));
        circle.release(people[1], deadline, sig);

        assertTrue(evil.tried(), "the token tried to re-enter");
        assertFalse(evil.reentrySucceeded(), "the nested release must fail");
        assertTrue(circle.getRound(1).released);
        assertEq(circle.currentRound(), 2, "exactly one release happened");
    }

    function test_withdraw_reentryDuringWithdrawFails() public {
        openEvilCircle();
        runRound(people[1], 50e18); // leaves a discount dividend for every member
        uint256 owed = circle.withdrawable(people[2]);
        assertGt(owed, 0);
        uint256 before = evil.balanceOf(people[2]);

        // While paying people[2], the token makes the circle's own call to withdraw again.
        evil.arm(address(circle), abi.encodeCall(RoscaCircle.withdraw, ()));
        vm.prank(people[2]);
        circle.withdraw();

        assertTrue(evil.tried());
        assertFalse(evil.reentrySucceeded(), "the nested withdraw must fail");
        assertEq(evil.balanceOf(people[2]) - before, owed, "paid exactly once");
        assertEq(circle.withdrawable(people[2]), 0);
    }

    function test_close_strangerCannotClose() public {
        fill();
        payAll();
        endBidding();
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NotMember.selector, stranger));
        circle.closeAuction();
    }

    function test_params_rejectTokenWithoutCode() public {
        RoscaCircle.Params memory p = defaultParams();
        p.token = makeAddr("not-a-contract");
        vm.prank(organiser);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.BadParams.selector, "token"));
        factory.createCircle(p);
    }
}
