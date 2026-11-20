/**
 * "Try it yourself": a visitor runs a real round of Rosca on the QoreChain testnet from this page.
 * Every step reads its state back from the chain, so a reload picks up where the visitor left off.
 */
import { deriveUnifiedAccount, generateMnemonic, type UnifiedAccount } from "@qorechain/sdk";
import type { Address } from "viem";
import { NET } from "../lib/qore.ts";
import * as A from "./actions.ts";
// The main page's own modules, so the phone looks and behaves the same.
import { PEOPLE } from "../../web/js/config.js";
import { renderFeed, usd } from "../../web/js/feed.js";
import { initTabs, renderPeople } from "../../web/js/tabs.js";

// ---------------------------------------------------------------- saved state (this browser only)

interface Saved {
  mnemonic?: string;
  circle?: Address;
  tx: Record<string, string>;
  thief?: { tx: string; status: string };
  sig?: number;
}
const KEY = "rosca.try.v1";
const saved: Saved = JSON.parse(localStorage.getItem(KEY) ?? "null") ?? { tx: {} };
const save = () => localStorage.setItem(KEY, JSON.stringify(saved));

let acc: UnifiedAccount | null = null;
const busy = new Set<string>();
const $ = (id: string) => document.getElementById(id)!;
const step = (k: string) => document.querySelector<HTMLLIElement>(`#trysteps li[data-step="${k}"]`)!;
const ZERO = "0x0000000000000000000000000000000000000000";

const txLink = (hash: string, label = "transaction") => {
  const evm = hash.startsWith("0x");
  return `<a href="${NET.explorer}/tx/${evm ? hash : hash.toUpperCase()}" target="_blank" rel="noopener">${label} ↗</a>`;
};

// ---------------------------------------------------------------- what the chain says now

interface Snap {
  qor: bigint;
  fusd: bigint;
  key: boolean;
  member: boolean;
  members: Address[];
  phase: number;
  round: number;
  r1?: A.RoundView;
  now?: A.RoundView;
  paidNow: boolean;
  paidAll: boolean[];
  approvedR1: boolean;
  needed: number;
  owed: bigint;
}
let snap: Snap | null = null;

async function load(): Promise<Snap | null> {
  if (!acc) return null;
  const me = acc.evm as Address;
  const [qor, fusd, key] = await Promise.all([A.qorBalance(me), A.fusdBalance(me), A.pqcRegistered(acc).catch(() => false)]);
  const s: Snap = { qor, fusd, key, member: false, members: [], phase: -1, round: 0, paidNow: false, paidAll: [], approvedR1: false, needed: 2, owed: 0n };
  if (!saved.circle) return s;
  const c = saved.circle;
  const [members, phase, round, needed] = await Promise.all([
    A.read<Address[]>(c, "members"),
    A.read<number>(c, "phase"),
    A.read<bigint>(c, "currentRound"),
    A.read<number>(c, "quorumNeeded"),
  ]);
  Object.assign(s, { members, phase, round: Number(round), needed });
  s.member = members.some((m) => m.toLowerCase() === me.toLowerCase());
  if (s.round >= 1) {
    const [r1, now, approvedR1, paidAll] = await Promise.all([
      A.read<A.RoundView>(c, "getRound", [1n]),
      A.read<A.RoundView>(c, "getRound", [round]),
      A.read<boolean>(c, "approved", [1n, me]),
      Promise.all(members.map((m) => A.read<boolean>(c, "paid", [round, m]))),
    ]);
    Object.assign(s, { r1, now, approvedR1, paidAll });
    s.paidNow = paidAll[members.findIndex((m) => m.toLowerCase() === me.toLowerCase())] ?? false;
  }
  if (phase >= 2) s.owed = await A.read<bigint>(c, "withdrawable", [me]);
  return s;
}

// ---------------------------------------------------------------- drawing the steps

function setState(k: string, state: "locked" | "ready" | "done") {
  const li = step(k);
  li.classList.remove("locked", "ready", "done");
  li.classList.add(state);
}

