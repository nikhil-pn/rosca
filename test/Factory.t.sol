// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaBase} from "./RoscaBase.t.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";

contract FactoryTest is RoscaBase {
    function test_factory_listsCircles() public {
        assertEq(factory.circleCount(), 1);
        RoscaCircle second = openCircle(defaultParams());
        assertEq(factory.circleCount(), 2);
        assertEq(address(factory.circles()[1]), address(second));
        assertEq(address(factory.circlesOf(organiser)[0]), address(circle));
    }

    function test_factory_callerIsOrganiser() public view {
        assertEq(circle.organiser(), organiser);
        assertEq(circle.name(), "Kochi office kuri");
    }

    function test_params_rejectFeeAboveFivePercent() public {
        RoscaCircle.Params memory p = defaultParams();
        p.feeBps = 501;
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.BadParams.selector, "feeBps"));
        factory.createCircle(p);
    }

    function test_params_rejectDiscountCapAboveFortyPercent() public {
        RoscaCircle.Params memory p = defaultParams();
        p.maxDiscountBps = 4001;
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.BadParams.selector, "maxDiscountBps"));
        factory.createCircle(p);
    }

    function test_params_rejectQuorumOfHalfOrLess() public {
        RoscaCircle.Params memory p = defaultParams();
        p.quorumBps = 5000;
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.BadParams.selector, "quorumBps"));
        factory.createCircle(p);
    }

    function test_params_rejectTooManyMembers() public {
        RoscaCircle.Params memory p = defaultParams();
        p.size = 51;
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.BadParams.selector, "size"));
        factory.createCircle(p);
    }

    function test_params_rejectZeroShare() public {
        RoscaCircle.Params memory p = defaultParams();
        p.share = 0;
        vm.expectRevert(abi.encodeWithSelector(RoscaCircle.BadParams.selector, "share"));
        factory.createCircle(p);
    }
}
