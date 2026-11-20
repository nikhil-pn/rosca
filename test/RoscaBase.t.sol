// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RoscaCircle} from "../src/RoscaCircle.sol";
import {RoscaFactory} from "../src/RoscaFactory.sol";
import {MockPqcPrecompile} from "./mocks/MockPqcPrecompile.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Shared set-up: mock precompiles at their real addresses, a mock fUSD, five members
/// with ML-DSA-87 keys, and helpers that drive a circle through its rounds.
abstract contract RoscaBase is Test {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;

    uint256 internal constant SHARE = 100e18;
    uint8 internal constant SIZE = 5;
    uint32 internal constant ROUND = 1 days;
    uint32 internal constant GRACE = 2 days;

    RoscaFactory internal factory;
    MockERC20 internal fusd;
    MockPqcPrecompile internal keys;
    RoscaCircle internal circle;

    address internal organiser = makeAddr("organiser");
    address[] internal people;

    function setUp() public virtual {
        MockPqcPrecompile impl = new MockPqcPrecompile();
        vm.etch(PQC_VERIFY, address(impl).code);
        vm.etch(PQC_KEY_STATUS, address(impl).code);
        keys = MockPqcPrecompile(PQC_KEY_STATUS);

        fusd = new MockERC20();
        factory = new RoscaFactory();

        string[5] memory names = ["anu", "biju", "chitra", "deepa", "eldho"];
        for (uint256 i; i < names.length; ++i) {
            address a = makeAddr(names[i]);
            people.push(a);
            giveKey(a);
            fusd.mint(a, 10_000e18);
        }
        circle = openCircle(defaultParams());
        for (uint256 i; i < people.length; ++i) {
            vm.prank(people[i]);
            fusd.approve(address(circle), type(uint256).max);
        }
    }

    // ------------------------------------------------------------ helpers

    function defaultParams() internal view returns (RoscaCircle.Params memory) {
        return RoscaCircle.Params({
            token: address(fusd),
            share: SHARE,
            size: SIZE,
            roundLength: ROUND,
            graceLength: GRACE,
            maxDiscountBps: 3000,
            feeBps: 200,
            quorumBps: 5001,
            securityBps: 5000,
            name: "Kochi office kuri"
        });
    }

    function openCircle(RoscaCircle.Params memory p) internal returns (RoscaCircle c) {
        vm.prank(organiser);
        c = factory.createCircle(p);
    }

    function pubkeyOf(address a) internal pure returns (bytes memory pk) {
        pk = new bytes(2592);
        bytes32 seed = keccak256(abi.encode("mldsa87", a));
        assembly {
            mstore(add(pk, 32), seed)
        }
    }

    function giveKey(address a) internal {
        keys.setKey(a, true, 1, pubkeyOf(a), true);
    }

    function signPayout(address signer, uint256 r, address recipient, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes memory message = circle.payoutMessage(r, recipient, deadline);
        return MockPqcPrecompile(PQC_VERIFY).mockSign(pubkeyOf(signer), message);
    }

    function fill() internal {
        for (uint256 i; i < people.length; ++i) {
            vm.prank(people[i]);
            circle.join();
        }
    }

    function payAll() internal {
        for (uint256 i; i < people.length; ++i) {
            vm.prank(people[i]);
            circle.pay();
        }
    }

    function endBidding() internal {
        vm.warp(circle.getRound(circle.currentRound()).bidEnd + 1);
    }

    function approveBy(uint256 count) internal {
        for (uint256 i; i < count; ++i) {
            vm.prank(people[i]);
            circle.approveRelease();
        }
    }

    function releaseTo(address recipient) internal {
        uint256 r = circle.currentRound();
        address winner = circle.getRound(r).winner;
        uint256 deadline = block.timestamp + 1 hours;
        circle.release(recipient, deadline, signPayout(winner, r, recipient, deadline));
    }

    /// @notice One full round: everyone pays, `bidder` bids `discount` (none if address(0)),
    /// the auction closes, a majority approves, the winner releases to themselves.
    function runRound(address bidder, uint256 discount) internal {
        payAll();
        if (bidder != address(0)) {
            vm.prank(bidder);
            circle.bid(discount);
        }
        endBidding();
        circle.closeAuction();
        approveBy(circle.quorumNeeded());
        releaseTo(circle.getRound(circle.currentRound()).winner);
    }
}
