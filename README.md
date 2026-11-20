# Rosca

**The savings circle the organiser can't run away with.**

> Built for QoreChain [Build Before Q-Day](https://build.qorechain.io), category **Post-Quantum dApp**.
> Deadline: 2 December 2026, 23:59 UTC (3 December, 05:29 IST). Testnet only (`qorechain-diana`, EVM chain id 9800).
>
> **App:** https://app.rosca.exprmnts.fun · **Site:** https://rosca.exprmnts.fun ([how it works](https://rosca.exprmnts.fun/how) · [live](https://rosca.exprmnts.fun/live) · [security](https://rosca.exprmnts.fun/security) · [proof](https://rosca.exprmnts.fun/proof))

## What a rosca is

A **rosca** (rotating savings and credit association) is a group of people who each pay the same amount into a pot
every month. Each month one member takes the whole pot, until everyone has had a turn.

It is one of the oldest ways people save, and it goes by many names:

| Where | Name |
| --- | --- |
| India (legal term, Chit Funds Act 1982) | **chit fund** |
| Kerala | **kuri**, chitty |
| Tamil Nadu | seettu |
| Andhra Pradesh, Telangana | chitti |
| North India | **committee**, kameti |
| Maharashtra | bhishi |
| West Africa | ajo, esusu, susu |
| Mexico | tanda |
| China | hui |
| Indonesia | arisan |
| Korea | kye |
| Philippines | paluwagan |

## The problem

Someone has to hold the pot. In a chit fund or a kuri that is the organiser, and the classic fraud is simple:
the organiser takes the pot and disappears. Moving the circle on-chain does not fix this if one key can still move
the money, and a key that is safe today can be broken by a quantum computer tomorrow.

## What Rosca does

- Members pay their monthly share into a pot that **no single key can move**, not even the organiser's.
- Each month the members bid the discount they accept. The highest discount wins, as in a real chit fund auction, and the discount is shared out.
- Paying out needs the winner's **ML-DSA-87** (post-quantum) signature, checked on chain with `pqcVerify`, and a majority of members.
- A leaked classical (ECDSA) key alone can move nothing.


## The app

[app.rosca.exprmnts.fun](https://app.rosca.exprmnts.fun) is an installable web app (PWA) with two modes, switched in the top bar.

**Live** (the default) is the real product on the QoreChain testnet:

1. **Create my wallet.** Keys are made on the device: secp256k1 for everyday transactions and ML-DSA-87 for payouts.
   The user funds it from the [QoreChain faucet](https://dashboard.qorechain.io/faucet), registers the ML-DSA-87 key
   with proof of possession, and moves the faucet's fUSD into the wallet (`MsgConvertCoin`, signed by the user).
2. **Create a circle** and set its terms: name, amount per member, members (2 to 12), how often (daily, weekly,
   monthly by default; 5-minute and hourly rounds for testing), the biggest discount a bidder can take (up to 40%) and
   the organiser fee (up to 5%, taken only from discounts).
3. **Invite friends** with a link. Each friend makes a wallet, funds it and joins with their own post-quantum key.
4. **Play every round** from one "next step" card: pay, bid a discount, close the auction, approve, then the winner
   **signs and collects** with ML-DSA-87. Every action opens a confirm sheet like a wallet does, and the circle is
   drawn as a ring with coins moving as members pay.

**Demo** is a guided version: Rosca's faucet funds the wallet and two bots, Ravi and Meera, play a 3-person circle with
2-minute rounds, so anyone can see a full round in about five minutes. Demo also lets you **play the thief**: send the
pot to a stranger with your own real signature, and watch it revert on chain.

How it works, who can move the pot, your keys, the recovery phrase and the proof links live behind the profile button.

All signing happens on the device. The QoreChain REST API sends no CORS headers, so the app's Vercel project rewrites
`/api/rest/*` to it; the rewrite only forwards already-signed transactions. Build with `npm run build:app` (esbuild), deploy `web-app/`.
The site (`web/`) is plain HTML and CSS.

## The live circle

`scripts/keeper.ts` runs as a service and plays five demo members in one circle after another, one round an hour, so the
home page always shows a live round. Once per circle it also plays a thief with a stolen classical key; every attempt
reverts on chain. See [`docs/PROOF.md`](docs/PROOF.md).

## Security and AI

- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md): who might attack, what stops each attack, and the risk that is left.
- [`docs/PROOF.md`](docs/PROOF.md): every claim as a testnet transaction.
- [`AI_USAGE.md`](AI_USAGE.md): how an AI coding agent built Rosca, what the humans did, and how the work was checked.
- [`audit/`](audit/): the two-stage QCAI audit. Stage 1 (before fixes) scored 72/100 with 6 findings; each one is
  assessed there with its fix. The audit covers the contract source, so it applies to any network the same code is
  deployed on.

## Kits used

| Kit | Where |
| --- | --- |
| [`create-qorechain-dapp`](https://www.npmjs.com/package/create-qorechain-dapp) 0.14.0, `foundry` template | project skeleton, EVM window helper (`scripts/window.ts`) |
| [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk), [`@qorechain/evm`](https://www.npmjs.com/package/@qorechain/evm) | EVM window, PQC key registration |
| [Foundry](https://getfoundry.sh) | contracts and tests |

The original template README is kept as `TEMPLATE-README.md`.

## Team

Nikhil P N and Hina Hanan (ideas and product direction).

## Licence

MIT
