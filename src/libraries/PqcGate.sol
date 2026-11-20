// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IQorePQC} from "../interfaces/IQorePQC.sol";

/// @title PqcGate
/// @notice Reads an account's registered ML-DSA-87 key and checks signatures against it,
/// using QoreChain's post-quantum precompiles.
library PqcGate {
    /// @dev pqcVerify precompile.
    IQorePQC internal constant VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    /// @dev pqcKeyStatus precompile.
    IQorePQC internal constant KEY_STATUS = IQorePQC(0x0000000000000000000000000000000000000a02);

    /// @dev Algorithm id of ML-DSA-87 in the key registry.
    uint8 internal constant ML_DSA_87 = 1;
    /// @dev Sizes of ML-DSA-87 keys and signatures (FIPS 204).
    uint256 internal constant PUBKEY_LENGTH = 2592;
    uint256 internal constant SIGNATURE_LENGTH = 4627;

    error NoPqcKey(address account);
    error NotMlDsa87(address account, uint8 algorithmId);
    error PossessionNotProven(address account);
    error BadSignatureLength(uint256 length);
    error BadPqcSignature(address account);

    /// @notice The account's registered ML-DSA-87 public key. Reverts unless the key is
    /// registered, is ML-DSA-87 and was registered with a proof of possession.
    function registeredKey(address account) internal view returns (bytes memory pubkey) {
        (bool registered, uint8 algorithmId, bytes memory key, bool possessionProven) =
            KEY_STATUS.pqcKeyStatus(account);
        if (!registered || key.length != PUBKEY_LENGTH) revert NoPqcKey(account);
        if (algorithmId != ML_DSA_87) revert NotMlDsa87(account, algorithmId);
        if (!possessionProven) revert PossessionNotProven(account);
        return key;
    }

    /// @notice True if the account has a usable ML-DSA-87 key (registered, proven).
    function hasUsableKey(address account) internal view returns (bool) {
        (bool registered, uint8 algorithmId, bytes memory key, bool possessionProven) =
            KEY_STATUS.pqcKeyStatus(account);
        return registered && possessionProven && algorithmId == ML_DSA_87 && key.length == PUBKEY_LENGTH;
    }

    /// @notice Reverts unless `signature` is the account's ML-DSA-87 signature over `message`.
    function requireSignedBy(address account, bytes memory message, bytes calldata signature) internal view {
        if (signature.length != SIGNATURE_LENGTH) revert BadSignatureLength(signature.length);
        bytes memory pubkey = registeredKey(account);
        if (!VERIFY.pqcVerify(pubkey, signature, message)) revert BadPqcSignature(account);
    }
}
