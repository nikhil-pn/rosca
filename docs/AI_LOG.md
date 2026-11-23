# Build log: briefs, agent work and evidence

A session-by-session record of how Rosca was built with an AI coding agent (see [`AI_USAGE.md`](../AI_USAGE.md) for the
workflow). Each entry gives the owner's brief in short, what the agent did, where a human decision or a push-back changed
the result, and the commits or transactions that show it. Times are IST; every hash is in `git log`.

## 20 Nov, 16:44 to 23:30: from template to a live product (113 commits)

**Brief.** Build the chit-fund idea for the Post-Quantum dApp category: the pot must need a post-quantum signature;
web in the owner's Apple-wallet reference style; later "make it app-first", "a demo mode and a live mode", "can I name
my circle?", "is a 3-minute round really a savings circle?".

**Agent.**
- Started from `create-qorechain-dapp` (`613c945`), wrote `RoscaCircle`, `RoscaFactory`, `PqcGate` and the Foundry
  suite.
- Read the SDK source in `node_modules` to find the scoped EVM window, PQC key registration with proof of possession
  and a missing `MsgConvertCoin` encoder, which it wrote by hand.
- Deployed to the testnet and ran a first full round with a real ML-DSA-87 release (`docs/PROOF.md`).
- Built the keeper, which runs circles forever and attacks each one (`7239e91`), then the site and the installable app
  with separate Live and Demo wallets (`4eb71e4`, `74252f9`).

**Human decisions.**
- The owner chose the idea and the name, and set the look and the product shape (Live and Demo, organiser-set terms).
- After researching chit-fund practice and the Indian Chit Funds Act, the agent made monthly the default and kept short
  rounds for testing; the owner agreed.

**Mistakes caught.** Loose gas limits (the testnet bills half the limit) and a guessed function selector; both are in
the AI_USAGE table.

## 21 Nov, 00:09 to 01:00: audit stage 1 and its fixes

**Brief.** "Can you do the audit, check the code, and tomorrow's things, audit fixes, today itself?"

**Agent.** Drove the QCAI dashboard in the owner's browser, saved the stage-1 report (72/100, high), triaged six findings,
and fixed the two real ones: members-only `closeAuction` and "the token must be a contract" (`71dd5fe`). It added
re-entrancy tests with a malicious token (`896cbc8`), then deployed factory v2 and kept v1 readable (`7882b12`, `75e8c49`).

**Human decision.** Never pay for a mainnet audit; the audit covers source code, so testnet is enough.

## 21 Nov, 17:00: a fairness bug found by the agent's own second review

**Brief.** The owner pointed at a note in the agent's records.

**Agent.** Confirmed the bug: on dissolve, winners got their held security back, so members who never won lost money.
It wrote two tests that fail on the old code (`cff3d2a`), fixed the contract (`375b039`) and deployed factory v3.

## 22 Nov, 00:10 to 01:10: audit stage 2, the project page, the cover and phones

**Brief.** "Do the audit and the project page, and make a new cover in my brand style." Later, from a phone screenshot:
"I'm able to drag left and right. It should fit."

**Agent.**
- Ran stage 2 twice. Auto-detect read the Solidity as Ethereum: 72, high, quantum readiness not scored. The QoreChain
  setting gave 78, medium, quantum-safe. Both are listed, and every finding is answered (`f878ca0`).
- Filled the project page: kits went from 0 of 1 verified to 3 of 3, and network features were ticked.
- Rendered a new cover from the live site (`fee5dcf`).
- Found the cause of the sideways drag: a glow behind the phone sat 18% past the screen edge (`55932f2`, `28b27e2`).

**Human decision.** The owner kept the background and asked for one main call to action on the site; the agent removed a
duplicate footer button rather than adding more.

## 22 Nov, 22:30 to 23:30: broken proof links

**Agent.** While capturing screens for the video, it found that every explorer link opened a mainnet "not found" page:
the explorer chooses its network with a cookie, and it only knows Cosmos hashes. It built `/tx/<hash>`, which reads each
transaction straight from the testnet and decodes it, and pointed every link there (`2a68f03`). It also added the
judges' requirement table to the README (`6c4a955`).

## 23 Nov, 02:45 to 06:10: independent judges, then factory v4

**Brief.** "Run an independent agent and the judge agent, see the score, and tell me how to raise it." Then: "do it and
fix and improve, in this order: 2, 3, 5, 4."

**Agent.**
- Ran two fresh agents, briefed only with the fest rules and links, as judges. They scored Rosca 73 and 74 out of 100.
  Their findings: a member could skip shares and still win, a stolen classical key could bid, member windows still
  allowed fUSD, and the tests used only a mock of the precompile.
- Fixed all four, in the owner's order:
  - v4 contract: signed bids, a paid-every-round rule, discounts shared only among the round's payers (`7fe0655`),
    with six new tests (`1a4e7cc`);
  - circle-only windows (`a3c49f8`);
  - an honesty pass over every claim;
  - real ML-DSA-87 vectors against the live precompile (`1cb8053`).
- Proved two chain rules by sending the transactions itself. A native send signed only with the classical key is
  refused ("hybrid PQC signature required"), and an `fUSD.transfer` outside the window is refused ("the window does
  not list … as an allowed recipient"). The keeper now repeats both attacks after every payout.

**Human decision.** The video is recorded last, after every UI change.

## What the humans did throughout

- Nikhil chose the idea, set the bar and the order of work, tried every version on his phone and sent screenshots.
- He signed in, typed SMS codes and approved anything that could cost money.
- Hina Hanan contributed ideas and product direction.
