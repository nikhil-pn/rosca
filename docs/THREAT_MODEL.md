# Rosca threat model

What Rosca protects, who might attack it, what stops each attack, and what risk is left.
Every "stopped by" points to the code or to a test in `test/` you can run with `forge test`.

## 1. What we protect

| Asset | Why it matters |
| --- | --- |
| **The pot** of each round | The members' savings. In a classic chit fund this is what an organiser runs away with. |
| **Security** held back from past winners | It pays the shares of a winner who stops paying. |
| **Discount dividends** | Owed to every member after each auction. |
| **Each member's keys** | The secp256k1 key signs everyday transactions; the ML-DSA-87 key signs payouts and opens windows. |
| **Fair order** | The auction must pick the right winner, and every member must win exactly once. |

## 2. Who might attack

| Actor | What they can do |
| --- | --- |
| **The organiser** | Opens the circle and chooses its terms. Today, this is the person most trusted with the pot. |
| **A member** | Pays, bids, approves, closes, dissolves. May stop paying, collude, or grief. |
| **A thief with a member's classical key** | Phone malware, a leaked seed backup, or a quantum computer that derives the ECDSA key from the public key. |
| **Outsiders** | Anyone on the chain: front-run, spam, send junk calls. |
| **Infrastructure** | The website host, the RPC and REST endpoints, the faucet. |

## 3. Threats and what stops them

| # | Threat | Stopped by | Tests |
| --- | --- | --- | --- |
| T1 | The organiser takes the pot | The circle has no owner, admin, upgrade or withdraw path for the organiser; money only moves to members by the rules | `test_release_organiserCannotTakePot` |
| T2 | A stolen classical key sends the pot to the thief | `release` needs the winner's **ML-DSA-87** signature, checked on chain by `pqcVerify` against the key in `pqcKeyStatus` | `test_release_leakedClassicalKeyCannotRedirectPot`, `testFuzz_onlyTheWinnersKeyReleases`; real reverted transactions in `docs/PROOF.md` |
| T3 | The winner's real signature is replayed to another address, round or circle | The signed message binds the chain id, the circle, the round, the recipient, the amount and a deadline | `test_release_signatureBoundToRecipient`, `test_release_expiredSignatureReverts`; a reverted replay from the app |
| T4 | Release without the members' agreement | A majority (more than half) must approve first | `test_release_withoutQuorumReverts`, `test_params_rejectQuorumOfHalfOrLess` |
| T5 | Someone joins without a post-quantum key, or with a key they don't hold | `join` requires a registered ML-DSA-87 key **with proof of possession** | `test_join_refusesAccountWithoutPqcKey`, `test_join_refusesKeyWithoutProofOfPossession`, `test_join_refusesOtherAlgorithm` |
| T6 | A key is rotated or removed after winning, so the payout can't be checked | The winner's key must still be registered at release | `test_release_needsWinnersKeyStillRegistered` |
| T7 | A winner takes the pot early, then stops paying | Up to half the payout (never more than their remaining shares) is held as security and pays their later shares. Beyond that security the loss falls on the other members, as in any chit fund; it is listed under residual risks | `test_securityCoversAPastWinnerWhoStopsPaying`, `test_release_holdsSecurityForWinnersFutureShares` |
| T8 | Someone wins twice, or a winner bids again | `hasWon` is set at close; past winners can't bid or be picked | `test_bid_pastWinnerCannotBidAgain`, `invariant_winnersNeverExceedRounds` |
| T9 | A bidder takes an unfair discount | The discount is capped by the circle (at most 40%, the legal Indian limit); the organiser fee at most 5% and only from discounts | `test_bid_capIsFortyPercentAtMost`, `testFuzz_bidAboveCapAlwaysReverts`, `test_params_rejectFeeAboveFivePercent` |
| T10 | A round stalls forever (members vanish, nobody can win) | After a grace period any member can dissolve; what's left is refunded in proportion to what each put in minus what each took out | `test_dissolve_onlyAfterStall`, `test_dissolve_refundsWhatEachPutIn`, `test_dissolve_afterSomeRoundsIsFair` |
| T17 | Winners keep their held security when a circle dissolves, so members who never won lose out | The security covers shares the winners still owe; on dissolve it joins the refund pool instead of going back to the winners | `test_dissolve_heldSecurityGoesToMembersNotYetPaid`, `test_dissolve_winnersDoNotGetSecurityBack` |
| T11 | Money is created or lost by some sequence of actions | Accounting checked across 128,000 random actions | `invariant_moneyIsConserved`, `invariant_potCoversWhatItOwes`, `test_fullCircle_moneyIsConserved` |
| T12 | Reentrancy through the token | `nonReentrant` on every function that moves money; checks before transfers | contract |
| T13 | Someone withdraws another member's money | `withdraw` only ever pays the caller | `test_withdraw_dividendGoesToCallerOnly` |
| T14 | A stolen classical key moves the member's fUSD (for example the payout, once it lands) | Each member's everyday EVM window is **scoped to their circle only**; the one fUSD call, approving the circle, goes through a separate one-transaction window. Any other EVM call is refused by the chain ("the window does not list … as an allowed recipient"), and only the post-quantum key can open a window | Keeper attack `fusd-transfer` after every payout on factory v4, refused by the chain (`deployments/testnet.json`); `scripts/lib/circle.ts`, `web-src/lib/actions.ts` |
| T18 | A stolen classical key sends native transactions (QOR, bank coins, a new window) | The chain requires the ML-DSA-87 signature on every native transaction from an account with a registered PQC key ("hybrid PQC signature required") | Keeper attack `classical-send` after every payout, refused by the chain |
| T19 | A stolen classical key bids the member into a costly discount | Bids carry the bidder's ML-DSA-87 signature over the circle, round, bidder, discount and a deadline | `test_bid_stolenClassicalKeyCannotBid`, `test_bid_signatureBoundToBidderAndDiscount`, `test_bid_expiredSignatureReverts` |
| T20 | A member skips shares, then pays one round and takes the pot | Only members who paid every round so far can bid or be picked; the discount goes only to the round's payers | `test_skipper_cannotBidInALaterRound`, `test_skipper_isNeverPickedByDefault`, `test_dividend_onlyToMembersWhoPaid` |
| T15 | An invite link points at a fake contract | The app joins only circles listed by the Rosca factory | `isRoscaCircle` in `web-src/lib/actions.ts` |
| T16 | The website host or the REST proxy is malicious | Keys and signing stay in the browser; the proxy only forwards transactions that are already signed, so it can drop them but not change them | `web-app/vercel.json`, `web-src/lib/qore.ts` |

