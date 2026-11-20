# Rosca: build plan

Deadline: 2 December 2026, 23:59 UTC. Testnet `qorechain-diana` (EVM chain id 9800).

## One line

A chit fund (rosca) whose pot no single key can move: the payout needs the winner's ML-DSA-87 signature,
checked on chain, and a majority of members.

## How a circle works

1. An organiser creates a circle: token (fUSD), monthly share, number of members, round length.
2. Members join. A member's account must have a registered ML-DSA-87 key with proof of possession
   (`pqcKeyStatus`, precompile `0x…0A02`).
3. Every round each member pays the share. Members who already won have their future shares held back
   from their payout, so a winner cannot stop paying.
4. Members bid the discount they accept. The highest discount wins, as in a real chit fund.
5. After the auction closes, members approve the release. A majority is needed.
6. The winner signs the payout (circle, round, recipient, amount, deadline) with their ML-DSA-87 key.
   The contract reads their registered key and checks the signature with `pqcVerify` (precompile `0x…0A01`).
7. The discount, minus an optional organiser fee capped at 5%, is shared out to all members.
8. If a round stalls, members can dissolve the circle and take back what they put in.

The organiser has no function that moves money. There is no owner, no upgrade and no admin withdrawal.

## Requirements of the Post-Quantum dApp category

| Requirement | Where |
| --- | --- |
| Scoped EVM window | members open a window limited to the circle and the fUSD token (`scripts/`) |
| `pqcVerify` | `RoscaCircle.release` checks the winner's ML-DSA-87 signature |
| Two-stage QCAI audit | `audit/` (report before fixes, report after fixes) |
| Foundry tests | `test/` (unit, fuzz and invariant tests) |

## Parts

| Part | Folder |
| --- | --- |
| Contracts | `src/` |
| Tests | `test/` |
| Deploy and member scripts | `script/`, `scripts/` |
| Web app | `web/` |
| Docs, proof, threat model | `docs/` |
