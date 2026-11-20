// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaBase} from "./RoscaBase.t.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";

contract PayTest is RoscaBase {
    function setUp() public override {
        super.setUp();
        fill();
    }

    function test_pay_movesShareIntoPot() public {
        uint256 before = fusd.balanceOf(people[0]);
        vm.prank(people[0]);
        circle.pay();
        assertEq(fusd.balanceOf(people[0]), before - SHARE);
        assertEq(fusd.balanceOf(address(circle)), SHARE);
        assertTrue(circle.paid(1, people[0]));
        assertEq(circle.getRound(1).collected, SHARE);
        assertEq(circle.paidIn(people[0]), SHARE);
        assertEq(circle.onTimeRounds(people[0]), 1);
    }

    function test_pay_twiceReverts() public {
        vm.startPrank(people[0]);
        circle.pay();
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.AlreadyPaid.selector, 1));
        circle.pay();
        vm.stopPrank();
    }

    function test_pay_afterBiddingReverts() public {
        endBidding();
        vm.prank(people[0]);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.TooLate.selector, 1));
        circle.pay();
    }

    function test_pay_nonMemberReverts() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NotMember.selector, stranger));
        circle.pay();
    }

    function test_pay_beforeCircleFullReverts() public {
        RoscaCircle fresh = openCircle(defaultParams());
        vm.prank(people[0]);
        fresh.join();
        vm.prank(people[0]);
        vm.expectRevert(
            abi.encodeWithSelector(RoscaCircle.WrongPhase.selector, RoscaCircle.Phase.Running, RoscaCircle.Phase.Forming)
        );
        fresh.pay();
    }

    function test_pay_allMembersFillThePot() public {
        payAll();
        assertEq(fusd.balanceOf(address(circle)), circle.chitAmount());
        assertEq(circle.getRound(1).collected, SHARE * SIZE);
    }
}
