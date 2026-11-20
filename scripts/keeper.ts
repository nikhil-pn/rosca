/**
 * The keeper keeps a demo circle running on the testnet, so the website always shows a live round.
 *
 * Five demo members play a real chit fund: they pay every round, bid the discount they accept,
 * close the auction, approve the release, and the winner releases the pot with an ML-DSA-87
 * signature. Once per circle a "thief" holding a winner's stolen classical key tries to take
 * the pot. That transaction is sent on purpose and reverts on chain, and its hash is recorded.
 *
 *   ROSCA_FUNDER_ENV=~/.config/pi/qorex.env npx tsx scripts/keeper.ts
 *
 * Env: ROSCA_ROUND_SECONDS (default 1800), ROSCA_TICK_SECONDS (default 30).
 */
import { pqcSign, generateMnemonic, deriveUnifiedAccount, type UnifiedAccount } from "@qorechain/sdk";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { account, memberRoles } from "./lib/accounts.ts";
import * as c from "./lib/circle.ts";
import { CONFIG } from "./lib/config.ts";
import { readDeployments, writeDeployments } from "./lib/deployments.ts";
import { ensureWindow, publicClient, qorechainTestnet, walletFor } from "./lib/evm.ts";
import { fundFusd, fundQor } from "./lib/native.ts";

const ROUND = Number(process.env.ROSCA_ROUND_SECONDS ?? 1800);
const TICK = Number(process.env.ROSCA_TICK_SECONDS ?? 30) * 1000;
const SIZE = 5;
const SHARE = 10; // fUSD per member per round
const NAMES = ["Office kuri", "Family chit", "Friends kameti"];
const PHASE = ["Forming", "Running", "Completed", "Dissolved"] as const;
const UNIT = 10n ** BigInt(CONFIG.fusdDecimals);

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

