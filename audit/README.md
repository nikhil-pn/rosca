# QCAI audit

The Post-Quantum dApp category asks for a two-stage audit with QoreChain's AI auditor (QCAIA): a report on the code
as written, then a second report after the findings are fixed.

| Stage | Date | Code | Auditor setting | Score | Risk | Quantum readiness | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1, before fixes | 21 Nov 2026 | first factory, `src/` flattened | auto-detect (read as Ethereum) | 72 / 100 | High | not scored | [`stage-1-qcai-report.pdf`](stage-1-qcai-report.pdf) |
| 2, after fixes | 22 Nov 2026 | factory v3, same command | auto-detect (read as Ethereum) | 72 / 100 | High | not scored | [`stage-2-qcai-report.pdf`](stage-2-qcai-report.pdf) |
| **2, after fixes** | 22 Nov 2026 | factory v3, same code | **QoreChain (PQC)** | **78 / 100** | **Medium** | **Quantum-safe** | [`stage-2-qcai-report-qorechain.pdf`](stage-2-qcai-report-qorechain.pdf) |

Every run pastes `forge flatten src/RoscaFactory.sol` into dashboard.qorechain.io → AI Audit on the testnet. The first
two runs used the default "auto-detect" setting, which read the Solidity as Ethereum code and skipped the
post-quantum checks. The third run, on the same code, chose QoreChain: the auditor then checks the ML-DSA-87 path
and rates the contract quantum-safe. We list all three so the numbers can be compared fairly.

## Stage 1 findings and what we do about each

| # | Finding (QCAI severity) | Our assessment | Action |
| --- | --- | --- | --- |
| 1 | Potential reentrancy in `release` and `withdraw` (High) | Both are `nonReentrant` and finish every state change before the token transfer, so a reentrant call reverts. | Add a test with a malicious token that tries to re-enter, and comment the order. |
| 2 | Missing access control on `closeAuction`, `approveRelease`, `dissolve` (High) | `approveRelease` and `dissolve` are already members-only, and `dissolve` also needs a stalled round. `closeAuction` is open to anyone on purpose, so a round can't be blocked; it only works after bidding ends and picks the winner by fixed rules. | Restrict `closeAuction` to members as well: same liveness, smaller surface. |
| 3 | Potential overflow in the security calculation (Medium) | Solidity 0.8 reverts on overflow, and `testFuzz_quoteAlwaysAddsUpToThePot` covers the maths. | No code change; note it in the report. |
| 4 | Unchecked return values from token calls (Medium) | `_pull` and `_push` check both the call result and the returned bool. One real gap: a call to an address with no code also "succeeds". | Require the token to be a contract when a circle is created. |
| 5 | Front-running in bidding (Low) | Bids are public; a front-runner can only win by offering a bigger discount, which costs them. Listed in the threat model. | Keep; sealed bids are future work. |
| 6 | Unbounded loop in `closeAuction` (Low) | The loop runs over members, capped at 50 by the contract (12 in the app). | Keep the cap; note the gas bound. |

## Fixes made (21 Nov 2026)

- **Finding 2:** `closeAuction` is members-only. Test: `test_close_strangerCannotClose`.
- **Finding 4:** a circle's token must be a contract (`BadParams("token")`). Test: `test_params_rejectTokenWithoutCode`.
- **Finding 1:** a token that re-enters the circle while it pays out cannot take money twice. Tests:
  `test_release_reentryDuringPayoutFails`, `test_withdraw_reentryDuringWithdrawFails` (mock `test/mocks/ReentrantToken.sol`).
- **Findings 3, 5, 6:** documented in the code (`quotePayout`, `closeAuction`) and in `docs/THREAT_MODEL.md`.

## Found in our own second review (21 Nov 2026)

- **Dissolve gave held security back to winners.** Security is held from a winner's payout to cover the shares they
  still owe. When a stalled circle was dissolved, that security went back to the winner, so members who had paid in
  and never taken a pot lost money while the winners kept the whole pot. Now the security joins the refund pool and
  is shared by what each member put in minus what each took out. Tests: `test_dissolve_heldSecurityGoesToMembersNotYetPaid`,
  `test_dissolve_winnersDoNotGetSecurityBack` (both fail on the old code).

All 67 tests pass. The fixed contracts are deployed as **factory v3**
[`0x8197d7a6345b0b087976e5412629514719ccbd2f`](https://explore.qore.network/address/0x8197d7a6345b0b087976e5412629514719ccbd2f)
(tx [`0x8001ccb6…`](https://explore.qore.network/tx/0x8001ccb6b4378b9011748b8bbe34ceaf4a08a4061c518b1a50767d01c5ac1c69)).

The audit fixes were first deployed as **factory v2**
[`0x29053772f08c30c682e0fbb5db3a3d86ac84afef`](https://explore.qore.network/address/0x29053772f08c30c682e0fbb5db3a3d86ac84afef)
(tx [`0x38abe4b4…`](https://explore.qore.network/tx/0x38abe4b41a22d1254b4b60df24c458cea7affe81002ccda60884ae44978e1f4e)).
Earlier factories stay live so circles opened on them can finish. The site and the app open new circles on v3.

## Stage 2 findings (QoreChain setting) and what we found

| # | Finding (QCAI severity) | Our assessment |
| --- | --- | --- |
| 1 | ML-DSA-87 key registration bypass: check the algorithm id and key length (High) | Already enforced. `PqcGate.registeredKey` reverts unless the key is registered, `algorithmId == 1` (ML-DSA-87), the key is 2592 bytes and possession was proven. Tests: `test_join_refusesOtherAlgorithm`, `test_join_refusesKeyWithoutProofOfPossession`, `test_release_needsWinnersKeyStillRegistered`. |
| 2 | Reentrancy in token transfers (Medium) | Same as stage 1, finding 1: `pay`, `release` and `withdraw` are `nonReentrant` and change state before the transfer. Tests with a re-entering token: `test_release_reentryDuringPayoutFails`, `test_withdraw_reentryDuringWithdrawFails`. |
| 3 | Security deposits could be applied twice at auction close (Medium) | Cannot happen: a share is taken from security only for a past winner whose `paid` flag is false, and the flag is set in the same step. `invariant_moneyIsConserved` and `invariant_potCoversWhatItOwes` hold over 128,000 random actions. Test: `test_securityCoversAPastWinnerWhoStopsPaying`. |
| 4 | Signature length not validated (Low) | Already enforced: `requireSignedBy` reverts with `BadSignatureLength` unless the signature is 4627 bytes, before the precompile is called. |
| 5 | Precompile addresses are fixed (Info) | By design: `0x…0A01` and `0x…0A02` are part of QoreChain, like the EVM's own precompiles. |

No stage 2 finding needed a code change; every point is covered by code and tests that were already in place. The
stage 1 fixes, and the dissolve fix from our own second review, are what stage 2 audited.
