// Fills the phone and the story with live data from the QoreChain testnet.
import { CONFIG, who } from "./config.js";
import * as chain from "./chain.js";
import { renderFeed } from "./feed.js";
import * as story from "./story.js";
import { initTabs, renderPeople } from "./tabs.js";

const $ = (id) => document.getElementById(id) ?? NULL_EL;
// Each page has only some of the live pieces; writes to missing ones go nowhere.
const NULL_EL = new Proxy({ style: {} }, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
const has = (id) => Boolean(document.getElementById(id));
const PHASES = ["Forming", "Running", "Completed", "Dissolved"];
const ICONS = ["◎", "★", "▦"];
const CHIPS = 3;

/** "$1,234.56" with the decimals in grey. */
function money(units) {
  const v = Number(units) / 10 ** CONFIG.fusdDecimals;
  const [whole, dec] = v
    .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .split(".");
  return `$${whole}<span class="dec">.${dec}</span>`;
}

const state = { list: [], all: [], selected: null, attacks: [], tab: "wallet" };

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
    refreshPhone().catch(console.error);
  });
  return b;
}

function renderChips() {
  if (!state.list.length || !has("circle-chips")) return;
  $("circle-chips").replaceChildren(...state.list.slice(0, CHIPS).map(chipFor));
}

/** Everything the page shows about one circle. */
async function snapshot(address) {
  const info = await chain.circleInfo(address);
  const rounds = await Promise.all(
    Array.from({ length: Math.max(info.currentRound, 0) }, (_, i) => chain.round(address, i + 1)),
  );
  const memberList = await chain.members(address);
  const paidFlags = info.currentRound
    ? await Promise.all(memberList.map((m) => chain.hasPaid(address, info.currentRound, m)))
    : [];
  return { info, rounds, memberList, paid: paidFlags.filter(Boolean).length, paidFlags };
}

function markLive() {
  if (!has("device-note")) return;
  $("device-note").textContent = `Live on QoreChain testnet · updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

async function refreshPhone() {
  if (!has("balance")) return;
  const c = state.list.find((x) => x.address === state.selected);
  if (!c) return;
  const { info, rounds, paid, memberList, paidFlags } = await snapshot(c.address);
  if (state.tab === "members") {
    const won = await Promise.all(memberList.map((m) => chain.hasWon(c.address, m)));
    renderPeople(memberList.map((m, i) => ({ name: who(m), paid: paidFlags[i], won: won[i] })));
  }
  if (state.tab === "activity") {
    const quorum = await chain.quorumNeeded(c.address);
    await renderFeed([c], state.attacks, quorum, "phone-feed", 12);
  }
  const saved = rounds.reduce((s, r) => s + r.collected, 0n);
  const shared = rounds.filter((r) => r.released).reduce((s, r) => s + r.discount, 0n);
  $("balance").innerHTML = money(saved);
  $("gain").textContent = saved > 0n ? `+${((Number(shared) / Number(saved)) * 100).toFixed(2)}%` : "+0.00%";
  $("card-kind").textContent = PHASES[info.phase];

  const now = rounds[info.currentRound - 1];
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
  markLive();
}

/** The newest circle drives the story: its step, countdown and feed. */
async function refreshStory() {
  if (!has("steps") && !has("feed")) return;
  const live = state.list[0];
  if (!live) return;
  const [snap, quorum] = await Promise.all([snapshot(live.address), chain.quorumNeeded(live.address)]);
  const round = snap.rounds[snap.info.currentRound - 1];
  story.highlightStep(story.stepOf(snap.info, round, snap.paid, quorum));
  story.renderHeader(snap.info, round);
  if (has("feed")) await renderFeed(state.list.slice(0, 4), state.attacks, quorum);
  markLive();
}

async function loadCircles() {
  const addrs = await chain.circles();
  const infos = await Promise.all(addrs.map((a) => chain.circleInfo(a)));
  story.renderStats(infos, state.attacks);
  // The site follows the keeper's demo circles only: not visitors' "Try" circles, not people's live circles.
  const fresh = infos.filter((c) => c.organiser.toLowerCase() === CONFIG.keeper && c.name !== "Test run").reverse();
  const newest = fresh[0]?.address;
  if (!state.selected || (state.list[0] && state.list[0].address !== newest && state.selected === state.list[0].address)) {
    state.selected = newest ?? null;
  }
  state.list = fresh;
  state.all = infos;
  renderChips();
}

async function loadAttacks() {
  if (!has("attempts") && !has("st-attacks") && !has("feed")) return;
  const d = await story.deployments();
  state.attacks = d.attacks ?? [];
  const names = Object.fromEntries(state.list.map((c) => [c.address.toLowerCase(), c.name]));
  await story.renderAttempts(state.attacks, names);
}

const every = (ms, fn) => setInterval(() => fn().catch((e) => console.error("Rosca:", e)), ms);

async function start() {
  if (has("flow-ring")) {
    const { mountFlowDemo } = await import("./ring.js");
    mountFlowDemo($("flow-ring"), $("flow-caption"), $("flow-dots"));
  }
  initTabs((tab) => {
    state.tab = tab;
    refreshPhone().catch(console.error);
  });
  try {
    await loadCircles();
    await Promise.all([refreshPhone(), loadAttacks()]);
    story.renderStats(state.all, state.attacks);
    await refreshStory();
  } catch (e) {
    console.error("Rosca: could not read the testnet", e);
    $("device-note").textContent = "Could not reach the QoreChain testnet. Retrying…";
  }
  every(15000, refreshPhone);
  every(20000, refreshStory);
  every(60000, loadCircles);
  every(300000, loadAttacks);
}

start();