function setAct(k: string, html: string) {
  const act = step(k).querySelector<HTMLDivElement>(".act")!;
  if (busy.has(k)) return; // keep the spinner while an action runs
  if (act.dataset.html !== html) {
    act.innerHTML = html;
    act.dataset.html = html;
  }
}

function setOut(k: string, html: string) {
  const out = step(k).querySelector<HTMLDivElement>(".out")!;
  if (busy.has(k)) return;
  if (out.dataset.html !== html) {
    out.innerHTML = html;
    out.dataset.html = html;
  }
}

const btn = (k: string, label: string, extra = "") => `<button class="btn dark" data-do="${k}" ${extra}>${label}</button>`;
const timerSpan = (end: bigint) => `<span class="timer" data-end="${end}"></span>`;

function draw() {
  const s = snap;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const r1 = s?.r1;
  const quorum = r1 ? r1.approvals >= (s?.needed ?? 2) : false;

  // 1. wallet
  if (!acc) {
    setState("wallet", "ready");
    setAct("wallet", btn("wallet", "Create my test wallet"));
    setOut("wallet", "");
  } else {
    setState("wallet", "done");
    setOut("wallet", `Your address <code>${acc.evm}</code><br>ML-DSA-87 public key: ${acc.pqc.publicKey.length.toLocaleString()} bytes, made in this browser.`);
  }
  if (!acc || !s) {
    for (const k of ["money", "key", "circle", "pay", "approve", "thief", "release", "rest"]) setState(k, "locked");
    return;
  }

  // 2. money
  const haveMoney = s.qor > 0n;
  setState("money", haveMoney ? "done" : "ready");
  setAct("money", btn("money", "Get 2 QOR + 40 fUSD"));
  setOut("money", haveMoney ? `You have ${(Number(s.qor) / 1e18).toFixed(2)} test QOR and ${usd(s.fusd)} fUSD.${saved.tx.money ? " " + txLink(saved.tx.money) : ""}` : "");

  // 3. post-quantum key
  setState("key", !haveMoney ? "locked" : s.key ? "done" : "ready");
  setAct("key", btn("key", "Register my ML-DSA-87 key"));
  setOut("key", s.key ? `Registered with proof of possession.${saved.tx.key ? " " + txLink(saved.tx.key) : ""}` : "");

  // 4. circle
  const running = s.phase >= 1;
  setState("circle", !s.key ? "locked" : running ? "done" : "ready");
  if (s.member && s.phase === 0) {
    setAct("circle", "");
    setOut("circle", `You're in. Waiting for the two bots to join (${s.members.length} of 3)…`);
  } else {
    setAct("circle", btn("circle", "Open a 3-person circle"));
    setOut("circle", saved.circle && s.member ? `Your circle <a href="${NET.explorer}/address/${saved.circle}" target="_blank" rel="noopener">${saved.circle.slice(0, 10)}… ↗</a> · all three joined, round 1 has started.` : "");
  }

  // 5. pay round 1 (and bid)
  const biddingOpen = r1 && !r1.closed && nowSec <= r1.bidEnd;
  const paid1 = s.round === 1 ? s.paidNow : Boolean(r1 && r1.closed);
  setState("pay", !running || !r1 ? "locked" : r1.closed || nowSec > r1.bidEnd ? "done" : "ready");
  if (r1 && biddingOpen) {
    setAct(
      "pay",
      paid1
        ? `<input type="number" id="bid-amount" min="0.5" max="9" step="0.5" value="2" aria-label="Discount in fUSD">${btn("bid", "Bid this discount")} ${timerSpan(r1.bidEnd)}`
        : `${btn("pay", "Pay $10")} ${timerSpan(r1.bidEnd)}`,
    );
  }
  const bidLine = r1 && r1.bestBidder !== ZERO ? ` Best bid: ${usd(r1.bestDiscount)} discount.` : "";
  setOut("pay", r1 ? `${paid1 ? "You paid $10." : "Not paid yet."}${saved.tx.pay ? " " + txLink(saved.tx.pay) : ""}${bidLine}${saved.tx.bid ? " " + txLink(saved.tx.bid, "your bid") : ""}` : "");

  // 6. close and approve
  const afterBid = r1 && (r1.closed || nowSec > r1.bidEnd);
  setState("approve", !afterBid ? "locked" : quorum ? "done" : "ready");
  if (r1 && afterBid && !r1.closed) {
    setAct("approve", btn("approve", "Close the auction"));
    setOut("approve", "Bidding is over. Close it yourself, or a bot does it in a few seconds.");
  } else if (r1 && r1.closed && !quorum) {
    setAct("approve", s.approvedR1 ? "" : btn("approve", "Approve the payout"));
    setOut("approve", `Auction closed: <b>${PEOPLE[r1.winner.toLowerCase()] ?? r1.winner}</b> wins ${usd(r1.collected)} at a ${usd(r1.discount)} discount. Approvals: ${r1.approvals} of ${s.needed}.`);
  } else if (r1 && quorum) {
    setOut("approve", `Approved by ${r1.approvals} of 3 members.${s.approvedR1 ? " One of them is you." : ""}${saved.tx.approve ? " " + txLink(saved.tx.approve) : ""}`);
  }

  // 7. thief
  const thiefReady = Boolean(r1 && r1.closed && quorum && !r1.released);
  setState("thief", saved.thief || r1?.released ? "done" : thiefReady ? "ready" : "locked");
  setAct("thief", btn("thief", "Send the pot to a stranger"));
  if (saved.thief) {
    const failed = saved.thief.status !== "success";
    setOut("thief", `${failed ? '<span class="ok">Refused on chain.</span> The signature you made names you as the recipient, so <code>pqcVerify</code> fails for anyone else.' : '<span class="bad">It went through.</span>'} ${txLink(saved.thief.tx, "the failed transaction")}`);
  } else if (r1?.released) setOut("thief", "Skipped.");

  // 8. release
  const iWon = r1 && r1.winner.toLowerCase() === acc.evm.toLowerCase();
  setState("release", r1?.released ? "done" : thiefReady && iWon ? "ready" : "locked");
  setAct("release", btn("release", "Sign with ML-DSA-87 and release"));
  if (r1?.released) {
    setOut("release", `<span class="ok">pqcVerify passed.</span> ${saved.sig ? `Your ${saved.sig.toLocaleString()}-byte ML-DSA-87 signature was checked on chain. ` : ""}The pot was paid out, part held back as security for your next shares.${saved.tx.release ? " " + txLink(saved.tx.release) : ""}`);
  }

  // 9. the rest of the circle
  const done = s.phase >= 2;
  setState("rest", !r1?.released ? "locked" : done && s.owed === 0n ? "done" : "ready");
  if (done) {
    setAct("rest", s.owed > 0n ? btn("withdraw", `Withdraw ${usd(s.owed)}`) : "");
    setOut("rest", s.owed > 0n ? "The circle is complete. Your security and your share of the discounts are waiting." : `Circle complete. You have ${usd(s.fusd)} fUSD.${saved.tx.withdraw ? " " + txLink(saved.tx.withdraw) : ""}`);
  } else if (s.round >= 2 && s.now) {
    const open = !s.now.closed && nowSec <= s.now.bidEnd;
    setAct("rest", open && !s.paidNow ? `${btn("pay2", `Pay round ${s.round}`)} ${timerSpan(s.now.bidEnd)}` : "");
    setOut("rest", `Round ${s.round} of 3: ${s.paidAll.filter(Boolean).length} of 3 paid${s.now.closed ? `, won by ${PEOPLE[s.now.winner.toLowerCase()] ?? "a bot"}` : ""}.${open ? "" : " The bots are finishing it."}`);
  }
}

