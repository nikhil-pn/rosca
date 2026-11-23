# Proof on the QoreChain testnet

Everything below happened on `qorechain-diana` (EVM chain id 9800) on 20 November 2026.
Open any link to see the transaction on the explorer.

## Contracts

| What | Address |
| --- | --- |
| RoscaFactory v4 (signed bids, paid-every-round rule) | [`0x36f0e01992b585df9f3752bca56a07dfcdf02817`](https://explore.qore.network/address/0x36f0e01992b585df9f3752bca56a07dfcdf02817) (deployed in [`0xf2bf71c2…`](https://rosca.exprmnts.fun/tx/0xf2bf71c2079e3777c59d6bb4982b6971f850dd78561b528c2080329d8d6e7ab3)); new circles open here |
| RoscaFactory v3 (audit fixes + fair dissolve) | [`0x8197d7a6345b0b087976e5412629514719ccbd2f`](https://explore.qore.network/address/0x8197d7a6345b0b087976e5412629514719ccbd2f) (deployed in [`0x8001ccb6…`](https://rosca.exprmnts.fun/tx/0x8001ccb6b4378b9011748b8bbe34ceaf4a08a4061c518b1a50767d01c5ac1c69)) |
| RoscaFactory v2 (audit fixes) | [`0x29053772f08c30c682e0fbb5db3a3d86ac84afef`](https://explore.qore.network/address/0x29053772f08c30c682e0fbb5db3a3d86ac84afef) (deployed in [`0x38abe4b4…`](https://rosca.exprmnts.fun/tx/0x38abe4b41a22d1254b4b60df24c458cea7affe81002ccda60884ae44978e1f4e)) |
| RoscaFactory v1 | [`0x366d6a029d94a98ba4d93e2eb4dbf07720387d39`](https://explore.qore.network/address/0x366d6a029d94a98ba4d93e2eb4dbf07720387d39) (deployed in [`0xe4d46037…`](https://rosca.exprmnts.fun/tx/0xe4d460379e0c7f80a154e3e05dd248fd3250fedbe6e6501b202ef1bd856316f1)) |
| Test circle (5 members, 10 fUSD, 2-minute rounds) | [`0xF8cA79Bf91513e476D12d5B5B3eE92ac3806D561`](https://explore.qore.network/address/0xF8cA79Bf91513e476D12d5B5B3eE92ac3806D561) |
| fUSD (the fest's test dollar) | [`0x97143B771D34ddb9130b807b135Ae675A5a963CA`](https://explore.qore.network/address/0x97143B771D34ddb9130b807b135Ae675A5a963CA) |

## One full round, end to end

Each member first registered its ML-DSA-87 key with a proof of possession, then opened an EVM window
**scoped to the circle and the fUSD token only**, signed with that post-quantum key. Every call below went
through such a window.

| Step | Transaction |
| --- | --- |
| Organiser opens the circle | [`0xae0ae49a…`](https://rosca.exprmnts.fun/tx/0xae0ae49ac171609f8d29f64e16e3f09f72757e7f6303f09075754ff6d6c20635) |
| join member-1 | [`0x940491b2…`](https://rosca.exprmnts.fun/tx/0x940491b20f9fc8b0f1c9491105ed514bac2ff4a088affaab05a738d7cd6061f8) |
| join member-2 | [`0x127dac7a…`](https://rosca.exprmnts.fun/tx/0x127dac7a7576f1f7e0cbfc79749049995507799c100f41338c0079e0654c2320) |
| join member-3 | [`0xa7e04cea…`](https://rosca.exprmnts.fun/tx/0xa7e04cead6028bd3a2a677f3b4a3dbe1fcad532f72241cf7e40ba1cfd6a7aefb) |
| join member-4 | [`0x9c080d63…`](https://rosca.exprmnts.fun/tx/0x9c080d636c1de47c357b22e5cecf5f1c8765b6b3daf4ee09af41bec87b38b8c6) |
| join member-5 | [`0xa39130b9…`](https://rosca.exprmnts.fun/tx/0xa39130b9e2d1a7dcfe242a33f0a460dec09c6490d3682c6d3e0f1a778f1bf11c) |
| pay member-1 | [`0xaa8f3467…`](https://rosca.exprmnts.fun/tx/0xaa8f346728ce6ab7607d0b14eb990c9e1a137af7ee564fa15d7b1ed2f2a45188) |
| pay member-2 | [`0x510ae663…`](https://rosca.exprmnts.fun/tx/0x510ae66349539b26cf62d04f6dc68f6158d1b8125f265802f5404d9ae815a369) |
| pay member-3 | [`0x0e29ec5d…`](https://rosca.exprmnts.fun/tx/0x0e29ec5d25746094c24a59f0ca5a6cf074233ffaf26bc1ed46d168be80f9e1ad) |
| pay member-4 | [`0x122eb3d2…`](https://rosca.exprmnts.fun/tx/0x122eb3d21bb6034658034bf29abd0a191aacde6df947b90ef20b75622bd03941) |
| pay member-5 | [`0x26e9a59a…`](https://rosca.exprmnts.fun/tx/0x26e9a59a2400b7e16fc45295c0aebc752048183b441602ae6c78b410791eca9a) |
| bid member-2 (5 fUSD) | [`0x4b375695…`](https://rosca.exprmnts.fun/tx/0x4b375695117da13004a6e482c5df29dc2792e5af71f0ec0d3ade097993277b3d) |
| close | [`0x756438e1…`](https://rosca.exprmnts.fun/tx/0x756438e1ca9aa5ffe9b088ed9e21bc015187a5438a573f646c69ba9c8cda5ff4) |
| approve member-1 | [`0x98121a9a…`](https://rosca.exprmnts.fun/tx/0x98121a9a6de3e04ef38bd466dcdfc1c772d7278e4eed74d559f24e2841be830c) |
| approve member-3 | [`0x791bdfe9…`](https://rosca.exprmnts.fun/tx/0x791bdfe9604a899c9572032a042e003c80d32d30ba422648795485e0b7d87310) |
| approve member-4 | [`0xba3f38ee…`](https://rosca.exprmnts.fun/tx/0xba3f38eee584249e4f2ac9e51c9ca5ed2e7b64043d147c309f7210cde5a5918c) |
| release (ML-DSA-87) | [`0x68d8f0fb…`](https://rosca.exprmnts.fun/tx/0x68d8f0fbc11f8d18fe5001558b7eebe158c8e9d46db8f6b063087e83b0cadbea) |

The release is the key step: the circle read member-2's registered ML-DSA-87 key from the `pqcKeyStatus`
precompile (`0x…0A02`) and checked their 4,627-byte signature over the payout with `pqcVerify` (`0x…0A01`).
Without that signature no key, not the organiser's and not a stolen classical key, can move the pot.


## The keeper: a circle that never stops

`scripts/keeper.ts` runs as a service and plays five demo members (Anu, Biju, Chitra, Deepak and Esther) in one circle after another,
one round an hour. The site at https://rosca.exprmnts.fun reads every step live from the chain. Each new circle is recorded in
`deployments/testnet.json`.

| Circle | Address | Notes |
| --- | --- | --- |
| Office kuri #1 | [`0xBB182372…49f39`](https://explore.qore.network/address/0xBB182372692020cee736206f3E2f1830AB649f39) | test run with 90-second rounds: 5 rounds, 5 ML-DSA-87 releases, then every member withdrew their security and dividends |
| Family chit #2 | [`0x0A0A0D7A…e6e16`](https://explore.qore.network/address/0x0A0A0D7A765942Ef060fCcAdb51464785b3e6e16) | first circle with one-hour rounds |

## The thief test

Once per circle the keeper plays a thief who has stolen the round winner's classical (secp256k1) key. The thief uses the
winner's own scoped window to call `release` with their own address as recipient. The transaction is sent with a fixed gas limit
and no estimate, so it lands on chain and fails there.

| Circle | Round | What the thief sent | Result |
| --- | --- | --- | --- |
| Office kuri #1 | 2 | a valid ML-DSA-87 signature, but from the thief's own key | [reverted](https://rosca.exprmnts.fun/tx/0x703be9e1d1178d89b97bab28c1ae29ce33377ddcfe8b7a5e72b589eae2d0f660) |

The next circle tries the other attack: the winner's real signature, replayed for the thief's address. The signed payout covers
the recipient, so that fails as well.
