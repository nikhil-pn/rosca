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
 * Env: ROSCA_ROUND_SECONDS (default 1800), ROSCA_TICK_SECONDS (default 10).
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
const TICK = Number(process.env.ROSCA_TICK_SECONDS ?? 10) * 1000;
/** The hourly demo circle only needs a look every 30 s; visitors' circles get one every tick. */
const MAIN_EVERY = Math.max(1, Math.round(30_000 / TICK));
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
const bots = await Promise.all(["bot-1", "bot-2"].map((r) => account(r as `bot-${number}`)));
const byAddr = (a: string) => [...members, ...bots].find((m) => m.evm.toLowerCase() === a.toLowerCase());

// ---------------------------------------------------------------- money for the demo accounts

async function topUp(): Promise<void> {
  for (const m of [org, ...members, ...bots]) {
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


// ---------------------------------------------------------------- visitors' circles ("Try it yourself")

/**
 * A visitor on the website opens a circle named "Try · …" for three members and joins it first.
 * The two bots join, pay every round, close the auction if the visitor doesn't, and approve.
 * The visitor wins round 1 (first to join, so they take it even with no bid) and releases it with
 * their own ML-DSA-87 signature from the browser. The bots win and release rounds 2 and 3.
 * Bots keep one window scoped to fUSD and every visitor circle they are in (at most 15).
 */
const TRY_PREFIX = "Try · ";
const TRY_MAX_AGE = 3 * 3600 * 1000;
const tracked = new Map<Address, number>(); // circle -> when first seen

const botScope = (): Address[] => [CONFIG.fusd, ...[...tracked.keys()].slice(-15)];

const scanned = new Map<string, number>(); // factory -> circles already looked at

async function discover(): Promise<void> {
  const d = readDeployments();
  // Visitors' circles can live on any factory: the current one or an earlier one.
  for (const factory of [...(d.olderFactories ?? []).map((f) => f.address), d.factory].filter(Boolean) as Address[]) {
    await discoverOn(factory);
  }
}

async function discoverOn(factory: Address): Promise<void> {
  const all = (await publicClient.readContract({ address: factory, abi: c.factoryAbi, functionName: "circles" })) as Address[];
  const seen = scanned.get(factory) ?? 0;
  const from = seen === 0 ? Math.max(0, all.length - 40) : seen;
  for (const circle of all.slice(from)) {
    const name = await c.read<string>(circle, "name");
    if (!name.startsWith(TRY_PREFIX)) continue;
    const [size, share, roundLength, phase] = await Promise.all([
      c.read<number>(circle, "size"),
      c.read<bigint>(circle, "share"),
      c.read<number>(circle, "roundLength"),
      c.read<number>(circle, "phase"),
    ]);
    // Only play the circles the website makes: 3 members, small shares, short rounds.
    if (size !== 3 || share > 20n * UNIT || roundLength > 600 || phase > 1) continue;
    tracked.set(circle, Date.now());
    log(`try circle found: "${name}" ${circle}`);
  }
  scanned.set(factory, all.length);
}

/** Bots lock money in several circles at once, so keep their wallets topped up (checked every 5 min). */
let botsChecked = 0;
async function topUpBots(): Promise<void> {
  if (Date.now() - botsChecked < 300_000) return;
  botsChecked = Date.now();
  for (const b of bots) {
    const qor = await publicClient.getBalance({ address: b.evm as Address });
    if (qor < 15n * 10n ** 17n) log(`top up bot ${b.evm.slice(0, 8)}: 3 QOR ${await fundQor(b.cosmos, 3_000_000n)}`);
    const fusd = (await publicClient.readContract({ address: CONFIG.fusd, abi: ERC20, functionName: "balanceOf", args: [b.evm as Address] })) as bigint;
    if (fusd < 60n * UNIT) log(`top up bot ${b.evm.slice(0, 8)}: fUSD ${await fundFusd(b.evm, 100n * UNIT - fusd)}`);
  }
}

async function tryStep(circle: Address): Promise<void> {
  const scope = botScope();
  // A round nobody can finish (e.g. the only member left to win didn't pay) is dissolved after the
  // grace period, so everyone gets back what they put in.
  if (await c.read<boolean>(circle, "isStalled")) {
    log(`try dissolve stalled ${circle.slice(0, 8)}`, await c.dissolve(bots[0], circle, scope));
    return;
  }
  const phase = PHASE[await c.read<number>(circle, "phase")];
  if (phase === "Completed" || phase === "Dissolved") {
    for (const b of bots) {
      const owed = await c.read<bigint>(circle, "withdrawable", [b.evm]);
      if (owed > 0n) log(`try withdraw ${b.evm.slice(0, 8)}`, await c.withdraw(b, circle, scope));
    }
    tracked.delete(circle);
    log(`try circle ${circle} finished`);
    return;
  }
  const joined = (await c.read<Address[]>(circle, "members")).map((a) => a.toLowerCase());
  if (phase === "Forming") {
    if (joined.length === 0) return; // the visitor joins first, so they win round 1
    for (const b of bots) {
      if (!joined.includes(b.evm.toLowerCase())) {
        log(`try join ${b.evm.slice(0, 8)}`, await c.join(b, circle, scope));
        return; // one action per tick keeps every circle moving
      }
    }
    return;
  }
  const round = await c.read<bigint>(circle, "currentRound");
  const r = await c.read<RoundView & { closedAt: bigint }>(circle, "getRound", [round]);
  if (!r.closed) {
    if (now() <= r.bidEnd) {
      for (const b of bots) {
        if (!(await c.read<boolean>(circle, "paid", [round, b.evm]))) {
          log(`try pay r${round} ${b.evm.slice(0, 8)}`, await c.pay(b, circle, scope));
          return;
        }
      }
    } else if (now() > r.bidEnd + 20n) {
      log(`try close r${round}`, await c.closeAuction(bots[0], circle, scope)); // the visitor had 20 s to do it
    }
    return;
  }
  if (r.released) return;
  const needed = await c.read<number>(circle, "quorumNeeded");
  const winnerBot = byAddr(r.winner);
  // One bot approves at once; the second only if the visitor hasn't approved within 45 s.
  for (const [i, b] of bots.entries()) {
    if (r.approvals >= needed) break;
    if (await c.read<boolean>(circle, "approved", [round, b.evm])) continue;
    if (i === 1 && r.approvals >= 1 && now() < r.closedAt + 45n && !winnerBot) break;
    log(`try approve r${round} ${b.evm.slice(0, 8)}`, await c.approveRelease(b, circle, scope));
    return;
  }
  if (winnerBot && r.approvals >= needed && bots.includes(winnerBot)) {
    log(`try release r${round} (ML-DSA-87)`, await c.release(winnerBot, circle, undefined, scope));
  }
}

async function tryTick(): Promise<void> {
  await discover();
  if (tracked.size) await topUpBots().catch((e) => log("bot top-up failed:", e instanceof Error ? e.message.split("\n")[0] : e));
  for (const [circle, seen] of tracked) {
    if (Date.now() - seen > TRY_MAX_AGE) {
      tracked.delete(circle);
      continue;
    }
    await tryStep(circle).catch((e) => log(`try ${circle.slice(0, 8)} error:`, e instanceof Error ? e.message.split("\n")[0] : e));
  }
}

// ---------------------------------------------------------------- forever

log(`keeper: ${SIZE} members, ${SHARE} fUSD shares, ${ROUND}s rounds`);
let tick = 0;
for (;;) {
  await tryTick().catch((e) => log("try error:", e instanceof Error ? e.message.split("\n")[0] : e));
  if (tick++ % MAIN_EVERY !== 0) {
    await sleep(TICK);
    continue;
  }
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
