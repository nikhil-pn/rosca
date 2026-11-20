/**
 * Rosca, the app. A visitor makes a wallet with a post-quantum key, starts a circle with two bots,
 * and plays it round by round. Everything is signed on this device; the chain is the only state.
 */
import { deriveUnifiedAccount, generateMnemonic, type UnifiedAccount } from "@qorechain/sdk";
import type { Address } from "viem";
import * as A from "../lib/actions.ts";
import { NET } from "../lib/qore.ts";
import { PEOPLE } from "../../web/js/config.js";
import { renderFeed, usd } from "../../web/js/feed.js";
import { createRing, mountFlowDemo } from "../../web/js/ring.js";
import { esc, friendly, openSheet, progressIn, toast, type Sheet } from "./ui.ts";

const SITE = "https://rosca.exprmnts.fun";
const ZERO = "0x0000000000000000000000000000000000000000";
const UNIT = 1_000_000n;

// ---------------------------------------------------------------- mode: live (real testnet use) or demo (guided, with bots)

type Mode = "live" | "demo";
const params = new URLSearchParams(location.search);
const joinParam = params.get("join");
const MODE: Mode = joinParam ? "live" : ((params.get("mode") as Mode | null) ?? (localStorage.getItem("rosca.mode") as Mode | null) ?? "live") === "demo" ? "demo" : "live";
localStorage.setItem("rosca.mode", MODE);
const DEMO = MODE === "demo";
document.body.classList.add(DEMO ? "mode-demo" : "mode-live");

function switchMode(to: Mode) {
  localStorage.setItem("rosca.mode", to);
  location.href = location.pathname;
}

// ---------------------------------------------------------------- saved state (this device only, one wallet per mode)

interface Saved {
  mnemonic?: string;
  circles: Address[];
  current?: Address;
  thief: Record<string, { tx: string; status: string }>;
  sig?: number;
}
const KEY = DEMO ? "rosca.app.v1" : "rosca.live.v1";
const saved: Saved = { circles: [], thief: {}, ...(JSON.parse(localStorage.getItem(KEY) ?? "null") ?? {}) };
const save = () => localStorage.setItem(KEY, JSON.stringify(saved));

let acc: UnifiedAccount | null = null;
const $ = (id: string) => document.getElementById(id)!;

