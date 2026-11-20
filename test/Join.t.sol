// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaBase} from "./RoscaBase.t.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";

contract JoinTest is RoscaBase {
    function test_join_addsMember() public {
        vm.prank(people[0]);
        circle.join();
        assertTrue(circle.isMember(people[0]));
        assertEq(circle.memberCount(), 1);
        assertEq(uint8(circle.phase()), uint8(RoscaCircle.Phase.Forming));
    }

    function test_join_fullCircleStartsRoundOne() public {
        fill();
        assertEq(uint8(circle.phase()), uint8(RoscaCircle.Phase.Running));
        assertEq(circle.currentRound(), 1);
        RoscaCircle.Round memory r = circle.getRound(1);
        assertEq(r.start, block.timestamp);
        assertEq(r.bidEnd, block.timestamp + ROUND);
    }

    function test_join_refusesAccountWithoutPqcKey() public {
        address stranger = makeAddr("no-key");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NeedsPqcKey.selector, stranger));
        circle.join();
    }

    function test_join_refusesKeyWithoutProofOfPossession() public {
        address a = makeAddr("unproven");
        keys.setKey(a, true, 1, pubkeyOf(a), false);
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NeedsPqcKey.selector, a));
        circle.join();
    }

    function test_join_refusesOtherAlgorithm() public {
        address a = makeAddr("other-algo");
        keys.setKey(a, true, 2, pubkeyOf(a), true);
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.NeedsPqcKey.selector, a));
        circle.join();
    }

    function test_join_twiceReverts() public {
        vm.startPrank(people[0]);
        circle.join();
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.AlreadyMember.selector, people[0]));
        circle.join();
        vm.stopPrank();
    }

    function test_join_afterStartReverts() public {
        fill();
        address late = makeAddr("late");
        giveKey(late);
        vm.prank(late);
        vm.expectRevert(
            abi.encodeWithSelector(RoscaCircle.WrongPhase.selector, RoscaCircle.Phase.Forming, RoscaCircle.Phase.Running)
        );
        circle.join();
    }

    function test_join_recordsOrder() public {
        fill();
        address[] memory m = circle.members();
        for (uint256 i; i < m.length; ++i) {
            assertEq(m[i], people[i]);
        }
    }
}
