// The live feed: the circle's on-chain events from the last few hours, newest first,
// plus the keeper's thief attempts (which revert, so they leave no event).
import { CONFIG, who } from "./config.js";
import * as chain from "./chain.js";

const T = {
  "0x4f2d18324ee95128de091ed2adc501295479000ce4c2cec607aeb1b67e189e2f": "Paid",
  "0xdcd726e11f8b5e160f00290f0fe3a1abb547474e53a8e7a8f49a85e7b1ca3199": "Bid",
  "0xdb05479599b7e9faa4da19f390edf6e7df6096ed28b928bd6f972502874be2be": "AuctionClosed",
  "0x901993f3f5690f3be85c229ae30c2f32ca22013f73895b4e49a36a6a7d8178ca": "Approved",
  "0xb37499c950fc82cf35be1dfd627b9959d5947d39f31ceab33075b6864c2f2cc9": "Released",
  "0x49f8fa5eee2e3f21251c2e968640dcaef35cb9332429eb059bb3cd56ddc2533d": "Joined",
  "0xb9574e0faab8124549420ceb05e8203d89eacae04d747d51d12d373b600dbe9b": "RoundStarted",
  "0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5": "Withdrawn",
  "0xe06452d00b2b58f14a1fa6d499ea982ff93ea827ae700ea9ba03f4daddc94bc1": "Completed",
  "0xb9ba45ed005294d9680d6aa80c4a28a55e4ee0c83390fe4ff0d85107c7e9c7a2": "CircleOpened",
  "0xb0b5529c15667824a2fcfcee58a625d399fb6706d3a784d22a9a66e47982dd8a": "Dissolved",
  "0xa33cb4ea37c263e77c2018c568979cb11458f03440d1a0edd53aadee26444211": "SecurityApplied",
};

const w = (hex, i) => BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
const topicAddr = (t) => "0x" + t.slice(26);
const topicNum = (t) => Number(BigInt(t));
export const usd = (units) =>
  "$" + (Number(units) / 10 ** CONFIG.fusdDecimals).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One readable line for one event: icon, text, sub-line. */
function describe(name, log, names, quorum) {
  const t = log.topics;
  const d = log.data;
  const circle = names[log.address.toLowerCase()] ?? "circle";
  const rd = (n) => `Round ${n} · ${circle}`;
  switch (name) {
    case "Paid": return ["↓", "", `${who(topicAddr(t[2]))} paid ${usd(w(d, 0))}`, rd(topicNum(t[1]))];
    case "Bid": return ["%", "", `${who(topicAddr(t[2]))} bid a ${usd(w(d, 0))} discount`, rd(topicNum(t[1]))];
    case "AuctionClosed": return ["◆", "", `Auction closed: ${who(topicAddr(t[2]))} wins the ${usd(w(d, 1))} pot`, `${usd(w(d, 0))} discount · ${rd(topicNum(t[1]))}`];
    case "Approved": return ["✓", "", `${who(topicAddr(t[2]))} approved the payout`, `${Number(w(d, 0))} of ${quorum} needed · ${rd(topicNum(t[1]))}`];
    case "Released": return ["↗", "release", `${who(topicAddr(t[2]))}'s ML-DSA-87 signature verified: ${usd(w(d, 1))} paid out`, `${usd(w(d, 2) - w(d, 3))} shared with members, ${usd(w(d, 4))} held as security · ${rd(topicNum(t[1]))}`];
    case "Joined": return ["+", "", `${who(topicAddr(t[1]))} joined`, circle];
    case "RoundStarted": return ["○", "", `Round ${topicNum(t[1])} started`, circle];
    case "Withdrawn": return ["←", "", `${who(topicAddr(t[1]))} withdrew ${usd(w(d, 0))}`, circle];
    case "Completed": return ["★", "release", "Circle complete: every member took the pot once", circle];
    case "CircleOpened": return ["◎", "", `The organiser opened ${circle}`, `${usd(w(d, 0))} a round`];
    case "Dissolved": return ["!", "fail", "Circle dissolved, members refunded", circle];
    case "SecurityApplied": return ["⛨", "", `${who(topicAddr(t[2]))}'s share covered from their security`, rd(topicNum(t[1]))];
    default: return null;
  }
}

function ago(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const seenBy = new Map();

/** Render the feed for `circles` ({address, name}[]) plus `attacks` from the deployments record,
 * into the list `target`, at most `limit` lines. */
export async function renderFeed(circles, attacks, quorum, target = "feed", limit = 40) {
  if (!seenBy.has(target)) seenBy.set(target, { seen: new Set(), first: true });
  const mem = seenBy.get(target);
  const wanted = new Set(circles.map((c) => c.address.toLowerCase()));
  attacks = attacks.filter((a) => wanted.has(a.circle.toLowerCase()));
  const names = Object.fromEntries(circles.map((c) => [c.address.toLowerCase(), c.name]));
  const logs = await chain.recentLogs(circles.map((c) => c.address));
  const items = [];
  for (const log of logs) {
    const name = T[log.topics[0]];
    const line = name && describe(name, log, names, quorum);
    if (line) items.push({ key: log.transactionHash + log.logIndex, block: Number(BigInt(log.blockNumber)), idx: Number(BigInt(log.logIndex)), tx: log.transactionHash, line });
  }
  items.sort((a, b) => b.block - a.block || b.idx - a.idx);
  const top = items.slice(0, limit);
  const withTime = await Promise.all(top.map(async (it) => ({ ...it, ts: await chain.blockTime(it.block) })));
  for (const a of attacks) {
    const ts = Math.floor(new Date(a.at).getTime() / 1000);
    withTime.push({
      key: a.tx, ts, tx: a.tx,
      line: ["✕", "fail", `A thief with a stolen key tried to take the pot: reverted`, `${a.kind === "forged" ? "Forged ML-DSA-87 signature" : "Replayed the winner's signature"} · ${names[a.circle.toLowerCase()] ?? "circle"}`],
    });
  }
  withTime.sort((a, b) => b.ts - a.ts);

  const ul = document.getElementById(target);
  if (!ul) return; // the list was removed while the chain was being read (e.g. the user changed tab)
  if (!withTime.length) {
    ul.innerHTML = '<li class="empty">No transactions in the last few hours yet.</li>';
    return;
  }
  ul.replaceChildren(
    ...withTime.slice(0, limit).map((it) => {
      const [icon, kind, text, sub] = it.line;
      const li = document.createElement("li");
      if (!mem.first && !mem.seen.has(it.key)) li.className = "fresh";
      mem.seen.add(it.key);
      const ic = document.createElement("span");
      ic.className = "ic " + kind;
      ic.textContent = icon;
      const what = document.createElement("span");
      what.className = "what";
      what.textContent = text;
      const small = document.createElement("small");
      small.textContent = sub;
      what.append(small);
      const a = document.createElement("a");
      a.className = "when";
      a.href = `${CONFIG.explorer}/tx/${it.tx}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = ago(it.ts) + " ↗";
      li.append(ic, what, a);
      return li;
    }),
  );
  mem.first = false;
}