interface RoundView {
  start: bigint;
  bidEnd: bigint;
  bestBidder: Address;
  bestDiscount: bigint;
  winner: Address;
  approvals: number;
  closed: boolean;
  released: boolean;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => BigInt(Math.floor(Date.now() / 1000));
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

const org = await account("deployer");
const members = await Promise.all(memberRoles(SIZE).map((r) => account(r)));
const byAddr = (a: string) => members.find((m) => m.evm.toLowerCase() === a.toLowerCase());

// ---------------------------------------------------------------- money for the demo accounts

async function topUp(): Promise<void> {
  for (const m of [org, ...members]) {
    const qor = await publicClient.getBalance({ address: m.evm as Address });
    if (qor < 15n * 10n ** 17n) log(`top up ${m.evm}: 3 QOR ${await fundQor(m.cosmos, 3_000_000n)}`);
    if (m === org) continue;
    const fusd = (await publicClient.readContract({ address: CONFIG.fusd, abi: ERC20, functionName: "balanceOf", args: [m.evm as Address] })) as bigint;
    const need = BigInt(SHARE * SIZE) * UNIT;
    if (fusd < need) log(`top up ${m.evm}: fUSD ${await fundFusd(m.evm, need - fusd + 10n * UNIT)}`);
  }
}

// ---------------------------------------------------------------- one circle

async function openCircle(): Promise<Address> {
  const d = readDeployments();
  const n = (d.live?.count ?? 0) + 1;
  const name = `${NAMES[(n - 1) % NAMES.length]} #${n}`;
  await topUp();
  const made = await c.createCircle(org, d.factory as Address, { name, shareFusd: SHARE, size: SIZE, roundSeconds: ROUND, graceSeconds: ROUND });
  log(`opened "${name}" ${made.address} (tx ${made.tx})`);
  d.circles = [...(d.circles ?? []), { address: made.address, name, tx: made.tx }];
  d.live = { address: made.address, count: n };
  writeDeployments(d);
  for (const m of members) log(`join ${m.evm.slice(0, 8)}`, await c.join(m, made.address));
  return made.address;
}

/** Bid from a random member who paid and has not won yet. Higher discounts win. */
async function maybeBid(circle: Address, r: RoundView, eligible: UnifiedAccount[]): Promise<void> {
  const elapsed = Number(now() - r.start) / ROUND;
  const hasBid = r.bestBidder !== "0x0000000000000000000000000000000000000000";
  // First bid after a third of the round; sometimes an outbid after two thirds.
  if (!hasBid && elapsed > 0.33 && eligible.length) {
    const who = pick(eligible);
    const discount = 1.5 + Math.round(Math.random() * 8) / 2; // 1.5 .. 5.5 fUSD
    log(`bid ${who.evm.slice(0, 8)} ${discount} fUSD`, await c.bid(who, circle, discount));
  } else if (hasBid && elapsed > 0.66 && Math.random() < 0.02) {
    const rivals = eligible.filter((m) => m.evm.toLowerCase() !== r.bestBidder.toLowerCase());
    if (!rivals.length) return;
    const who = pick(rivals);
    const discount = Number(r.bestDiscount / (UNIT / 10n)) / 10 + 1 + Math.round(Math.random() * 4) / 2;
    const cap = Number((await c.read<bigint>(circle, "maxDiscount")) / (UNIT / 10n)) / 10;
    if (discount <= cap) log(`outbid ${who.evm.slice(0, 8)} ${discount} fUSD`, await c.bid(who, circle, discount));
  }
}

/**
 * A thief has the winner's classical (secp256k1) key. Through the winner's scoped window they call
 * `release` to their own address, either with a signature from their own ML-DSA-87 key or by
 * replaying the winner's real signature for a different recipient. Both revert on chain.
 * The transaction is sent with a fixed gas limit and no estimate, so it lands and fails visibly.
 */
async function thiefTries(circle: Address, winner: UnifiedAccount, round: bigint, kind: "forged" | "replayed"): Promise<Hex> {
  await ensureWindow(winner, c.scope(circle));
  const thief = privateKeyToAccount(generatePrivateKey()).address;
  const deadline = now() + 3600n;
  let signature: Hex;
  if (kind === "forged") {
    const thiefPqc: UnifiedAccount = await deriveUnifiedAccount(generateMnemonic(), 0);
    const message = await c.read<Hex>(circle, "payoutMessage", [round, thief, deadline]);
    signature = bytesToHex(pqcSign(thiefPqc.pqc.secretKey, hexToBytes(message)));
  } else {
    signature = await c.signPayout(winner, circle, round, winner.evm as Address, deadline);
  }
  const hash = await walletFor(winner).writeContract({
    address: circle,
    abi: c.circleAbi,
    functionName: "release",
    args: [thief, deadline, signature],
    gas: 1_200_000n,
    chain: qorechainTestnet,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log(`thief (${kind}) -> ${receipt.status}`, hash);
  const d = readDeployments();
  d.attacks = [...(d.attacks ?? []), { circle, round: Number(round), kind, thief, tx: hash, status: receipt.status, at: new Date().toISOString() }];
  writeDeployments(d);
  return hash;
}

async function step(circle: Address): Promise<"done" | "wait"> {
  const phase = PHASE[await c.read<number>(circle, "phase")];
  if (phase === "Completed" || phase === "Dissolved") {
    for (const m of members) {
      const owed = await c.read<bigint>(circle, "withdrawable", [m.evm]);
      if (owed > 0n) log(`withdraw ${m.evm.slice(0, 8)} ${Number(owed) / 1e6} fUSD`, await c.withdraw(m, circle));
    }
    return "done";
  }
  if (phase === "Forming") {
    const joined = (await c.read<Address[]>(circle, "members")).map((a) => a.toLowerCase());
    for (const m of members) if (!joined.includes(m.evm.toLowerCase())) log(`join ${m.evm.slice(0, 8)}`, await c.join(m, circle));
    return "wait";
  }

  const round = await c.read<bigint>(circle, "currentRound");
  const r = await c.read<RoundView>(circle, "getRound", [round]);
  if (!r.closed) {
    if (now() <= r.bidEnd) {
      for (const m of members) {
        if (!(await c.read<boolean>(circle, "paid", [round, m.evm]))) log(`pay r${round} ${m.evm.slice(0, 8)}`, await c.pay(m, circle));
      }
      const eligible: UnifiedAccount[] = [];
      for (const m of members) if (!(await c.read<boolean>(circle, "hasWon", [m.evm]))) eligible.push(m);
      await maybeBid(circle, r, eligible);
      return "wait";
    }
    log(`close r${round}`, await c.closeAuction(pick(members), circle));
    return "wait";
  }
  if (!r.released) {
    const winner = byAddr(r.winner);
    if (!winner) throw new Error(`winner ${r.winner} is not a demo member`);
    const needed = await c.read<number>(circle, "quorumNeeded");
    let approvals = r.approvals;
    for (const m of members) {
      if (approvals >= needed) break;
      if (m === winner || (await c.read<boolean>(circle, "approved", [round, m.evm]))) continue;
      log(`approve r${round} ${m.evm.slice(0, 8)}`, await c.approveRelease(m, circle));
      approvals++;
    }
    if (round === 2n) {
      const d = readDeployments();
      const tried = (d.attacks ?? []).some((a) => a.circle.toLowerCase() === circle.toLowerCase());
      if (!tried) await thiefTries(circle, winner, round, (d.live?.count ?? 1) % 2 ? "forged" : "replayed").catch((e) => log("thief send failed:", e.message ?? e));
    }
    log(`release r${round} (ML-DSA-87)`, await c.release(winner, circle));
  }
  return "wait";
}

// ---------------------------------------------------------------- forever

log(`keeper: ${SIZE} members, ${SHARE} fUSD shares, ${ROUND}s rounds`);
for (;;) {
  try {
    const d = readDeployments();
    let circle = d.live?.address as Address | undefined;
    if (!circle) circle = await openCircle();
    const res = await step(circle);
    if (res === "done") {
      log(`circle ${circle} finished`);
      await openCircle();
    }
  } catch (e) {
    log("error:", e instanceof Error ? e.message.split("\n")[0] : e);
  }
  await sleep(TICK);
}