## 4. Trust assumptions

- **QoreChain's PQC precompiles are correct.** `pqcVerify` (`0x…0A01`) and `pqcKeyStatus` (`0x…0A02`) are part of the
  chain; Rosca trusts them like it trusts the EVM.
- **ML-DSA-87 (NIST FIPS 204, level 5) is secure,** including against quantum computers.
- **A majority of members is honest about approvals.** Approval only lets the *already chosen* winner be paid; it can
  never send the pot to anyone else.
- **fUSD is a well-behaved ERC-20.** On mainnet this would be a real stablecoin, chosen per circle.

## 5. What risk is left

Honest limits, and what would reduce each one:

| Risk | Today | What would reduce it |
| --- | --- | --- |
| **Keys live in browser storage.** Malware on the device, or a malicious script on the page, could read them. | Testnet only, so nothing of value is at risk. | Hardware-backed keys (passkeys) or QoreX signing once it supports EVM calls from websites. |
| **Losing the device loses the wallet** unless the recovery phrase was written down. | The app offers the phrase and a restore flow in live mode. | Social recovery or a key registered on a second device. |
| **Members collude on bids.** A group can agree on discounts, as in any chit fund. | The discount cap bounds the damage. | Sealed bids (commit and reveal) or encrypted bids. |
| **Credit risk after a payout.** An early winner who stops paying is covered only up to the security held from their payout (half of it by default). | The rest is shared by the other members, as in any chit fund; the circle sets the security level. | A higher security level per circle, a joining deposit, or reputation from earlier circles. |
| **What a stolen classical key can still do.** Inside the member's circle-only window it can pay the member's own share, approve a payout to the already-chosen winner, close an auction or dissolve a stalled circle. | None of these moves money anywhere the rules don't already send it; it cannot bid, collect, withdraw elsewhere, transfer fUSD or send a native transaction. | Requiring the ML-DSA-87 signature on every action (costs gas on each call). |
| **Griefing:** a member joins and never pays, so a round can stall. | Security covers past winners; stalled circles can be dissolved with fair refunds. | A joining deposit, or reputation from earlier circles. |
| **Sybil members:** one person joins with many accounts. | The organiser shares the invite link only with people they know. | Optional identity checks for public circles. |
| **Front-running a bid.** A bid is public in the mempool before it lands. | A higher bid only wins if it is a bigger discount, which costs the bidder. | Sealed bids. |
| **The REST proxy or RPC censors transactions.** | The chain is public; users can send the same signed transactions through any endpoint. | A choice of endpoints in the app. |
| **No independent audit yet.** | 73 tests, fuzz and invariant runs, an AI security review, and the fest's two-stage QCAI audit (78/100 after fixes, rated quantum-safe). | A professional audit before any mainnet use with real money. |
| **Legal:** chit funds in India must be registered with the state, and the organiser has duties under the Chit Funds Act. | Testnet only. | Legal advice and registration before any real-money launch in India. |

## 6. Out of scope

Bugs in the QoreChain node, the SDK or the browser; denial of service against the chain; phishing sites that copy
Rosca; and anything on mainnet, where Rosca is not deployed.