// ---------------------------------------------------------------- the phone

function drawPhone() {
  const s = snap;
  document.querySelector(".balance .label")!.textContent = "Your test fUSD";
  document.querySelector(".top-bar .avatar")!.textContent = "You";
  if (!s || !acc) {
    $("balance").innerHTML = '$0<span class="dec">.00</span>';
    $("gain").textContent = "no wallet yet";
    $("card-kind").textContent = "Try";
    $("circle-chips").innerHTML = '<button class="chip active"><span class="chip-icon">◎</span>No circle yet</button>';
    return;
  }
  const money = (v: bigint) => {
    const [w, d] = usd(v).slice(1).split(".");
    return `$${w}<span class="dec">.${d}</span>`;
  };
  $("balance").innerHTML = money(s.fusd);
  $("gain").textContent = `${(Number(s.qor) / 1e18).toFixed(2)} QOR`;
  $("card-kind").textContent = ["Forming", "Running", "Completed", "Dissolved"][s.phase] ?? "No circle";
  $("circle-chips").innerHTML = `<button class="chip active"><span class="chip-icon">◎</span>${saved.circle ? "Your circle" : "No circle yet"}</button>`;
  const r = s.now;
  const paid = s.paidAll.filter(Boolean).length;
  $("round-title").textContent = s.round ? `Round ${s.round} of 3` : saved.circle ? "Forming" : "This round";
  $("pot").innerHTML = money(r ? r.collected : 0n);
  $("paid-tag").textContent = `${paid} of 3`;
  $("paid-bar").style.width = `${(paid / 3) * 100}%`;
  $("paid-knob").style.left = `${(paid / 3) * 100}%`;
  $("share").innerHTML = money(10n * 10n ** 6n);
  $("round-tag").textContent = r?.released ? "paid out" : r?.closed ? "closed" : s.round ? "bidding" : "—";
  $("device-note").textContent = `Your circle on QoreChain testnet · updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

let tab = "wallet";
async function drawTab() {
  if (!saved.circle || !snap) return;
  if (tab === "members") {
    const won = await Promise.all(snap.members.map((m) => A.read<boolean>(saved.circle!, "hasWon", [m])));
    renderPeople(snap.members.map((m, i) => ({ name: PEOPLE[m.toLowerCase()] ?? m.slice(0, 8), paid: snap!.paidAll[i] ?? false, won: won[i] })));
  }
  if (tab === "activity") {
    const thief = saved.thief ? [{ circle: saved.circle, round: 1, kind: "replayed", tx: saved.thief.tx, status: saved.thief.status, at: new Date().toISOString() }] : [];
    await renderFeed([{ address: saved.circle, name: "your circle" }], thief, snap.needed, "phone-feed", 14);
  }
}

// ---------------------------------------------------------------- actions

function say(k: string, html: string) {
  const out = step(k).querySelector<HTMLDivElement>(".out")!;
  out.innerHTML += `<span class="line">${html}</span>`;
}

async function run(k: string, button: HTMLButtonElement, fn: () => Promise<void>) {
  if (busy.has(k)) return;
  busy.add(k);
  button.classList.add("busy");
  for (const b of step(k).querySelectorAll("button")) b.disabled = true;
  const out = step(k).querySelector<HTMLDivElement>(".out")!;
  out.innerHTML = "";
  out.dataset.html = "";
  try {
    await fn();
  } catch (e) {
    say(k, `<span class="err">${(e instanceof Error ? e.message : String(e)).replace(/</g, "&lt;").slice(0, 300)}</span>`);
    busy.delete(k);
    button.classList.remove("busy");
    for (const b of step(k).querySelectorAll("button")) b.disabled = false;
    return;
  }
  busy.delete(k);
  const act = step(k).querySelector<HTMLDivElement>(".act")!;
  act.dataset.html = "";
  step(k).querySelector<HTMLDivElement>(".out")!.dataset.html = "";
  await refresh();
}

const handlers: Record<string, (k: string) => Promise<void>> = {
  async wallet() {
    saved.mnemonic = generateMnemonic();
    save();
    await useWallet();
  },
  async money(k) {
    say(k, "Asking Rosca's faucet…");
    saved.tx.money = await A.faucet(acc!);
    save();
  },
  async key(k) {
    say(k, "Signing a proof of possession with your ML-DSA-87 key and registering it…");
    saved.tx.key = await A.registerKey(acc!);
    save();
  },
  async circle(k) {
    say(k, "Opening a window scoped to the Rosca factory, signed with both of your keys…");
    await A.ensureWindow(acc!, [NET.factory]);
    say(k, "Creating your circle: 3 members, $10 a round, 2-minute rounds…");
    const made = await A.createCircle(acc!, `Try · ${acc!.evm.slice(2, 8)}`);
    saved.circle = made.address;
    saved.tx.circle = made.tx;
    save();
    say(k, `Circle created ${txLink(made.tx)}. Opening a window scoped to only your circle and fUSD, then joining…`);
    saved.tx.join = await A.join(acc!, made.address);
    save();
  },
  async pay(k) {
    say(k, "Paying $10 into round 1…");
    saved.tx.pay = await A.pay(acc!, saved.circle!);
    save();
  },
  async bid(k) {
    const v = Number((document.getElementById("bid-amount") as HTMLInputElement | null)?.value ?? 2);
    say(k, `Bidding a $${v.toFixed(2)} discount…`);
    saved.tx.bid = await A.bid(acc!, saved.circle!, [BigInt(Math.round(v * 1e6))]);
    save();
  },
  async approve(k) {
    if (snap?.r1 && !snap.r1.closed) {
      say(k, "Closing the auction…");
      saved.tx.close = await A.closeAuction(acc!, saved.circle!);
    } else {
      say(k, "Approving the payout…");
      saved.tx.approve = await A.approve(acc!, saved.circle!);
    }
    save();
  },
  async thief(k) {
    say(k, "Signing the payout to yourself, then sending it with a stranger as the recipient…");
    const res = await A.steal(acc!, saved.circle!);
    saved.thief = { tx: res.tx, status: res.status };
    save();
  },
  async release(k) {
    say(k, "Signing the payout with ML-DSA-87 in your browser and sending it…");
    const res = await A.release(acc!, saved.circle!);
    saved.tx.release = res.tx;
    saved.sig = res.sigBytes;
    save();
  },
  async pay2(k) {
    say(k, `Paying round ${snap?.round}…`);
    saved.tx[`pay${snap?.round}`] = await A.pay(acc!, saved.circle!);
    save();
  },
  async withdraw(k) {
    say(k, "Withdrawing your security and your share of the discounts…");
    saved.tx.withdraw = await A.withdraw(acc!, saved.circle!);
    save();
  },
};

document.getElementById("trysteps")!.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-do]");
  if (!b || b.disabled) return;
  const k = b.closest<HTMLLIElement>("li[data-step]")!.dataset.step!;
  const what = b.dataset.do!;
  void run(k, b, () => handlers[what](k));
});

$("reset").addEventListener("click", () => {
  if (!confirm("Forget this test wallet? Its test money and circle stay on chain, but this page will start over.")) return;
  localStorage.removeItem(KEY);
  location.reload();
});

// ---------------------------------------------------------------- loop

async function useWallet() {
  acc = await deriveUnifiedAccount(saved.mnemonic!, 0);
  PEOPLE[acc.evm.toLowerCase()] = "You";
  await refresh();
}

let refreshing: Promise<void> | null = null;
let again = false;
/** Read the chain and redraw. A call made while one is running queues exactly one more pass. */
async function refresh(): Promise<void> {
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = (async () => {
    do {
      again = false;
      try {
        snap = await load();
        draw();
        drawPhone();
        await drawTab();
      } catch (e) {
        console.error("Rosca try:", e);
      }
    } while (again);
  })();
  await refreshing;
  refreshing = null;
}

function tickTimers() {
  for (const el of document.querySelectorAll<HTMLSpanElement>(".timer[data-end]")) {
    const left = Number(el.dataset.end) - Math.floor(Date.now() / 1000);
    el.textContent = left > 0 ? `bidding closes in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "bidding closed";
  }
}

initTabs((t: string) => {
  tab = t;
  void drawTab();
});
draw();
drawPhone();
if (saved.mnemonic) void useWallet();
setInterval(() => void refresh(), 4000);
setInterval(tickTimers, 1000);
