// The story column: live stats, which step the live circle is on, the countdown and the thief attempts.
import { CONFIG } from "./config.js";
import * as chain from "./chain.js";
import { usd } from "./feed.js";

// Each page has only some of these elements; writes to missing ones go nowhere.
const NULL_EL = new Proxy({ style: {} }, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
const $ = (id) => document.getElementById(id) ?? NULL_EL;

/** Totals over every circle the factory has opened. */
export function renderStats(infos, attacks) {
  let rounds = 0;
  let volume = 0n;
  for (const c of infos) {
    const done = c.phase === 2 ? c.size : Math.max(c.currentRound - 1, 0);
    rounds += done;
    volume += BigInt(done) * c.share * BigInt(c.size);
  }
  $("st-circles").textContent = String(infos.length);
  $("st-rounds").textContent = String(rounds);
  $("st-volume").textContent = usd(volume).replace(/\.\d\d$/, "");
  $("st-attacks").textContent = String(attacks.filter((a) => a.status !== "success").length);
}

/** Which of the five steps the circle is on now, or null when it is not running. */
export function stepOf(info, round, paidCount, quorum) {
  if (info.phase !== 1 || !round) return null;
  const now = Date.now() / 1000;
  if (!round.closed) {
    if (now > round.bidEnd) return "close";
    return paidCount < info.size ? "pay" : "bid";
  }
  if (!round.released) return round.approvals < quorum ? "approve" : "release";
  return "pay";
}

export function highlightStep(step) {
  for (const li of document.querySelectorAll("#steps li")) li.classList.toggle("now", li.dataset.step === step);
}

let timer;
/** "Round 2 of 5 · Office kuri #1" and a live countdown to the end of bidding. */
export function renderHeader(info, round) {
  $("feed-circle").textContent = info.currentRound ? `Round ${info.currentRound} of ${info.size} · ${info.name}` : info.name;
  clearInterval(timer);
  const tick = () => {
    const el = $("feed-timer");
    if (info.phase === 2) return (el.textContent = "Complete");
    if (!round || round.closed) return (el.textContent = round?.released ? "" : "Payout in progress");
    const left = Math.round(round.bidEnd - Date.now() / 1000);
    if (left <= 0) return (el.textContent = "Bidding closed");
    const m = Math.floor(left / 60);
    const s = String(left % 60).padStart(2, "0");
    el.textContent = `Bidding closes in ${m}:${s}`;
  };
  tick();
  timer = setInterval(tick, 1000);
}

const ATTACK = {
  forged: "Payout with a forged signature",
  replayed: "Payout with the winner's signature, replayed",
  "fusd-transfer": "fUSD transfer of the payout to the thief",
  "classical-send": "Native send with the classical key only",
};

/** The keeper's thief attempts. Release attempts land on chain and revert; drain attempts are refused by
 * the chain before they reach a block, so they show the chain's own refusal instead of a transaction. */
export async function renderAttempts(attacks, names) {
  if (!attacks.length || !document.getElementById("attempts")) return;
  const rows = await Promise.all(
    attacks.slice(-8).reverse().map(async (a) => {
      const status = a.tx ? await chain.receiptStatus(a.tx).catch(() => a.status) : a.status;
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${ATTACK[a.kind] ?? a.kind} · round ${a.round} · ${names[a.circle.toLowerCase()] ?? "circle"} · `;
      const res = document.createElement("span");
      res.className = status === "success" ? "" : "bad";
      res.textContent = status === "success" ? "went through" : status === "refused" ? "refused by the chain" : "reverted";
      label.append(res);
      if (a.tx) {
        const link = document.createElement("a");
        link.href = `https://rosca.exprmnts.fun/tx/${a.tx}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "on chain ↗";
        li.append(label, link);
      } else {
        const why = document.createElement("small");
        why.className = "why";
        why.textContent = a.reason ? `“${a.reason.replace(/^failed to broadcast transaction: /, "").slice(0, 160)}…”` : "";
        label.append(document.createElement("br"), why);
        li.append(label);
      }
      return li;
    }),
  );
  $("attempts").replaceChildren(...rows);
}

/** The deployments record on GitHub (lists the thief attempts). Empty if unreachable. */
export async function deployments() {
  try {
    const res = await fetch(CONFIG.deployments, { cache: "no-store" });
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}