const money = (v: bigint) => {
  const [w, d] = usd(v).slice(1).split(".");
  return `$${w}<span class="dec">.${d}</span>`;
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** "You", a demo bot's name, or in live mode "Member 2" by join order. */
const nameOf = (a: string) => {
  if (acc && a.toLowerCase() === acc.evm.toLowerCase()) return "You";
  if (DEMO) return String(PEOPLE[a.toLowerCase()] ?? short(a)).replace(" (bot)", "");
  const i = snap?.members.findIndex((m) => m.toLowerCase() === a.toLowerCase()) ?? -1;
  return i >= 0 ? `Member ${i + 1}` : short(a);
};
/** 1:05 · 3h 20m · 2d 4h */
function left(sec: number): string {
  if (sec <= 0) return "time's up";
  if (sec < 3600) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} left`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m left`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h left`;
}
/** "every 5 minutes", "weekly", "monthly"… */
function every(sec: number): string {
  const named: Record<number, string> = { 300: "every 5 minutes", 3600: "every hour", 86400: "daily", 604800: "weekly", 2592000: "monthly" };
  if (named[sec]) return named[sec];
  if (sec < 3600) return `every ${Math.round(sec / 60)} minutes`;
  if (sec < 86400) return `every ${Math.round(sec / 3600)} hours`;
  return `every ${Math.round(sec / 86400)} days`;
}
const explorerTx = (h: string) => `${NET.explorer}/tx/${h.startsWith("0x") ? h : h.toUpperCase()}`;
const txLink = (h: string, label = "View on explorer") => `<a href="${explorerTx(h)}" target="_blank" rel="noopener">${label} ↗</a>`;
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

// ---------------------------------------------------------------- what the chain says now

interface Snap {
  qor: bigint;
  fusd: bigint;
  key: boolean;
  circle?: Address;
  phase: number;
  members: Address[];
  round: number;
  r?: A.RoundView;
  r1?: A.RoundView;
  paid: boolean[];
  approved: boolean[];
  won: boolean[];
  needed: number;
  owed: bigint;
  stalled: boolean;
  info?: A.CircleInfo;
  /** Faucet fUSD still sitting on the native side, waiting to be moved into the wallet. */
  bankFusd: bigint;
}
let snap: Snap | null = null;
let prev: Snap | null = null;

async function load(): Promise<Snap | null> {
  if (!acc) return null;
  const me = acc.evm as Address;
  const [qor, fusd, key, bank] = await Promise.all([
    A.qorBalance(me),
    A.fusdBalance(me),
    A.pqcRegistered(acc).catch(() => false),
    DEMO ? Promise.resolve({ uqor: 0n, fusd: 0n }) : A.bankBalances(acc).catch(() => ({ uqor: 0n, fusd: 0n })),
  ]);
  const s: Snap = { qor, fusd, key, phase: -1, members: [], round: 0, paid: [], approved: [], won: [], needed: 2, owed: 0n, stalled: false, bankFusd: bank.fusd };
  const c = saved.current;
  if (!c) return s;
  s.circle = c;
  const [info, members, phase, round, needed, stalled] = await Promise.all([
    A.circleInfo(c),
    A.read<Address[]>(c, "members"),
    A.read<number>(c, "phase"),
    A.read<bigint>(c, "currentRound"),
    A.read<number>(c, "quorumNeeded"),
    A.read<boolean>(c, "isStalled"),
  ]);
  Object.assign(s, { info, members, phase, round: Number(round), needed, stalled });
  s.won = await Promise.all(members.map((m) => A.read<boolean>(c, "hasWon", [m])));
  if (s.round >= 1) {
    const [r, r1, paid, approved] = await Promise.all([
      A.read<A.RoundView>(c, "getRound", [round]),
      A.read<A.RoundView>(c, "getRound", [1n]),
      Promise.all(members.map((m) => A.read<boolean>(c, "paid", [round, m]))),
      Promise.all(members.map((m) => A.read<boolean>(c, "approved", [round, m]))),
    ]);
    Object.assign(s, { r, r1, paid, approved });
  }
  if (phase >= 2) s.owed = await A.read<bigint>(c, "withdrawable", [me]);
  return s;
}

const meIdx = (s: Snap) => s.members.findIndex((m) => acc && m.toLowerCase() === acc.evm.toLowerCase());
const ready = (s: Snap) => s.qor > 0n && s.key;

// ---------------------------------------------------------------- the next step

interface Next {
  key: string;
  kicker: string;
  title: string;
  body: string;
  actions: string;
}

function nextStep(s: Snap): Next {
  const t = nowSec();
  const i = meIdx(s);
  const r = s.r;
  const size = s.info?.size ?? 3;
  const share = s.info?.share ?? 10n * UNIT;
  const timer = (end: bigint) => `<span class="timer" data-end="${end}"></span>`;
  if (!ready(s))
    return DEMO
      ? { key: "setup", kicker: "Almost there", title: "Finish setting up your wallet", body: "Get free test money and register your post-quantum key. It takes about ten seconds.", actions: `<button class="btn-primary" data-act="setup">Set up my wallet</button>` }
      : { key: `setup:${s.qor > 0n}`, kicker: "Almost there", title: s.qor > 0n ? "Register your post-quantum key" : "Fund your wallet", body: s.qor > 0n ? "One transaction puts your ML-DSA-87 key on chain. Circles only accept members who did this." : "Send test QOR and fUSD to your wallet from the QoreChain faucet, then come back here.", actions: `<button class="btn-primary" data-act="setup">${s.qor > 0n ? "Register my key" : "Fund my wallet"}</button>` };
  if (!DEMO && s.bankFusd > 0n)
    return { key: `convert:${s.bankFusd}`, kicker: "Money arrived", title: `Move ${usd(s.bankFusd)} fUSD into your wallet`, body: "The faucet sent fUSD to the chain's bank side. One transaction, signed with both your keys, moves it into your wallet so circles can use it.", actions: `<button class="btn-primary" data-act="convert">Move ${usd(s.bankFusd)}</button>` };
  if (!s.circle || (s.phase >= 2 && s.owed === 0n))
    return DEMO
      ? { key: `start:${s.circle ?? ""}:${s.phase}`, kicker: s.phase >= 2 ? "Circle complete" : "Get started", title: s.phase >= 2 ? "Start another circle" : "Start your first circle", body: "You and two friends, Ravi and Meera (they're bots), each put in $10 a round for 3 rounds. Everyone takes the pot once.", actions: `<button class="btn-primary" data-act="start">Start a circle</button>` }
      : { key: `start:${s.circle ?? ""}:${s.phase}`, kicker: s.phase >= 2 ? "Circle complete" : "Get started", title: s.phase >= 2 ? "Start another circle" : "Create a circle, or join one", body: "Set the name, how much each member pays, how many members, and how often. Then invite your friends with a link. Got an invite link? Open it and you'll join.", actions: `<button class="btn-primary" data-act="start">Create a circle</button>` };
  if (s.phase === 0)
    return DEMO
      ? { key: `forming:${s.members.length}`, kicker: "Starting", title: `Waiting for friends to join · ${s.members.length} of 3`, body: "Ravi and Meera are joining. Each one needs a registered post-quantum key to get in.", actions: `<span class="spinner"></span>` }
      : { key: `forming:${s.members.length}`, kicker: s.info?.name ?? "Starting", title: `Invite friends · ${s.members.length} of ${size} joined`, body: `Round 1 starts when all ${size} members have joined. Share the invite link; each friend makes a wallet and joins with their own post-quantum key.`, actions: `<button class="btn-primary" data-act="invite">Share invite link</button>` };
  if (s.stalled)
    return { key: "stalled", kicker: "Circle stuck", title: "This circle can't go on", body: "A round ran out of time and nobody can finish it. Dissolve the circle and everyone gets back what they put in, minus what they already took out.", actions: `<button class="btn-primary" data-act="dissolve">Dissolve and refund</button>` };
  if (s.phase >= 2)
    return { key: `withdraw:${s.owed}`, kicker: s.phase === 3 ? "Circle dissolved" : "Circle complete", title: `${usd(s.owed)} is waiting for you`, body: "Your security and your share of the discounts. Take it back to your wallet.", actions: `<button class="btn-primary" data-act="withdraw">Withdraw ${usd(s.owed)}</button>` };
  if (!r) return { key: "wait", kicker: "", title: "Loading…", body: "", actions: "" };
  const winner = r.closed ? r.winner : null;
  const iWin = winner && i >= 0 && winner.toLowerCase() === s.members[i].toLowerCase();
  const round = `${DEMO ? "" : `${s.info?.name ?? ""} · `}Round ${s.round} of ${size}`;
  if (!r.closed && t <= r.bidEnd) {
    if (!s.paid[i])
      return { key: `pay:${s.round}`, kicker: round, title: `Pay your ${usd(share)} for this round`, body: s.won[i] ? "You already took a pot, so you keep paying your share. If you don't, the security held from your payout covers it." : "Everyone pays in first. Then whoever needs the money most can bid for it.", actions: `<button class="btn-primary" data-act="pay">Pay ${usd(share)}</button>${timer(r.bidEnd)}` };
    if (!s.won[i] && r.bestBidder === ZERO)
      return { key: `bid:${s.round}`, kicker: round, title: "Want the pot first?", body: "Bid the discount you'd accept. The biggest discount wins, and the discount is shared with everyone. Or just wait: with no bids, the earliest member who hasn't won takes it.", actions: `<div class="stepper glass"><button data-bid="-1" aria-label="Less">−</button><span id="bid-val"></span><button data-bid="1" aria-label="More">+</button></div><button class="btn-primary" data-act="bid">Bid</button>${timer(r.bidEnd)}` };
    const lead = r.bestBidder !== ZERO ? `${nameOf(r.bestBidder)} leads with a ${usd(r.bestDiscount)} discount.` : "";
    const canOutbid = !s.won[i] && r.bestBidder.toLowerCase() !== s.members[i].toLowerCase();
    return { key: `waitbid:${s.round}:${r.bestBidder}:${r.bestDiscount}`, kicker: round, title: "You're paid in. Bidding is open.", body: `${lead} The auction closes when the timer runs out.`, actions: canOutbid ? `<div class="stepper glass"><button data-bid="-1" aria-label="Less">−</button><span id="bid-val"></span><button data-bid="1" aria-label="More">+</button></div><button class="btn-glass" data-act="bid">Outbid</button>${timer(r.bidEnd)}` : timer(r.bidEnd) };
  }
  if (!r.closed)
    return { key: `close:${s.round}`, kicker: round, title: "Bidding is over", body: DEMO ? "Anyone can close the auction now. Ravi will do it in a few seconds if you don't." : "Anyone in the circle can close the auction now. That picks this round's winner.", actions: `<button class="btn-primary" data-act="close">Close the auction</button>` };
  if (!r.released) {
    const who = nameOf(r.winner);
    const potLine = `${usd(r.collected - r.discount)} after a ${usd(r.discount)} discount`;
    if (r.approvals < s.needed && !s.approved[i])
      return { key: `approve:${s.round}:${r.approvals}`, kicker: round, title: iWin ? "You won the pot!" : `${who} wins this round`, body: `${potLine}. A majority must approve the payout: ${r.approvals} of ${s.needed} so far.`, actions: `<button class="btn-primary" data-act="approve">Approve payout</button>` };
    if (iWin && r.approvals >= s.needed) {
      const tried = saved.thief[s.circle];
      return { key: `collect:${s.round}:${tried ? 1 : 0}`, kicker: round, title: `Collect your pot`, body: `${potLine}. Sign the payout with your post-quantum key and the chain pays you.`, actions: `<button class="btn-primary" data-act="collect">Sign &amp; collect</button>${tried ? "" : `<button class="btn-glass" data-act="thief">Try to steal it</button>`}` };
    }
    return { key: `waitrel:${s.round}:${r.approvals}`, kicker: round, title: iWin ? "Waiting for approvals" : `Waiting for ${who} to sign`, body: `Approved ${r.approvals} of ${s.needed}. ${iWin ? "Ask the others to approve your payout." : `Only ${who}'s post-quantum signature can release this pot.`}`, actions: iWin && !DEMO ? `<button class="btn-glass" data-act="invite">Remind the circle</button>` : `<span class="spinner"></span>` };
  }
  return { key: `between:${s.round}`, kicker: round, title: "Next round is starting", body: "", actions: `<span class="spinner"></span>` };
}

// ---------------------------------------------------------------- screens

let tab: "home" | "activity" | "members" = "home";
let ring: ReturnType<typeof createRing> | null = null;
let nextKey = "";

function renderWelcome() {
  document.body.dataset.screen = "welcome";
  $("screen").innerHTML = `
    <section class="welcome">
      <div class="wallet-art" aria-hidden="true">
        <div class="wallet"><div class="wcard silver"></div><div class="wcard gold"><span class="brand">Rosca</span><span class="kind">Kuri</span></div><div class="pocket"><span class="stitch"></span><span class="clasp"></span></div></div>
      </div>
      <h1>Save together.<br>Nobody runs away with the pot.</h1>
      <ul class="points">
        <li class="glass"><b>Pay in</b> $10 a round with two friends</li>
        <li class="glass"><b>Take the pot</b> once, when it's your turn or your bid wins</li>
        <li class="glass"><b>Sign payouts</b> with a post-quantum key only you hold</li>
      </ul>
      <button class="btn-primary block" data-act="create">Create my wallet</button>
      <button class="btn-glass block" data-act="how">How it works</button>
      <p class="fine">Free test money on the QoreChain testnet. Nothing real is at stake.</p>
    </section>`;
}

function renderShell() {
  document.body.dataset.screen = tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".dock-btn")) b.classList.toggle("active", b.dataset.tab === tab);
  if (tab === "home") {
    $("screen").innerHTML = `
      <section class="home">
        <div class="col-a">
        <div class="bal" style="grid-area:bal">
          <p class="label">Your test dollars</p>
          <div class="bal-row"><p class="num big" id="h-bal">$0<span class="dec">.00</span></p><span class="chip glass" id="h-gas">– QOR</span></div>
        </div>
        <div class="wallet-art" style="grid-area:wallet" aria-hidden="true">
          <div class="wallet"><div class="wcard silver"></div><div class="wcard gold"><span class="brand">Rosca</span><span class="kind" id="h-kind">Kuri</span></div><div class="pocket"><span class="stitch"></span><span class="clasp"></span></div></div>
        </div>
        <article class="mini glass" style="grid-area:act">
          <header><h2>Recent activity</h2><button class="link" data-tab-go="activity">See all</button></header>
          <ul class="feed mini" id="h-feed"><li class="empty">Nothing yet.</li></ul>
        </article>
        </div>
        <div class="col-b">
        <article class="next glass sheen" style="grid-area:next" id="h-next"></article>
        <article class="ring-card glass" style="grid-area:ring">
          <header><h2 id="h-ring-title">Your circle</h2><span class="live-dot" title="Live on QoreChain testnet"></span></header>
          <div class="ring-wrap"><div id="h-ring"></div></div>
          <p class="ring-legend"><span class="lg paid"></span>paid <span class="lg win"></span>wins the pot <span class="lg tick"></span>approved</p>
        </article>
        </div>
      </section>`;
    ring = createRing($("h-ring"));
    nextKey = "";
  } else if (tab === "activity") {
    $("screen").innerHTML = `<section class="page-pane"><h1>Activity</h1><p class="sub">Every line is a transaction on the QoreChain testnet.</p><ul class="feed glass" id="a-feed"><li class="empty">Your circle's activity shows here.</li></ul></section>`;
    ring = null;
  } else {
    $("screen").innerHTML = `<section class="page-pane"><h1>Members</h1><p class="sub">Everyone joined with a registered ML-DSA-87 key. Only they can sign a payout.</p><ul class="people-list" id="m-list"><li class="empty glass">Start a circle to see its members.</li></ul></section>`;
    ring = null;
  }
}

