// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockERC20} from "./MockERC20.sol";

/// @notice An ERC-20 that, while sending tokens, calls back into the circle once to try to take
/// money twice. It records whether that nested call succeeded and then finishes the transfer.
contract ReentrantToken is MockERC20 {
    address public target;
    bytes public payload;
    bool public armed;
    bool public tried;
    bool public reentrySucceeded;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function _attack() internal {
        if (!armed) return;
        armed = false;
        tried = true;
        (bool ok,) = target.call(payload);
        reentrySucceeded = ok;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _attack();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
