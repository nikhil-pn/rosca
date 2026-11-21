// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaBase} from "./RoscaBase.t.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";

contract ExitTest is RoscaBase {
    function setUp() public override {
        super.setUp();
        fill();
    }

    function test_withdraw_dividendGoesToCallerOnly() public {
        runRound(people[1], 100e18);
        uint256 owed = circle.claimable(people[0]);
        assertGt(owed, 0);
        uint256 before = fusd.balanceOf(people[0]);
        vm.prank(people[0]);
        circle.withdraw();
        assertEq(fusd.balanceOf(people[0]), before + owed);
        assertEq(circle.claimable(people[0]), 0);
    }

    function test_withdraw_nothingReverts() public {
        vm.prank(people[0]);
        vm.expectRevert(RoscaCircle.NothingToWithdraw.selector);
        circle.withdraw();
    }

    function test_withdraw_securityLockedUntilCircleEnds() public {
        runRound(people[1], 100e18);
        uint256 dividend = circle.claimable(people[1]);
        vm.prank(people[1]);
        circle.withdraw();
        assertGt(circle.security(people[1]), 0, "security still held");
        assertEq(circle.withdrawable(people[1]), 0);
        assertGt(dividend, 0);
    }

    function test_fullCircle_everyoneWinsOnceAndThePotEmpties() public {
        runRound(people[1], 120e18);
        runRound(people[3], 80e18);
        runRound(people[0], 40e18);
        runRound(people[4], 10e18);
        runRound(address(0), 0);
        assertEq(uint8(circle.phase()), uint8(RoscaCircle.Phase.Completed));
        for (uint256 i; i < people.length; ++i) {
            assertTrue(circle.hasWon(people[i]));
            if (circle.withdrawable(people[i]) > 0) {
                vm.prank(people[i]);
                circle.withdraw();
            }
        }
        assertEq(fusd.balanceOf(address(circle)), 0, "nothing left behind");
    }

    function test_fullCircle_moneyIsConserved() public {
        uint256 start;
        for (uint256 i; i < people.length; ++i) start += fusd.balanceOf(people[i]);
        runRound(people[1], 120e18);
        runRound(people[3], 80e18);
        runRound(people[0], 40e18);
        runRound(people[4], 10e18);
        runRound(address(0), 0);
        uint256 end;
        for (uint256 i; i < people.length; ++i) {
            if (circle.withdrawable(people[i]) > 0) {
                vm.prank(people[i]);
                circle.withdraw();
            }
            end += fusd.balanceOf(people[i]);
        }
        assertEq(end + fusd.balanceOf(organiser), start, "only the capped fee left the members");
    }

    function test_securityCoversAPastWinnerWhoStopsPaying() public {
        runRound(people[1], 120e18);
        uint256 held = circle.security(people[1]);
        for (uint256 i; i < people.length; ++i) {
            if (people[i] == people[1]) continue;
            vm.prank(people[i]);
            circle.pay();
        }
        endBidding();
        vm.prank(people[0]);
        circle.closeAuction();
        assertTrue(circle.paid(2, people[1]), "covered from security");
        assertEq(circle.security(people[1]), held - SHARE);
        assertEq(circle.getRound(2).collected, SHARE * SIZE);
    }

    function test_dissolve_onlyAfterStall() public {
        payAll();
        vm.prank(people[0]);
        vm.expectRevert(RoscaCircle.NotStalled.selector);
        circle.dissolve();
        vm.warp(circle.getRound(1).bidEnd + GRACE + 1);
        assertTrue(circle.isStalled());
        vm.prank(people[0]);
        circle.dissolve();
        assertEq(uint8(circle.phase()), uint8(RoscaCircle.Phase.Dissolved));
    }

    function test_dissolve_refundsWhatEachPutIn() public {
        payAll();
        endBidding();
        vm.prank(people[0]);
        circle.closeAuction();
        vm.warp(block.timestamp + GRACE + 1);
        vm.prank(people[0]);
        circle.dissolve();
        for (uint256 i; i < people.length; ++i) {
            assertEq(circle.refundShare(people[i]), SHARE);
            uint256 before = fusd.balanceOf(people[i]);
            vm.prank(people[i]);
            circle.withdraw();
            assertEq(fusd.balanceOf(people[i]), before + SHARE);
        }
        assertEq(fusd.balanceOf(address(circle)), 0);
    }

    function test_dissolve_afterSomeRoundsIsFair() public {
        runRound(people[1], 120e18);
        payAll();
        vm.warp(circle.getRound(2).bidEnd + GRACE + 1);
        vm.prank(people[2]);
        circle.dissolve();
        uint256 paidOutTotal;
        for (uint256 i; i < people.length; ++i) {
            if (circle.withdrawable(people[i]) > 0) {
                vm.prank(people[i]);
                circle.withdraw();
            }
            paidOutTotal += fusd.balanceOf(people[i]);
        }
        assertLe(fusd.balanceOf(address(circle)), SIZE, "at most rounding dust stays");
    }

    /// A winner takes a pot, then the circle stalls before they have paid their later shares.
    /// The security held from their payout goes to the members who paid in and never took a pot.
    function test_dissolve_heldSecurityGoesToMembersNotYetPaid() public {
        runRound(address(0), 0); // people[0] wins 500 at no discount: 250 paid out, 250 held
        address winner = people[0];
        uint256 held = circle.security(winner);
        assertEq(held, 250e18);
        vm.warp(circle.getRound(2).bidEnd + GRACE + 1);
        vm.prank(people[2]);
        circle.dissolve();

        assertEq(circle.refundPool(), held, "security joins the refund pool");
        assertEq(circle.totalSecurity(), 0);
        assertEq(circle.security(winner), 0);
        assertEq(circle.withdrawable(winner), 0, "the winner took 250 for 100 paid in; nothing more");
        for (uint256 i = 1; i < people.length; ++i) {
            uint256 refund = circle.refundShare(people[i]);
            assertEq(refund, held / 4, "the four members who never took a pot share it equally");
            uint256 before = fusd.balanceOf(people[i]);
            vm.prank(people[i]);
            circle.withdraw();
            assertEq(fusd.balanceOf(people[i]), before + refund);
        }
        vm.prank(winner);
        vm.expectRevert(RoscaCircle.NothingToWithdraw.selector);
        circle.withdraw();
        assertEq(fusd.balanceOf(address(circle)), 0);
    }

    /// Two winners kept paying, then the circle stalls. Their security is shared by the three
    /// members still waiting for a pot.
    function test_dissolve_winnersDoNotGetSecurityBack() public {
        runRound(address(0), 0);
        runRound(address(0), 0);
        vm.warp(circle.getRound(3).bidEnd + GRACE + 1);
        vm.prank(people[4]);
        circle.dissolve();
        for (uint256 i; i < 2; ++i) {
            assertEq(circle.withdrawable(people[i]), 0, "winners already took more than they paid");
        }
        uint256 refund = circle.refundShare(people[2]);
        assertEq(refund, circle.refundShare(people[3]));
        assertEq(refund, circle.refundShare(people[4]));
        assertApproxEqAbs(refund * 3, circle.refundPool(), 2);
    }

    function test_dissolve_nonMemberReverts() public {
        vm.warp(circle.getRound(1).bidEnd + GRACE + 1);
        vm.prank(organiser);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NotMember.selector, organiser));
        circle.dissolve();
    }
}