function draw() {
  if (!acc) return renderWelcome();
  if (document.body.dataset.screen === "welcome" || !document.querySelector(".home, .page-pane")) renderShell();
  const s = snap;
  $("pill-name").textContent = saved.current ? `Circle ${Math.max(1, saved.circles.indexOf(saved.current) + 1)}` : "No circle yet";
  if (!s) return;

  if (tab === "home") {
    $("h-bal").innerHTML = money(s.fusd);
    $("h-gas").textContent = `${(Number(s.qor) / 1e18).toFixed(2)} QOR for fees`;
    $("h-kind").textContent = ["Forming", "Running", "Complete", "Dissolved"][s.phase] ?? "Kuri";
    const n = nextStep(s);
    if (n.key !== nextKey) {
      nextKey = n.key;
      $("h-next").innerHTML = `<p class="kicker">${esc(n.kicker)}</p><h2>${esc(n.title)}</h2>${n.body ? `<p>${esc(n.body)}</p>` : ""}<div class="next-actions">${n.actions}</div>`;
      bidVal = 0;
      showBid();
      tickTimers();
    }
    drawRing(s);
    void drawMiniFeed();
  } else if (tab === "activity") void drawActivity();
  else drawMembers(s);
}

function drawRing(s: Snap) {
  if (!ring) return;
  const members = s.members.length ? s.members : acc ? [acc.evm as Address] : [];
  const r = s.r;
  const view = members.map((m, i) => ({
    name: nameOf(m),
    me: nameOf(m) === "You",
    paid: Boolean(s.paid[i]),
    winner: Boolean(r?.closed && r.winner.toLowerCase() === m.toLowerCase() && !r.released),
    approved: Boolean(s.approved[i]),
    bid: r && !r.closed && r.bestBidder.toLowerCase() === m.toLowerCase() ? `−${usd(r.bestDiscount).replace(".00", "")}` : null,
  }));
  while (view.length < 3 && s.phase <= 0) view.push({ name: "…", me: false, paid: false, winner: false, approved: false, bid: null });
  const pot = r ? (r.released ? 0n : r.collected) : 0n;
  const label = !s.circle ? "no circle yet" : s.phase === 0 ? "forming" : s.phase >= 2 ? "complete" : `round ${s.round} of 3`;
  ring.set({ pot: money(pot), label, members: view, potGlow: Boolean(r && !r.closed && s.paid.every(Boolean)) });
  $("h-ring-title").textContent = s.circle ? (s.phase >= 2 ? "Circle complete" : s.phase === 0 ? "Your circle is forming" : `Round ${s.round} of 3`) : "Your circle";

  // Coins move when the chain changes: payments into the pot, a payout out of it.
  if (prev && prev.circle === s.circle && r) {
    if (prev.round === s.round) {
      s.paid.forEach((p, i) => p && !prev!.paid[i] && ring!.coin(i, "pot"));
    } else if (prev.r && !prev.r.released && s.round > prev.round) {
      const wi = prev.members.findIndex((m) => m.toLowerCase() === prev!.r!.winner.toLowerCase());
      if (wi >= 0) ring.coin("pot", wi, 3);
    }
  }
}

