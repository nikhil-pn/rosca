// Fills the phone and the story with live data from the QoreChain testnet.
import { CONFIG } from "./config.js";
import * as chain from "./chain.js";
import { renderFeed } from "./feed.js";
import * as story from "./story.js";

const $ = (id) => document.getElementById(id);
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

const state = { list: [], selected: null, attacks: [] };

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
  if (!state.list.length) return;
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

async function refreshPhone() {
  const c = state.list.find((x) => x.address === state.selected);
  if (!c) return;
  const { info, rounds, paid } = await snapshot(c.address);
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
}

/** The newest circle drives the story: its step, countdown and feed. */
async function refreshStory() {
  const live = state.list[0];
  if (!live) return;
  const [snap, quorum] = await Promise.all([snapshot(live.address), chain.quorumNeeded(live.address)]);
  const round = snap.rounds[snap.info.currentRound - 1];
  story.highlightStep(story.stepOf(snap.info, round, snap.paid, quorum));
  story.renderHeader(snap.info, round);
  await renderFeed(state.list.slice(0, 4), state.attacks, quorum);
  $("device-note").textContent = `Live on QoreChain testnet · updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

async function loadCircles() {
  const addrs = await chain.circles();
  const infos = await Promise.all(addrs.map((a) => chain.circleInfo(a)));
  const fresh = infos.reverse();
  const newest = fresh[0]?.address;
  if (!state.selected || (state.list[0] && state.list[0].address !== newest && state.selected === state.list[0].address)) {
    state.selected = newest ?? null;
  }
  state.list = fresh;
  renderChips();
  story.renderStats(fresh, state.attacks);
}

async function loadAttacks() {
  const d = await story.deployments();
  state.attacks = d.attacks ?? [];
  const names = Object.fromEntries(state.list.map((c) => [c.address.toLowerCase(), c.name]));
  await story.renderAttempts(state.attacks, names);
}

const every = (ms, fn) => setInterval(() => fn().catch((e) => console.error("Rosca:", e)), ms);

async function start() {
  try {
    await loadCircles();
    await Promise.all([refreshPhone(), loadAttacks()]);
    story.renderStats(state.list, state.attacks);
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
