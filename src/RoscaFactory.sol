// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoscaCircle} from "./RoscaCircle.sol";

/// @title RoscaFactory
/// @notice Opens savings circles and lists them. It has no owner and holds no money:
/// each circle is its own contract with its own pot.
contract RoscaFactory {
    RoscaCircle[] internal _circles;
    mapping(address => RoscaCircle[]) internal _byOrganiser;

    event CircleCreated(address indexed circle, address indexed organiser, string name);

    /// @notice Open a new circle with the caller as organiser.
    function createCircle(RoscaCircle.Params calldata p) external returns (RoscaCircle circle) {
        circle = new RoscaCircle(p, msg.sender);
        _circles.push(circle);
        _byOrganiser[msg.sender].push(circle);
        emit CircleCreated(address(circle), msg.sender, p.name);
    }

    function circleCount() external view returns (uint256) {
        return _circles.length;
    }

    /// @notice All circles, oldest first.
    function circles() external view returns (RoscaCircle[] memory) {
        return _circles;
    }

    /// @notice Circles opened by `organiser`.
    function circlesOf(address organiser) external view returns (RoscaCircle[] memory) {
        return _byOrganiser[organiser];
    }
}