async function drawMiniFeed() {
  if (!saved.current || !document.getElementById("h-feed")) return;
  await renderFeed([{ address: saved.current, name: "your circle" }], thiefList(), snap?.needed ?? 2, "h-feed", 4);
}

async function drawActivity() {
  if (!saved.current) return;
  await renderFeed([{ address: saved.current, name: "your circle" }], thiefList(), snap?.needed ?? 2, "a-feed", 40);
}

function drawMembers(s: Snap) {
  if (!s.members.length) return;
  $("m-list").innerHTML = s.members
    .map((m, i) => {
      const nm = nameOf(m);
      const status = s.won[i] ? "has taken the pot" : "waiting for their turn";
      return `<li class="glass"><span class="pav${nm === "You" ? " me" : ""}">${esc(nm === "You" ? "You" : nm[0])}</span><span class="pname">${esc(nm)}${nm !== "You" ? ' <em>bot</em>' : ""}<small>${status} · ML-DSA-87 key ✓</small></span><span class="tag${s.paid[i] ? " green" : ""}">${s.paid[i] ? "paid" : "not yet"}</span></li>`;
    })
    .join("");
}

const thiefList = () =>
  Object.entries(saved.thief).map(([circle, t]) => ({ circle, round: 1, kind: "replayed", tx: t.tx, status: t.status, at: new Date().toISOString() }));

// ---------------------------------------------------------------- flows

/** Wallet-style confirm sheet, then the steps of `run` ticking off, then `done`. */
function confirmTx(o: {
  title: string;
  lead?: string;
  rows: [string, string][];
  cta: string;
  run: (p: ReturnType<typeof progressIn>) => Promise<string | void>;
  done: (tx?: string) => string;
}) {
  const sh = openSheet(`
    <div class="tx">
      <p class="kicker">Confirm with your keys</p>
      <h2>${o.title}</h2>
      ${o.lead ? `<p class="lead">${o.lead}</p>` : ""}
      <dl class="rows glass">${o.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <div class="tx-progress" hidden></div>
      <div class="tx-actions"><button class="btn-primary block" data-go>${o.cta}</button></div>
    </div>`);
  sh.body.querySelector("[data-go]")!.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner light"></span> Working…`;
    const pEl = sh.body.querySelector<HTMLElement>(".tx-progress")!;
    pEl.hidden = false;
    try {
      const tx = await o.run(progressIn(pEl));
      sh.body.querySelector(".tx-actions")!.innerHTML = `<div class="done-msg">${o.done(tx ?? undefined)}</div><button class="btn-glass block" data-close>Done</button>`;
      sh.body.querySelector("[data-close]")!.addEventListener("click", () => sh.close());
      await refresh();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Try again";
      toast(friendly(err), "err", 6000);
    }
  });
  return sh;
}

const feeRow: [string, string] = ["Network fee", "≈ 0.01 test QOR"];
const windowRow = (c: string): [string, string] => ["Can touch", `only ${esc(c)} and fUSD <span class="muted">(scoped window)</span>`];

