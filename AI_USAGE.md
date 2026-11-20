# How AI built Rosca

Rosca was built by a two-person team working with an AI coding agent, [Claude Code](https://claude.com/claude-code)
(Anthropic), running in a terminal on our own always-on Linux machine and driven from a phone.
**The agent wrote all of the code, tests, scripts, websites and docs in this repository**, starting from the official `create-qorechain-dapp` Foundry template. The humans chose what to
build, set the design and the rules, made every product decision, reviewed the results, and did the steps only a
person can do (signing in, typing SMS codes, approving spending).

This file covers the three things the Best AI-Native Build award asks for: **the workflow**, **the generated work** and
**the human contribution**. It also documents how the agent acted as a **security reviewer** and an **autonomous
tester**, and where it was wrong.

| | |
| --- | --- |
| Agent | Claude Code, one long-running agent session per working day, plus short sub-agents for research |
| Written by the agent | contracts, 65 tests, deploy and member scripts, the keeper, the faucet function, the site, the app, all docs |
| Written by hand | no code; the template files came from `create-qorechain-dapp`; the humans decided, reviewed and approved |
| Commits | every commit in `git log` was made by the agent in small steps during the fest; they carry the owner's git name and a `Co-Authored-By` line |
| Verified by | Foundry (unit, fuzz, invariant), real testnet transactions, and headless-browser runs of every user flow |

## 1. The workflow

Every feature went through the same loop:

1. **Brief.** The owner asks for something in plain words, often voice-typed from a phone
   ("make it app-first", "a demo mode and a live mode", "is a 3-minute round a real savings circle?").
2. **Research before building.** The agent reads the fest rules, the QoreChain SDK source in `node_modules`, the
   chain itself (`cast`, REST queries) and the web, and says what it found, with sources, before writing code.
   Example: before choosing round lengths it checked how real chit funds work and the Indian Chit Funds Act limits
   (discount cap 40%, organiser commission up to 7%), then made monthly the default and kept short rounds for testing and the demo.
3. **Plan, then small commits.** The agent builds in one-concern commits (a contract function, a CSS block, a doc
   section) and pushes as it goes.
4. **Prove it on chain.** Nothing counts as done until it has worked on the QoreChain testnet: a deploy, a real round,
   a reverted attack, or a full app flow clicked through in a headless browser.
5. **Look at it.** For anything visual the agent takes screenshots at phone and desktop sizes, reads them, and fixes
   what looks wrong before showing the owner.
6. **Owner review.** The owner tries it on his phone or laptop and sends feedback with screenshots. The agent
   pushes back when it disagrees (for example, it kept the organiser fee cap at 5% though the law allows 7%, to protect
   members, and dropped a duplicate footer button) and otherwise builds what was asked.
7. **Memory.** At the end of each session the agent writes what it did, what it learned and what is left into its
   notes, so the next session continues without re-research.

The agent ran on our own machine with access to a terminal, a browser it could drive, the testnet, GitHub (`gh`) and
Vercel. Outward or costly actions needed the owner (see section 7).

## 2. The generated work

| Area | What the agent produced | Where |
| --- | --- | --- |
| Research | Read 100+ fest project pages and past hackathon winners, compared ideas, and recommended a chit fund on a post-quantum chain; researched ROSCA cadence and the Chit Funds Act | team notes (outside the repo); the result is `docs/PLAN.md` |
| Contracts | `RoscaCircle` (join, pay, discount auction, approvals, ML-DSA-87 release via `pqcVerify`, security held from winners, dissolve and refunds), `RoscaFactory`, `PqcGate` (reads the registered key from `pqcKeyStatus`, checks the signature with `pqcVerify`) | `src/` |
| Tests | 65 Foundry tests: unit tests per action, fuzz tests, and an invariant test that money is conserved over 128,000 random actions; mocks for the two PQC precompiles | `test/` |
| Chain scripts | Accounts, funding, ML-DSA-87 key registration with proof of possession, scoped EVM windows signed with both keys, a hand-encoded `MsgConvertCoin` (the SDK had none), deploy, a full demo round | `scripts/` |
| The keeper | A service that runs demo circles forever, plays two bots in visitors' circles, sends a real thief attempt once per circle, tops up its accounts and dissolves stalled circles | `scripts/keeper.ts` |
| Faucet | A Vercel function that funds new demo wallets once, from a throwaway testnet account | `web-src/api/faucet.ts` |
| The app | An installable web app: wallet made on the device, Live and Demo modes, circle creator, invite links, wallet-style confirm sheets, the money-flow ring, profile with how it works, security and proof | `web-src/app/`, `web-src/lib/`, `web-app/` |
| The site | Landing page and the How it works, Live, Security and Proof pages, read live from the chain | `web/` |
| Design | The glass look, the animated pot-and-members ring, icons, the social card, all from the owner's reference screenshot | `web/css/`, `web-app/css/`, `web/js/ring.js` |
| Docs | README, the on-chain proof with every transaction link, this file | `README.md`, `docs/PROOF.md`, `AI_USAGE.md` |
| Operations | Vercel deploys, the two subdomains (it drove the owner's browser to add the DNS records), the keeper service | — |

## 3. The human contribution

**Nikhil P N** (builder, registered on the fest):

- chose the idea from a shortlist, and the name Rosca so organisers recognise it;
- set the bar: a clean "safe money" design from an Apple-wallet screenshot he sent, app-first, glass, simple;
- made the product calls: Live and Demo modes, the organiser sets the terms, one main button, monthly as the default;
- tested every version on his phone and laptop and sent screenshots of what was wrong;
- did what only a person can: signing in to Google, GitHub and the domain registrar, typing SMS codes, and approving anything that could cost money;
- asked the hard questions ("is a 3-minute round really a savings circle?", "what would mainnet cost?") that changed the design.

**Hina Hanan**: ideas and product direction.

The agent decided the technical details: contract design, the security model, the test strategy, gas tuning and
the architecture of the site and the app. The owner reviewed the results rather than the code line by line.

## 4. How the AI's work was checked

- **Foundry:** `forge test` runs all 65 tests; fuzz and invariant runs check that money is conserved and that no
  sequence of actions lets anyone but the winner, with a majority, move the pot.
- **The chain:** every feature was run for real on `qorechain-diana`. `docs/PROOF.md` lists the first full round, the
  keeper's circles, and the thief attempts that reverted.
- **The app, end to end:** the agent wrote headless-browser scripts that click through the app the way a person
  would, against the live site:
  - demo mode: make a wallet, get test money, register the key, open a circle with the bots, pay, bid, close,
    approve, try to steal the pot (reverts), sign and collect with ML-DSA-87 — run at desktop and phone sizes;
  - live mode with **two separate users**: the organiser funds a wallet the way the QoreChain faucet does, creates a
    2-person circle with custom terms and shares an invite link; the friend opens it, funds and sets up a wallet,
    joins, and both play a round to a signed payout.
- **Screenshots:** every screen was checked visually at phone and desktop sizes before it was shown to anyone.

## 5. The AI as security reviewer

The agent designed the contract around the attacks it expected and wrote a test for each:

| Attack | Why it fails | Proof |
| --- | --- | --- |
| The organiser takes the pot | There is no owner, admin, upgrade or withdraw function | tests, contract |
| A thief with a member's classical (secp256k1) key redirects the pot | The payout needs the winner's ML-DSA-87 signature over circle, round, recipient, amount and deadline | tests; real reverted transactions from the keeper and from the app |
| A thief replays the winner's real signature to another address | The signed message names the recipient | reverted on testnet from the app |
| A winner stops paying | Part of their pot is held as security and pays their later shares | tests |
| A round stalls forever | After a grace period members dissolve the circle and get refunds | tests; the keeper dissolved two real stalled circles |
| A stolen key drains the wallet through other contracts | Member windows are scoped to the circle and fUSD only, and only the post-quantum key can open a wider one | window scripts |

The fest's two-stage QCAI audit is run on top of this review; its reports go in `audit/`.

## 6. The AI as autonomous tester

The keeper (`scripts/keeper.ts`) is a test harness that never stops. Around the clock it runs real circles with five
demo members, attacks each circle once with a stolen-key payout that must revert, plays bots in every visitor's
circle, keeps its accounts funded, and cleans up circles that stall. Its records are in `deployments/testnet.json`, and
the site reads them live.

## 7. Guardrails

- **Testnet only.** Every key the agent created is a throwaway testnet key kept outside the repository.
- **Money needs a person.** The agent stops and asks before anything that could cost money. Test tokens came only from
  the public QoreChain faucet.
- **Outward actions need a person.** Posting, creating accounts, and DNS changes happen only when the owner asks, and
  sign-ins and SMS codes are typed by the owner.
- **The machine's own safety checks** blocked actions twice, and the agent took a safer route each time: an automatic
  git-push timer was refused (and the owner didn't want it either), and an unparseable shell command was rewritten as a script file.

## 8. Where the AI was wrong, and how it was caught

| Mistake | Caught by | Fix |
| --- | --- | --- |
| Gas limits left loose; the testnet bills half the limit, not the gas used | the agent measuring receipts | estimate and add 30%; a payout fell from 0.14 to 0.055 QOR |
| Guessed a function selector for `organiser()` | an on-chain call before shipping | used the real selector from `cast sig` |
| A bot ran out of test dollars in parallel circles, which stalled two circles and burned gas on transactions that could only revert | the agent reading the keeper's logs during a test | bots top up, stalled circles are dissolved, and a call is never sent if the chain says it will revert |
| A glass highlight was drawn over text and greyed it out | screenshot review | moved the highlight beneath the content |
| The app's offline cache read a response twice | code review | clone before caching |
| The landing page showed a test circle a person had made | the owner's screenshot | the site shows only the keeper's circles |
| A two-level subdomain needed the record name `app.rosca`, not `app` | the agent checking the registrar | documented in the team playbook |

## 9. What the AI did not do

- It did not decide what Rosca is for or who it serves; the team did.
- It did not hold or move real money, and it typed no passwords or codes.
- Rosca itself uses no AI at run time: the contracts and the app are deterministic, so nothing a model says can move a pot.

## Reproduce

```bash
forge test                                   # 65 tests
npm run rosca -- status                      # demo accounts on the testnet
npx tsx scripts/demo-round.ts                # one full round on the testnet
npm run build:app                            # build the app into web-app/
```
