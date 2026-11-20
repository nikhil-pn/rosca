// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Stand-in for QoreChain's PQC precompiles in Foundry's local EVM.
/// Tests place this code at 0x…0A01 (pqcVerify) and 0x…0A02 (pqcKeyStatus) with vm.etch.
/// A "signature" here is keccak256(pubkey, message) padded to 4627 bytes, so only the holder of
/// the matching key material (the test) can produce it. The live-network script checks real
/// ML-DSA-87 signatures against the real precompiles.
contract MockPqcPrecompile {
    struct KeyStatus {
        bool registered;
        uint8 algorithmId;
        bytes pubkey;
        bool possessionProven;
    }

    mapping(address => KeyStatus) internal _keys;

    function setKey(address account, bool registered, uint8 algorithmId, bytes calldata pubkey, bool proven)
        external
    {
        _keys[account] = KeyStatus(registered, algorithmId, pubkey, proven);
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory, bool) {
        KeyStatus storage k = _keys[account];
        return (k.registered, k.algorithmId, k.pubkey, k.possessionProven);
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        return keccak256(signature) == keccak256(mockSign(pubkey, message));
    }

    function mockSign(bytes memory pubkey, bytes memory message) public pure returns (bytes memory sig) {
        sig = new bytes(4627);
        bytes32 h = keccak256(abi.encode(pubkey, message));
        assembly {
            mstore(add(sig, 32), h)
        }
    }
}