async function withStep<T>(p: ReturnType<typeof progressIn>, text: string, fn: () => Promise<T>, note?: (v: T) => string): Promise<T> {
  const s = p.step(text);
  try {
    const v = await fn();
    s.done(note ? note(v) : undefined);
    return v;
  } catch (e) {
    s.fail();
    throw e;
  }
}

function setupFlow() {
  const sh = openSheet(`
    <div class="tx">
      <p class="kicker">Your wallet</p>
      <h2>Set up your wallet</h2>
      <p class="lead">Rosca makes two keys on this device: one for everyday transactions and an ML-DSA-87 post-quantum key that signs your payouts. They never leave this browser.</p>
      <div class="tx-progress"></div>
      <div class="tx-actions"><button class="btn-primary block" data-go>${acc ? "Continue" : "Create my wallet"}</button></div>
    </div>`);
  const go = sh.body.querySelector<HTMLButtonElement>("[data-go]")!;
  go.addEventListener("click", async () => {
    go.disabled = true;
    go.innerHTML = `<span class="spinner light"></span> Setting up…`;
    const p = progressIn(sh.body.querySelector(".tx-progress")!);
    try {
      if (!acc) {
        await withStep(p, "Making your keys on this device", async () => {
          saved.mnemonic = generateMnemonic();
          save();
          acc = await deriveUnifiedAccount(saved.mnemonic, 0);
          PEOPLE[acc.evm.toLowerCase()] = "You";
        }, () => "ML-DSA-87 · 2,592-byte public key");
        tab = "home";
        renderShell();
      } else p.step("Your keys are on this device").done();
      if ((await A.qorBalance(acc!.evm as Address)) === 0n) {
        await withStep(p, "Getting free test money", () => A.faucet(acc!), () => "1.2 QOR + $30");
        await new Promise((r) => setTimeout(r, 1500));
      } else p.step("Test money is in your wallet").done();
      if (!(await A.pqcRegistered(acc!))) {
        await withStep(p, "Registering your post-quantum key on chain", () => A.registerKey(acc!), (h) => txLink(h, "tx"));
      } else p.step("Your post-quantum key is registered").done();
      sh.body.querySelector(".tx-actions")!.innerHTML = `<div class="done-msg">You're ready. Next: start a circle.</div><button class="btn-primary block" data-next>Start a circle</button>`;
      sh.body.querySelector("[data-next]")!.addEventListener("click", () => {
        sh.close();
        startFlow();
      });
      await refresh();
    } catch (e) {
      go.disabled = false;
      go.textContent = "Try again";
      toast(friendly(e), "err", 6000);
      await refresh();
    }
  });
  if (!acc) go.click();
}

function startFlow() {
  if (!snap || !ready(snap)) return setupFlow();
  const sh = openSheet(`
    <div class="tx">
      <p class="kicker">New circle</p>
      <h2>Start a circle</h2>
      <div class="trio"><span class="pav me">You</span><span class="pav">R</span><span class="pav">M</span></div>
      <p class="lead center">You, Ravi and Meera. Ravi and Meera are bots run by Rosca, so you don't have to wait for friends.</p>
      <dl class="rows glass">
        <div><dt>Each round</dt><dd>$10 from everyone · $30 pot</dd></div>
        <div><dt>Rounds</dt><dd>3, two minutes each</dd></div>
        <div><dt>You need</dt><dd>$30 in total · you have ${money(snap.fusd)}</dd></div>
        <div><dt>Organiser fee</dt><dd>2%, taken only from discounts</dd></div>
      </dl>
      <div class="tx-progress" hidden></div>
      <div class="tx-actions"><button class="btn-primary block" data-go>Start the circle</button></div>
    </div>`);
  const go = sh.body.querySelector<HTMLButtonElement>("[data-go]")!;
  go.addEventListener("click", async () => {
    go.disabled = true;
    go.innerHTML = `<span class="spinner light"></span> Starting…`;
    const pEl = sh.body.querySelector<HTMLElement>(".tx-progress")!;
    pEl.hidden = false;
    const p = progressIn(pEl);
    try {
      await withStep(p, "Opening a window to the Rosca factory, signed with both keys", () => A.ensureWindow(acc!, [NET.factory]));
      const made = await withStep(p, "Creating your circle", () => A.createCircle(acc!, `Try · ${acc!.evm.slice(2, 8)}`), (m) => txLink(m.tx, "tx"));
      saved.circles = [...saved.circles.filter((c) => c !== made.address), made.address];
      saved.current = made.address;
      save();
      await withStep(p, "Joining through a window scoped to only this circle and fUSD", () => A.join(acc!, made.address), (h) => txLink(h, "tx"));
      p.step("Ravi and Meera are on their way").done();
      sh.body.querySelector(".tx-actions")!.innerHTML = `<div class="done-msg">Your circle is open. Round 1 starts when both friends have joined, in about a minute.</div><button class="btn-glass block" data-close>Back to my circle</button>`;
      sh.body.querySelector("[data-close]")!.addEventListener("click", () => sh.close());
      prev = null;
      await refresh();
    } catch (e) {
      go.disabled = false;
      go.textContent = "Try again";
      toast(friendly(e), "err", 6000);
    }
  });
}

let bidVal = 0;
const potOf = () => (snap?.info ? snap.info.share * BigInt(snap.info.size) : 30n * UNIT);
const shareOf = () => snap?.info?.share ?? 10n * UNIT;
/** Bids move in steps of 1% of the pot (at least $0.50), up to the circle's discount cap. */
const bidStep = () => Math.max(0.5, Math.round(Number(potOf()) / 1e6 / 100 / 0.5) * 0.5);
const bidMax = () => (Number(potOf()) / 1e6) * ((snap?.info?.maxDiscountBps ?? 3000) / 10000);
const bidFloor = () => (snap?.r && snap.r.bestBidder !== ZERO ? Number(snap.r.bestDiscount) / 1e6 + bidStep() : bidStep() * 4);
function showBid() {
  if (!bidVal || bidVal < bidFloor()) bidVal = Math.min(bidFloor(), bidMax());
  const v = document.getElementById("bid-val");
  if (v) v.textContent = usd(BigInt(Math.round(bidVal * 1e6)));
}

