// Fills the phone with live data from the QoreChain testnet.
import { CONFIG } from "./config.js";
import * as chain from "./chain.js";

const $ = (id) => document.getElementById(id);
const PHASES = ["Forming", "Running", "Completed", "Dissolved"];
const ICONS = ["◎", "★", "▦"];

/** "$1,234.56" with the decimals in grey. */
function money(units) {
  const v = Number(units) / 10 ** CONFIG.fusdDecimals;
  const [whole, dec] = v
    .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .split(".");
  return `$${whole}<span class="dec">.${dec}</span>`;
}

function chipFor(c, i) {
  const b = document.createElement("button");
  b.className = "chip" + (c.address === state.selected ? " active" : "");
  const icon = document.createElement("span");
  icon.className = "chip-icon";
  icon.textContent = ICONS[i % ICONS.length];
  b.append(icon, document.createTextNode(c.name));
  b.addEventListener("click", () => {
    state.selected = c.address;
    renderChips();
    refresh();
  });
  return b;
}

const state = { list: [], selected: null };

function renderChips() {
  if (!state.list.length) return;
  $("circle-chips").replaceChildren(...state.list.map(chipFor));
}

async function refresh() {
  const c = state.list.find((x) => x.address === state.selected);
  if (!c) return;
  const info = await chain.circleInfo(c.address);
  const rounds = await Promise.all(
    Array.from({ length: Math.max(info.currentRound, 0) }, (_, i) => chain.round(c.address, i + 1)),
  );
  const saved = rounds.reduce((s, r) => s + r.collected, 0n);
  const shared = rounds.filter((r) => r.released).reduce((s, r) => s + r.discount, 0n);
  $("balance").innerHTML = money(saved);
  $("gain").textContent = saved > 0n ? `+${((Number(shared) / Number(saved)) * 100).toFixed(2)}%` : "+0.00%";
  $("card-kind").textContent = PHASES[info.phase];

  const now = rounds[info.currentRound - 1];
  const memberList = await chain.members(c.address);
  const paidFlags = info.currentRound
    ? await Promise.all(memberList.map((m) => chain.hasPaid(c.address, info.currentRound, m)))
    : [];
  const paid = paidFlags.filter(Boolean).length;
  const pct = info.size ? Math.round((paid / info.size) * 100) : 0;

  $("round-title").textContent = info.currentRound ? `Round ${info.currentRound} of ${info.size}` : "Forming";
  $("pot").innerHTML = money(now ? now.collected : 0n);
  $("paid-tag").textContent = `${paid} of ${info.size}`;
  $("paid-bar").style.width = `${pct}%`;
  $("paid-knob").style.left = `${pct}%`;
  $("share").innerHTML = money(info.share);
  $("round-tag").textContent = PHASES[info.phase].toLowerCase();
  $("ticks").replaceChildren(
    ...Array.from({ length: info.size }, (_, i) => {
      const t = document.createElement("span");
      if (rounds[i]?.released) t.className = "done";
      return t;
    }),
  );
}

async function start() {
  try {
    const addrs = await chain.circles();
    state.list = (await Promise.all(addrs.map((a) => chain.circleInfo(a)))).reverse();
    state.selected = state.list[0]?.address ?? null;
    renderChips();
    await refresh();
    setInterval(() => refresh().catch(console.error), 15000);
  } catch (e) {
    console.error("Rosca: could not read the testnet", e);
  }
}

start();
