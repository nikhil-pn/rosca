# Real ML-DSA-87 signatures against the live precompile

The Foundry tests replace QoreChain's `pqcVerify` precompile with a mock, because Foundry cannot run QoreChain's
precompiles. This page is the other half: real ML-DSA-87 keys and signatures, made with `@qorechain/sdk`, sent to the
**live** precompile `0x…0A01` on `qorechain-diana` through `eth_call`. Every result is compared with the SDK's own
verifier. Reproduce it with `npx tsx scripts/pqc-vectors.ts`; the vectors are in
[`test/vectors/mldsa87.json`](../test/vectors/mldsa87.json).

Run at testnet block 10,583,407 on 2026-11-23. Key: 2,592 bytes, signature: 4,627 bytes (FIPS 204, ML-DSA-87).

| Case | Expected | Live precompile | SDK verify | Match |
| --- | --- | --- | --- | --- |
| Valid signature, right key, right message | true | **true** | true | ✓ |
| Message changed by one bit (e.g. a different recipient) | false | **false** | false | ✓ |
| Signature changed by one bit | false | **false** | false | ✓ |
| Someone else's key signed it (a thief's own ML-DSA-87 key) | false | **false** | false | ✓ |
| Signature cut short (4,626 of 4,627 bytes) | false | **false** | false | ✓ |

Every case matches: the precompile accepts exactly the valid signature and refuses every altered one.

## The registered key RoscaCircle reads

`pqcKeyStatus(0x351BdBAF6eF77bA62E9B40B3CdFC48E37d27B4E0)` (demo member Anu) on the live precompile `0x…0A02`:

| Field | Value |
| --- | --- |
| registered | true |
| algorithmId | 1 (1 = ML-DSA-87) |
| public key | 2592 bytes, identical to the member's own ML-DSA-87 key |
| possessionProven | true |

`PqcGate.registeredKey` requires all four (registered, algorithm 1, 2,592 bytes, possession proven) before it checks a
bid or a payout signature against this key.