const actions: Record<string, () => void> = {
  create: () => setupFlow(),
  setup: () => setupFlow(),
  start: () => startFlow(),
  how: () => howSheet(),
  pay: () =>
    confirmTx({
      title: `Pay ${usd(shareOf())}`,
      rows: [["To", `${esc(snap?.info?.name && !DEMO ? snap.info.name : "Your circle")}'s pot`], ["Amount", `${usd(shareOf())} fUSD`], windowRow("your circle"), feeRow],
      cta: "Confirm and pay",
      run: (p) => withStep(p, "Paying into the pot", () => A.pay(acc!, saved.current!), (h) => txLink(h, "tx")),
      done: () => `Paid. Your ${usd(shareOf())} is in the pot.`,
    }),
  bid: () =>
    confirmTx({
      title: `Bid a ${usd(BigInt(Math.round(bidVal * 1e6)))} discount`,
      lead: "If your bid is the biggest when the timer ends, you take this round's pot minus the discount. The discount is shared with every member.",
      rows: [["Discount", `${usd(BigInt(Math.round(bidVal * 1e6)))}`], ["You'd take", `${usd(potOf() - BigInt(Math.round(bidVal * 1e6)))} of the ${usd(potOf())} pot`], ["Cap", `${(snap?.info?.maxDiscountBps ?? 3000) / 100}% of the pot`], windowRow("your circle"), feeRow],
      cta: "Confirm bid",
      run: (p) => withStep(p, "Placing your bid", () => A.bid(acc!, saved.current!, [BigInt(Math.round(bidVal * 1e6))]), (h) => txLink(h, "tx")),
      done: () => "Bid placed. It wins if nobody bids higher before the timer ends.",
    }),
  close: () =>
    confirmTx({
      title: "Close the auction",
      lead: "Bidding is over. Closing picks the winner: the biggest discount, or with no bids the first member who hasn't won yet.",
      rows: [windowRow("your circle"), feeRow],
      cta: "Confirm and close",
      run: (p) => withStep(p, "Closing the auction", () => A.closeAuction(acc!, saved.current!), (h) => txLink(h, "tx")),
      done: () => "Closed. Now the members approve the payout.",
    }),
  approve: () =>
    confirmTx({
      title: `Approve ${snap?.r ? nameOf(snap.r.winner) === "You" ? "your" : `${nameOf(snap.r.winner)}'s` : "the"} payout`,
      lead: "A majority of members must approve before anyone can release the pot.",
      rows: [["Winner", esc(snap?.r ? nameOf(snap.r.winner) : "")], ["Approvals", `${snap?.r?.approvals ?? 0} of ${snap?.needed ?? 2}, yours makes ${(snap?.r?.approvals ?? 0) + 1}`], windowRow("your circle"), feeRow],
      cta: "Confirm approval",
      run: (p) => withStep(p, "Approving", () => A.approve(acc!, saved.current!), (h) => txLink(h, "tx")),
      done: () => "Approved.",
    }),
  dissolve: () =>
    confirmTx({
      title: "Dissolve this circle",
      lead: "The circle stops. The money left goes back to members in proportion to what each put in minus what each took out.",
      rows: [windowRow("your circle"), feeRow],
      cta: "Confirm and dissolve",
      run: (p) => withStep(p, "Dissolving", () => A.dissolve(acc!, saved.current!), (h) => txLink(h, "tx")),
      done: () => "Dissolved. Withdraw your refund next.",
    }),
  collect: () => collectFlow(),
  thief: () => thiefFlow(),
  withdraw: () =>
    confirmTx({
      title: `Withdraw ${usd(snap?.owed ?? 0n)}`,
      rows: [["From", "your circle"], ["To", "your wallet"], windowRow("your circle"), feeRow],
      cta: "Confirm and withdraw",
      run: (p) => withStep(p, "Withdrawing", () => A.withdraw(acc!, saved.current!), (h) => txLink(h, "tx")),
      done: () => "Done. The money is back in your wallet.",
    }),
};

function collectFlow() {
  const s = snap!;
  const r = s.r!;
  const pot = r.collected - r.discount;
  confirmTx({
    title: `Collect ${usd(pot)}`,
    lead: "Your post-quantum key signs exactly this payout. Change any field and the signature no longer matches.",
    rows: [
      ["Circle", `<code>${short(s.circle!)}</code>`],
      ["Round", String(s.round)],
      ["Pay to", "You"],
      ["Pot", `${usd(r.collected)} − ${usd(r.discount)} discount`],
      ["Valid for", "1 hour"],
      ["Signed with", "ML-DSA-87 · on this device"],
    ],
    cta: "Sign &amp; collect",
    run: async (p) => {
      const sign = p.step("Signing with your ML-DSA-87 key");
      const res = await A.release(acc!, saved.current!).catch((e) => {
        sign.fail();
        throw e;
      });
      sign.done(`${res.sigBytes.toLocaleString()}-byte signature`);
      p.step("The chain checked it with pqcVerify").done("✓ valid");
      saved.sig = res.sigBytes;
      save();
      return res.tx;
    },
    done: (tx) => `<span class="big-ok">✓</span> The pot is yours. Part of it is held as security until you've paid your remaining shares.<br>${tx ? txLink(tx) : ""}`,
  });
}

