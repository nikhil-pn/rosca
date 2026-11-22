// A tiny read-only JSON-RPC client with just enough ABI decoding for Rosca's views.
import { CONFIG } from "./config.js";

// Calls made in the same moment (a page load reads ~20 values per circle) go out together as one
// JSON-RPC batch, so a phone makes a handful of requests instead of hundreds and stays well under
// the endpoint's rate limit.
let id = 0;
let queue = [];
const BATCH = 40;

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    queue.push({ body: { jsonrpc: "2.0", id: ++id, method, params }, resolve, reject });
    if (queue.length === 1) setTimeout(flush, 0);
  });
}

function flush() {
  const all = queue;
  queue = [];
  for (let i = 0; i < all.length; i += BATCH) send(all.slice(i, i + BATCH));
}

async function send(items) {
  try {
    const res = await fetch(CONFIG.evmRpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(items.map((it) => it.body)),
    });
    const replies = await res.json();
    if (!Array.isArray(replies)) throw new Error(replies?.error?.message ?? `HTTP ${res.status}`);
    const byId = new Map(replies.map((r) => [r.id, r]));
    for (const it of items) {
      const r = byId.get(it.body.id);
      if (!r) it.reject(new Error("no reply"));
      else if (r.error) it.reject(new Error(r.error.message));
      else it.resolve(r.result);
    }
  } catch (e) {
    for (const it of items) it.reject(e);
  }
}

const SEL = {
  circles: "0xde979cbd",
  name: "0x06fdde03",
  share: "0xa8d5fd65",
  size: "0x949d225d",
  currentRound: "0x8a19c8bc",
  phase: "0xb1c9fe6e",
  memberCount: "0x11aee380",
  getRound: "0x8f1327c0",
  members: "0xbdd4d18d",
  paid: "0xa031fb7f",
  quorumNeeded: "0xcb571211",
  hasWon: "0xa52b2b88",
  organiser: "0x7e537486",
};

const word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const uint = (w) => BigInt("0x" + w);
const addr = (w) => "0x" + w.slice(24);
const pad = (v) => BigInt(v).toString(16).padStart(64, "0");
const padAddr = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

async function call(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

function decodeString(hex) {
  const off = Number(uint(word(hex, 0))) / 32;
  const len = Number(uint(word(hex, off)));
  const bytes = hex.slice(2 + (off + 1) * 64, 2 + (off + 1) * 64 + len * 2);
  return new TextDecoder().decode(Uint8Array.from(bytes.match(/../g) ?? [], (b) => parseInt(b, 16)));
}

function decodeAddressArray(hex) {
  const off = Number(uint(word(hex, 0))) / 32;
  const len = Number(uint(word(hex, off)));
  return Array.from({ length: len }, (_, i) => addr(word(hex, off + 1 + i)));
}

/** Every circle from every factory, oldest first. */
export async function circles() {
  const lists = await Promise.all(
    [...CONFIG.olderFactories, CONFIG.factory].map((f) => call(f, SEL.circles).then(decodeAddressArray)),
  );
  return lists.flat();
}

export async function circleInfo(c) {
  const [name, share, size, currentRound, phase, memberCount, organiser] = await Promise.all([
    call(c, SEL.name).then(decodeString),
    call(c, SEL.share).then((h) => uint(word(h, 0))),
    call(c, SEL.size).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.currentRound).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.phase).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.memberCount).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.organiser).then((h) => addr(word(h, 0))),
  ]);
  return { address: c, name, share, size, currentRound, phase, memberCount, organiser };
}

export async function round(c, r) {
  const h = await call(c, SEL.getRound + pad(r));
  return {
    start: Number(uint(word(h, 0))),
    bidEnd: Number(uint(word(h, 1))),
    closedAt: Number(uint(word(h, 2))),
    bestBidder: addr(word(h, 3)),
    bestDiscount: uint(word(h, 4)),
    collected: uint(word(h, 5)),
    winner: addr(word(h, 6)),
    discount: uint(word(h, 7)),
    approvals: Number(uint(word(h, 8))),
    closed: uint(word(h, 9)) === 1n,
    released: uint(word(h, 10)) === 1n,
  };
}

export async function members(c) {
  return decodeAddressArray(await call(c, SEL.members));
}

export async function hasPaid(c, r, member) {
  return uint(word(await call(c, SEL.paid + pad(r) + padAddr(member)), 0)) === 1n;
}

// ---------------------------------------------------------------- blocks and logs

export const blockNumber = async () => Number(BigInt(await rpc("eth_blockNumber", [])));

const blockTimes = new Map();
export async function blockTime(n) {
  if (!blockTimes.has(n)) {
    const b = await rpc("eth_getBlockByNumber", ["0x" + n.toString(16), false]);
    blockTimes.set(n, Number(BigInt(b.timestamp)));
  }
  return blockTimes.get(n);
}

/** Logs of `addresses` over the last `span` blocks (the RPC allows 10,000 per query). */
export async function recentLogs(addresses, span = 9999) {
  const head = await blockNumber();
  const from = Math.max(head - span, CONFIG.factoryBlock);
  return rpc("eth_getLogs", [{ fromBlock: "0x" + from.toString(16), toBlock: "latest", address: addresses }]);
}

export async function receiptStatus(hash) {
  const r = await rpc("eth_getTransactionReceipt", [hash]);
  return r ? (r.status === "0x1" ? "success" : "reverted") : "pending";
}

export async function quorumNeeded(c) {
  return Number(uint(word(await call(c, SEL.quorumNeeded), 0)));
}

export async function hasWon(c, member) {
  return uint(word(await call(c, SEL.hasWon + padAddr(member)), 0)) === 1n;
}

/** The transaction and its receipt, for the /tx page. */
export const txByHash = (h) => rpc("eth_getTransactionByHash", [h]);
export const txReceipt = (h) => rpc("eth_getTransactionReceipt", [h]);

/** A contract's name() if it has one (circles and fUSD do), else null. */
export async function nameOf(address) {
  try {
    return decodeString(await call(address, SEL.name));
  } catch {
    return null;
  }
}
