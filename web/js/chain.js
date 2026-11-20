// A tiny read-only JSON-RPC client with just enough ABI decoding for Rosca's views.
import { CONFIG } from "./config.js";

let id = 0;
async function rpc(method, params) {
  const res = await fetch(CONFIG.evmRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
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

export async function circles() {
  return decodeAddressArray(await call(CONFIG.factory, SEL.circles));
}

export async function circleInfo(c) {
  const [name, share, size, currentRound, phase, memberCount] = await Promise.all([
    call(c, SEL.name).then(decodeString),
    call(c, SEL.share).then((h) => uint(word(h, 0))),
    call(c, SEL.size).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.currentRound).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.phase).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.memberCount).then((h) => Number(uint(word(h, 0)))),
  ]);
  return { address: c, name, share, size, currentRound, phase, memberCount };
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