function thiefFlow() {
  const sh = openSheet(`
    <div class="tx">
      <p class="kicker">Security test</p>
      <h2>Be the thief</h2>
      <p class="lead">Pretend you stole a winner's phone. You send their payout to a stranger instead, reusing their real post-quantum signature.</p>
      <dl class="rows glass"><div><dt>Pay to</dt><dd>a random stranger</dd></div><div><dt>Signature</dt><dd>real, but signed for <b>you</b></dd></div><div><dt>Expected</dt><dd>refused on chain</dd></div></dl>
      <div class="tx-progress" hidden></div>
      <div class="tx-actions"><button class="btn-primary block" data-go>Send the pot to a stranger</button></div>
    </div>`);
  const go = sh.body.querySelector<HTMLButtonElement>("[data-go]")!;
  go.addEventListener("click", async () => {
    go.disabled = true;
    go.innerHTML = `<span class="spinner light"></span> Sending…`;
    const pEl = sh.body.querySelector<HTMLElement>(".tx-progress")!;
    pEl.hidden = false;
    const p = progressIn(pEl);
    try {
      const res = await withStep(p, "Sending release(stranger, your signature)", () => A.steal(acc!, saved.current!));
      saved.thief[saved.current!] = { tx: res.tx, status: res.status };
      save();
      const blocked = res.status !== "success";
      sh.body.querySelector(".tx-actions")!.innerHTML = `<div class="done-msg ${blocked ? "" : "bad"}">${blocked ? '<span class="big-no">✕</span> <b>Blocked on chain.</b> The signature names you as the recipient, so <code>pqcVerify</code> fails for anyone else. The pot didn\'t move.' : "It went through. That should never happen."}<br>${txLink(res.tx, "See the failed transaction")}</div><button class="btn-primary block" data-real>Now collect it for real</button>`;
      sh.body.querySelector("[data-real]")!.addEventListener("click", () => {
        sh.close();
        collectFlow();
      });
      await refresh();
    } catch (e) {
      go.disabled = false;
      go.textContent = "Try again";
      toast(friendly(e), "err", 6000);
    }
  });
}

// ---------------------------------------------------------------- profile and info sheets

let installEvt: (Event & { prompt(): Promise<void> }) | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvt = e as never;
});

