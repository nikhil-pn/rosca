// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaBase} from "./RoscaBase.t.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";
import {PqcGate} from "../src/libraries/PqcGate.sol";

contract ReleaseTest is RoscaBase {
    address internal winner;

    function setUp() public override {
        super.setUp();
        fill();
        payAll();
        bidAs(people[2], 100e18);
        endBidding();
        vm.prank(people[0]);
        circle.closeAuction();
        winner = people[2];
    }

    function test_release_paysWinnerWithMajorityAndPqcSignature() public {
        approveBy(3);
        (uint256 payout, uint256 fee,,) = circle.quotePayout(1);
        uint256 before = fusd.balanceOf(winner);
        releaseTo(winner);
        assertEq(fusd.balanceOf(winner), before + payout);
        assertEq(fusd.balanceOf(organiser), fee);
        assertTrue(circle.getRound(1).released);
        assertEq(circle.currentRound(), 2);
    }

    function test_release_quoteSplitsThePot() public view {
        (uint256 payout, uint256 fee, uint256 dividend, uint256 held) = circle.quotePayout(1);
        uint256 pot = SHARE * SIZE;
        assertEq(fee, (pot * 200) / 10000);
        assertEq(dividend, 100e18 - fee);
        assertEq(held, ((pot - 100e18) * 5000) / 10000);
        assertEq(payout + held + fee + dividend, pot);
    }

    function test_release_withoutQuorumReverts() public {
        approveBy(2);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = signPayout(winner, 1, winner, deadline);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NoQuorum.selector, 2, 3));
        circle.release(winner, deadline, sig);
    }

    /// A leaked classical key: the attacker controls the winner's address (vm.prank) but signs
    /// with a post-quantum key that is not the one registered for that address.
    function test_release_leakedClassicalKeyCannotRedirectPot() public {
        approveBy(3);
        address thief = makeAddr("thief");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory forged = signPayout(thief, 1, thief, deadline);
        vm.prank(winner);
        vm.expectRevert(abi.encodeWithSelector(PqcGate.BadPqcSignature.selector, winner));
        circle.release(thief, deadline, forged);
    }

    /// A signature for one recipient cannot be reused to pay someone else.
    function test_release_signatureBoundToRecipient() public {
        approveBy(3);
        address thief = makeAddr("thief");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = signPayout(winner, 1, winner, deadline);
        vm.expectRevert(abi.encodeWithSelector(PqcGate.BadPqcSignature.selector, winner));
        circle.release(thief, deadline, sig);
    }

    /// The organiser holds a valid post-quantum key of their own, and still cannot take the pot.
    function test_release_organiserCannotTakePot() public {
        approveBy(3);
        giveKey(organiser);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = signPayout(organiser, 1, organiser, deadline);
        vm.prank(organiser);
        vm.expectRevert(abi.encodeWithSelector(PqcGate.BadPqcSignature.selector, winner));
        circle.release(organiser, deadline, sig);
    }

    function test_release_expiredSignatureReverts() public {
        approveBy(3);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = signPayout(winner, 1, winner, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.Expired.selector, deadline));
        circle.release(winner, deadline, sig);
    }

    function test_release_wrongLengthSignatureReverts() public {
        approveBy(3);
        uint256 deadline = block.timestamp + 1 hours;
        vm.expectRevert(abi.encodeWithSelector(PqcGate.BadSignatureLength.selector, 65));
        circle.release(winner, deadline, new bytes(65));
    }

    /// If the winner's key is removed (for example after a rotation away), the old signature stops working.
    function test_release_needsWinnersKeyStillRegistered() public {
        approveBy(3);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = signPayout(winner, 1, winner, deadline);
        keys.setKey(winner, false, 0, "", false);
        vm.expectRevert(abi.encodeWithSelector(PqcGate.NoPqcKey.selector, winner));
        circle.release(winner, deadline, sig);
    }

    function test_release_payToAnotherAddressTheWinnerChose() public {
        approveBy(3);
        address savings = makeAddr("winner-savings");
        (uint256 payout,,,) = circle.quotePayout(1);
        releaseTo(savings);
        assertEq(fusd.balanceOf(savings), payout);
    }

    function test_release_twiceReverts() public {
        approveBy(3);
        releaseTo(winner);
        assertEq(circle.currentRound(), 2);
        uint256 deadline = block.timestamp + 1 hours;
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NotClosed.selector, 2));
        circle.release(winner, deadline, new bytes(4627));
    }

    function test_approve_twiceReverts() public {
        vm.startPrank(people[0]);
        circle.approveRelease();
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.AlreadyApproved.selector, 1));
        circle.approveRelease();
        vm.stopPrank();
    }

    function test_approve_nonMemberReverts() public {
        vm.prank(organiser);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NotMember.selector, organiser));
        circle.approveRelease();
    }

    function test_release_sharesDividendWithEveryone() public {
        approveBy(3);
        (,, uint256 dividend,) = circle.quotePayout(1);
        releaseTo(winner);
        uint256 each = dividend / SIZE;
        for (uint256 i; i < people.length; ++i) {
            if (people[i] != winner) assertEq(circle.claimable(people[i]), each);
        }
        assertEq(circle.totalClaimable(), dividend);
    }

    function test_release_holdsSecurityForWinnersFutureShares() public {
        approveBy(3);
        (,,, uint256 held) = circle.quotePayout(1);
        releaseTo(winner);
        assertEq(circle.security(winner), held);
        assertLe(held, SHARE * (SIZE - 1));
    }
}
