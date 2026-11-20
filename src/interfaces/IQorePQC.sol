// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice QoreChain post-quantum precompiles, active on the qorechain-diana testnet.
/// @dev pqcVerify lives at 0x…0A01 and pqcKeyStatus at 0x…0A02.
/// An inactive precompile address returns success with empty data, so callers must
/// use typed calls (which revert on empty data) or check the return length.
interface IQorePQC {
    /// @notice Verify an ML-DSA-87 (Dilithium-5) signature.
    /// @param pubkey 2592-byte ML-DSA-87 public key.
    /// @param signature 4627-byte ML-DSA-87 signature.
    /// @param message The signed message bytes.
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// @notice Read the post-quantum key registered for an account.
    /// @return registered True if a key is registered.
    /// @return algorithmId 1 = ML-DSA-87.
    /// @return pubkey The registered public key (empty if none).
    /// @return possessionProven True only if the key was registered with a proof of possession.
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}
