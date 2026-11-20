# QCAI audit

The Post-Quantum dApp category asks for a two-stage audit with QoreChain's AI auditor (QCAIA): a report on the code
as written, then a second report after the findings are fixed.

| Stage | Date | Code | Score | Risk | Report |
| --- | --- | --- | --- | --- | --- |
| 1, before fixes | 21 Nov 2026 | `src/` flattened (`forge flatten src/RoscaFactory.sol`) | 72 / 100 | High | [`stage-1-qcai-report.pdf`](stage-1-qcai-report.pdf) |
| 2, after fixes | next free daily audit | factory v2, `0x29053772…afef` | — | — | — |

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

All 65 tests pass. The fixed contracts are deployed as **factory v2**
[`0x29053772f08c30c682e0fbb5db3a3d86ac84afef`](https://explore.qore.network/address/0x29053772f08c30c682e0fbb5db3a3d86ac84afef)
(tx [`0x38abe4b4…`](https://explore.qore.network/tx/0x38abe4b41a22d1254b4b60df24c458cea7affe81002ccda60884ae44978e1f4e)).
The first factory stays live so circles opened on it can finish. The site and the app open new circles on v2.

Stage 2 runs the fixed code through the auditor again. The dashboard gives one free audit a day, so it runs on the next one.
