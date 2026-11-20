// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The part of ERC-20 a circle needs (fUSD on the QoreChain testnet).
interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
