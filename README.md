# Rosca

**The savings circle the organiser can't run away with.**

> Built for QoreChain [Build Before Q-Day](https://build.qorechain.io), category **Post-Quantum dApp**.
> Deadline: 2 December 2026, 23:59 UTC (3 December, 05:29 IST). Testnet only (`qorechain-diana`, EVM chain id 9800).

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
- Each month the members bid for the pot. The lowest bid wins, as in a real chit fund, and the discount is shared out.
- Paying out needs the winner's **ML-DSA-87** (post-quantum) signature, checked on chain with `pqcVerify`, and a majority of members.
- A leaked classical (ECDSA) key alone can move nothing.

Work in progress. This README is updated at each milestone.

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