function profileSheet() {
  const sh = openSheet("");
  const home = () => {
    const s = snap;
    sh.show(`
      <div class="profile">
        <div class="pf-head"><span class="pav me big">You</span><div><h2>Your test wallet</h2>${acc ? `<button class="addr" data-copy="${acc.evm}">${short(acc.evm)} <span>copy</span></button>` : "<p class=muted>No wallet yet</p>"}</div></div>
        ${acc && s ? `<div class="pf-stats"><div class="glass"><span>Test dollars</span><b>${money(s.fusd)}</b></div><div class="glass"><span>For fees</span><b>${(Number(s.qor) / 1e18).toFixed(2)} QOR</b></div><div class="glass"><span>Post-quantum key</span><b>${s.key ? "Registered ✓" : "Not yet"}</b></div></div>` : ""}
        <nav class="menu glass">
          <button data-p="how"><span class="mi">◎</span>How it works<i>›</i></button>
          <button data-p="security"><span class="mi">⛨</span>Who can move the pot<i>›</i></button>
          <button data-p="keys"><span class="mi">⚿</span>Your keys<i>›</i></button>
          <button data-p="proof"><span class="mi">✓</span>Proof on chain<i>›</i></button>
          <a href="${SITE}/live" target="_blank" rel="noopener"><span class="mi">●</span>Watch the live circle<i>↗</i></a>
          <button data-p="install"><span class="mi">⇩</span>Add Rosca to your home screen<i>›</i></button>
        </nav>
        ${acc ? '<button class="danger" data-p="reset">Reset this test wallet</button>' : ""}
        <p class="fine center">Rosca · QoreChain testnet · <a href="${SITE}" target="_blank" rel="noopener">rosca.exprmnts.fun</a></p>
      </div>`);
    sh.body.querySelector("[data-copy]")?.addEventListener("click", async (e) => {
      await navigator.clipboard?.writeText((e.currentTarget as HTMLElement).dataset.copy!);
      toast("Address copied", "ok", 1800);
    });
    for (const b of sh.body.querySelectorAll<HTMLElement>("[data-p]")) b.addEventListener("click", () => page(b.dataset.p!));
  };
  const page = (p: string) => {
    if (p === "how") return howInto(sh, home);
    if (p === "security") return securityInto(sh, home);
    if (p === "proof") return proofInto(sh, home);
    if (p === "keys") {
      sh.show(`<div class="info"><h2>Your keys</h2><p class="lead">Both keys come from one recovery phrase stored in this browser. Clearing site data deletes them.</p>
        <dl class="rows stack glass"><div><dt>Everyday key</dt><dd>secp256k1 · signs ordinary transactions inside your scoped windows</dd></div><div><dt>Post-quantum key</dt><dd>ML-DSA-87 (NIST FIPS 204, level 5) · ${acc ? acc.pqc.publicKey.length.toLocaleString() : "2,592"}-byte public key · signs payouts and opens windows</dd></div><div><dt>Address</dt><dd><code>${acc ? esc(acc.evm) : "–"}</code></dd></div></dl>
        <p class="fine">Testnet only. Never use this wallet for anything real.</p></div>`, home);
      return;
    }
    if (p === "install") {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      sh.show(`<div class="info"><h2>Add Rosca to your home screen</h2>${installEvt ? `<p class="lead">Install Rosca as an app. It opens full screen, like any other app.</p><button class="btn-primary block" data-install>Install Rosca</button>` : ios ? `<p class="lead">In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>` : `<p class="lead">Open your browser's menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>`, home);
      sh.body.querySelector("[data-install]")?.addEventListener("click", () => void installEvt?.prompt());
      return;
    }
    if (p === "reset") {
      sh.show(`<div class="info"><h2>Reset this test wallet?</h2><p class="lead">The keys on this device are deleted and you start over with a fresh wallet. Your old circle and test money stay on chain, but you won't be able to use them.</p><button class="btn-primary block danger-btn" data-yes>Reset</button></div>`, home);
      sh.body.querySelector("[data-yes]")!.addEventListener("click", () => {
        localStorage.removeItem(KEY);
        location.reload();
      });
    }
  };
  home();
}

function howInto(sh: Sheet, back?: () => void) {
  sh.show(`<div class="info"><h2>How a round works</h2><figure class="how-fig"><div id="how-ring" style="--ring: min(300px, 74vw)"></div><figcaption id="how-cap"></figcaption><div class="flow-dots" id="how-dots"></div></figure>
    <dl class="rows stack glass"><div><dt>Pay</dt><dd>Everyone pays the share into a pot nobody holds.</dd></div><div><dt>Bid</dt><dd>Need money now? Bid a discount. The biggest wins.</dd></div><div><dt>Approve</dt><dd>A majority says yes to the payout.</dd></div><div><dt>Collect</dt><dd>The winner signs with ML-DSA-87; the chain checks it and pays.</dd></div><div><dt>Share</dt><dd>The discount goes back to every member.</dd></div></dl></div>`, back);
  const demo = mountFlowDemo(sh.body.querySelector("#how-ring")!, sh.body.querySelector("#how-cap")!, sh.body.querySelector("#how-dots")!);
  const obs = new MutationObserver(() => {
    if (!sh.body.querySelector("#how-ring")) {
      demo.stop();
      obs.disconnect();
    }
  });
  obs.observe(sh.body, { childList: true });
}

function howSheet() {
  const sh = openSheet("");
  howInto(sh);
}

function securityInto(sh: Sheet, back?: () => void) {
  const row = (ok: boolean, t: string, d: string) => `<div class="who-row"><span class="mark ${ok ? "y" : "n"}">${ok ? "✓" : "✕"}</span><div><b>${t}</b><p>${d}</p></div></div>`;
  const tried = Object.values(saved.thief);
  sh.show(`<div class="info"><h2>Who can move the pot?</h2><div class="who glass">
    ${row(false, "The organiser", "Opens the circle, nothing else. No owner, no admin, no withdraw function.")}
    ${row(false, "A thief with your phone key", "Can't make an ML-DSA-87 signature, and your windows only reach your circle and fUSD.")}
    ${row(false, "A future quantum computer", "Could break the everyday key. It can't forge ML-DSA-87.")}
    ${row(true, "The winner, with a majority", "Most members approve, and the winner signs this exact payout with ML-DSA-87.")}
    </div><p class="lead">${tried.length ? `You tried to steal a pot ${tried.length === 1 ? "once" : `${tried.length} times`}. ${tried.every((t) => t.status !== "success") ? "The chain refused every time." : ""}` : "When you win a round, the app lets you play the thief against your own pot."}</p></div>`, back);
}

function proofInto(sh: Sheet, back?: () => void) {
  const a = (href: string, t: string) => `<a href="${href}" target="_blank" rel="noopener">${t} ↗</a>`;
  sh.show(`<div class="info"><h2>Proof on chain</h2><dl class="rows glass">
    <div><dt>Factory</dt><dd>${a(`${NET.explorer}/address/${NET.factory}`, short(NET.factory))}</dd></div>
    ${saved.current ? `<div><dt>Your circle</dt><dd>${a(`${NET.explorer}/address/${saved.current}`, short(saved.current))}</dd></div>` : ""}
    <div><dt>pqcVerify check</dt><dd>${a("https://github.com/nikhil-pn/rosca/blob/main/src/libraries/PqcGate.sol", "PqcGate.sol")}</dd></div>
    <div><dt>Tests</dt><dd>${a("https://github.com/nikhil-pn/rosca/tree/main/test", "61 Foundry tests")}</dd></div>
    <div><dt>Live circle</dt><dd>${a(`${SITE}/live`, "rosca.exprmnts.fun/live")}</dd></div>
    <div><dt>Every claim</dt><dd>${a(`${SITE}/proof`, "rosca.exprmnts.fun/proof")}</dd></div>
    </dl></div>`, back);
}

function circlesSheet() {
  const sh = openSheet(`<div class="info"><h2>Your circles</h2>
    ${saved.circles.length ? `<nav class="menu glass">${saved.circles.map((c, i) => `<button data-c="${c}"><span class="mi">◎</span>Circle ${i + 1} <small>${short(c)}</small><i>${c === saved.current ? "✓" : "›"}</i></button>`).reverse().join("")}</nav>` : '<p class="lead">No circles yet.</p>'}
    <button class="btn-primary block" data-new>Start a new circle</button></div>`);
  for (const b of sh.body.querySelectorAll<HTMLElement>("[data-c]"))
    b.addEventListener("click", () => {
      saved.current = b.dataset.c as Address;
      save();
      prev = null;
      sh.close();
      void refresh();
    });
  sh.body.querySelector("[data-new]")!.addEventListener("click", () => {
    sh.close();
    startFlow();
  });
}

// ---------------------------------------------------------------- events and loop

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const act = t.closest<HTMLElement>("[data-act]");
  if (act) return actions[act.dataset.act!]?.();
  const bid = t.closest<HTMLElement>("[data-bid]");
  if (bid) {
    bidVal = Math.min(bidMax(), Math.max(bidFloor(), bidVal + Number(bid.dataset.bid) * bidStep()));
    showBid();
    return;
  }
  const go = t.closest<HTMLElement>("[data-tab],[data-tab-go]");
  if (go && acc) {
    tab = (go.dataset.tab ?? go.dataset.tabGo) as typeof tab;
    renderShell();
    draw();
  }
});
$("profile-btn").addEventListener("click", () => profileSheet());
$("circle-pill").addEventListener("click", () => (acc ? circlesSheet() : setupFlow()));
$("dock-plus").addEventListener("click", () => (acc ? startFlow() : setupFlow()));

function tickTimers() {
  for (const el of document.querySelectorAll<HTMLElement>(".timer[data-end]")) {
    el.textContent = left(Number(el.dataset.end) - Math.floor(Date.now() / 1000));
  }
}

let busy: Promise<void> | null = null;
let again = false;
async function refresh(): Promise<void> {
  if (busy) {
    again = true;
    return busy;
  }
  busy = (async () => {
    do {
      again = false;
      try {
        const s = await load();
        prev = snap;
        snap = s;
        draw();
      } catch (e) {
        console.error("Rosca:", e);
      }
    } while (again);
  })();
  await busy;
  busy = null;
}

async function boot() {
  if (saved.mnemonic) {
    acc = await deriveUnifiedAccount(saved.mnemonic, 0);
    PEOPLE[acc.evm.toLowerCase()] = "You";
    renderShell();
  }
  draw();
  await refresh();
  setInterval(() => void refresh(), 4000);
  setInterval(tickTimers, 1000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
}

void boot();
