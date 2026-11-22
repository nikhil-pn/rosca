// /tx/<hash>: one transaction, read straight from the QoreChain testnet.
// EVM hashes (0x…) come from the EVM JSON-RPC; native hashes (64 hex) from the REST API.
// The public explorer looks transactions up by their Cosmos hash and opens on mainnet, so this page
// is where Rosca's proof links point; it also offers the explorer link with the Cosmos hash.
import { CONFIG, who } from "./config.js";
import * as chain from "./chain.js";
import { T, describe } from "./feed.js";

const $ = (id) => document.getElementById(id);
const REST = "/api/rest";

const FN = {
  "0xb688a363": ["join", "Join the circle"],
  "0x1b9265b8": ["pay", "Pay this round's share"],
  "0x454a2ab3": ["bid", "Bid a discount for the pot"],
  "0x378252f2": ["closeAuction", "Close the auction"],
  "0x1e31a6dd": ["approveRelease", "Approve the payout"],
  "0xc315f7d9": ["release", "Release the pot (needs the winner's ML-DSA-87 signature)"],
  "0x3ccfd60b": ["withdraw", "Withdraw dividends, security or refund"],
  "0x3bef8a3a": ["dissolve", "Dissolve a stalled circle"],
  "0x59c5dac8": ["createCircle", "Open a new circle"],
  "0xa9059cbb": ["transfer", "Send fUSD"],
  "0x095ea7b3": ["approve", "Let a circle take this member's fUSD share"],
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const short = (h) => `${h.slice(0, 10)}…${h.slice(-8)}`;
const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
const when = (ts) => new Date(ts * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

function hashFromUrl() {
  const q = new URLSearchParams(location.search).get("h");
  const path = location.pathname.split("/").filter(Boolean);
  const raw = (q ?? (path[0] === "tx" ? path[1] : "") ?? "").trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return { kind: "evm", hash: raw.toLowerCase() };
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return { kind: "native", hash: raw.toUpperCase() };
  return null;
}

async function rest(path) {
  const res = await fetch(REST + path);
  if (!res.ok) return null;
  return res.json();
}

function explorerBlock(cosmosHash) {
  if (!cosmosHash) return "";
  return `<p>On the public QoreChain Explorer this transaction is listed under its Cosmos hash
    <code>${short(cosmosHash)}</code>. The explorer opens on mainnet, so choose <b>Testnet</b> at the top of the page if it says “not found”.</p>
    <a class="btn-glass" href="${CONFIG.explorer}/tx/${cosmosHash}" target="_blank" rel="noopener">Open in QoreChain Explorer ↗</a>`;
}

function show(status, title, lede) {
  $("tx-title").textContent = title;
  if (lede) $("tx-lede").textContent = lede;
  $("tx-card").hidden = false;
  $("tx-status").className = `tx-status ${status.ok ? "ok" : "bad"}`;
  $("tx-status").innerHTML = `<span class="ic">${status.ok ? "✓" : "✕"}</span><div>${esc(status.text)}<small>${esc(status.sub)}</small></div>`;
}

async function showEvm(hash) {
  const [tx, rc] = await Promise.all([chain.txByHash(hash), chain.txReceipt(hash)]);
  if (!tx || !rc) {
    $("tx-title").textContent = "Transaction not found";
    $("tx-lede").textContent = `No transaction ${short(hash)} on the QoreChain testnet (yet). If it was just sent, wait a few seconds and reload.`;
    return;
  }
  const ok = rc.status === "0x1";
  const fn = FN[(tx.input ?? "").slice(0, 10)] ?? null;
  const block = Number(BigInt(rc.blockNumber));
  const [ts, toName] = await Promise.all([chain.blockTime(block), tx.to ? chain.nameOf(tx.to) : null]);

  let sub = fn ? fn[1] : "Contract call";
  if (fn?.[0] === "release") {
    sub = ok
      ? "The winner's ML-DSA-87 signature was checked on chain by pqcVerify, and a majority had approved."
      : "Refused on chain: the payout did not carry a valid ML-DSA-87 signature from the winner for this exact recipient, amount and round. The pot did not move.";
  }
  show(
    { ok, text: ok ? "Succeeded on chain" : "Reverted on chain", sub },
    fn ? `${fn[0]}()` : "Transaction",
    `Read straight from the QoreChain testnet at block ${block.toLocaleString()}, ${when(ts)}.`,
  );

  const gas = BigInt(rc.gasUsed);
  $("tx-rows").innerHTML = [
    row("EVM hash", `<code>${hash}</code>`),
    row("From", `${esc(who(tx.from))} <code>${tx.from}</code>`),
    row("To", `${toName ? esc(toName) + " " : ""}<code>${tx.to ?? "contract creation"}</code>`),
    fn ? row("Function", `<code>${fn[0]}</code>`) : "",
    fn?.[0] === "release" ? row("Signature", `${((tx.input.length - 2) / 2).toLocaleString()} bytes of calldata, including the 4,627-byte ML-DSA-87 signature`) : "",
    row("Block", `${block.toLocaleString()} · ${when(ts)}`),
    row("Gas used", gas.toLocaleString()),
  ].join("");

  const names = {};
  if (tx.to && toName) names[tx.to.toLowerCase()] = toName;
  const evs = (rc.logs ?? [])
    .map((log) => {
      const name = T[log.topics[0]];
      const line = name && describe(name, log, names, "majority");
      return line ? `<div class="ev"><b>${esc(name)}</b> · ${esc(line[2])}<span>${esc(line[3])}</span></div>` : null;
    })
    .filter(Boolean);
  $("tx-events").innerHTML = evs.length ? evs.join("") : ok ? "" : `<div class="ev"><b>No events</b><span>A reverted transaction changes nothing, so it leaves no events.</span></div>`;

  const found = await rest(`/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(`ethereum_tx.ethereumTxHash='${hash}'`)}`).catch(() => null);
  $("tx-explorer").innerHTML = explorerBlock(found?.tx_responses?.[0]?.txhash);
}

const MSG = {
  "/qorechain.pqc.v1.MsgRegisterPQCKey": "Register an ML-DSA-87 key with proof of possession",
  "/qorechain.pqc.v1.MsgRegisterPQCKeyV2": "Register an ML-DSA-87 key with proof of possession",
  "/cosmos.evm.erc20.v1.MsgConvertCoin": "Move fUSD from the bank to the ERC-20",
  "/cosmos.bank.v1beta1.MsgSend": "Send QOR",
};

async function showNative(hash) {
  const body = await rest(`/cosmos/tx/v1beta1/txs/${hash}`).catch(() => null);
  const r = body?.tx_response;
  if (!r) {
    $("tx-title").textContent = "Transaction not found";
    $("tx-lede").textContent = `No transaction ${short(hash)} on the QoreChain testnet (yet).`;
    return;
  }
  const types = (body.tx?.body?.messages ?? []).map((m) => m["@type"]);
  const ok = r.code === 0;
  const label = types.map((t) => MSG[t] ?? (/Window/i.test(t) ? "Open a scoped EVM window (signed with both keys)" : t.split(".").pop())).join(", ");
  show(
    { ok, text: ok ? "Succeeded on chain" : "Failed on chain", sub: label || "Native transaction" },
    types.length === 1 ? types[0].split(".").pop() : "Native transaction",
    `Read straight from the QoreChain testnet at block ${Number(r.height).toLocaleString()}, ${new Date(r.timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`,
  );
  const win = (body.tx?.body?.messages ?? []).find((m) => /OpenEVMWindow/.test(m["@type"]));
  let scope = "";
  if (win) {
    const targets = win.allowed_targets ?? [];
    const names = await Promise.all(targets.map((t) => chain.nameOf(t)));
    scope = [
      row("Sender", `<code>${esc(win.sender)}</code>`),
      row("Scoped to", targets.length ? targets.map((t, i) => `${names[i] ? esc(names[i]) + " " : ""}<code>${t}</code>`).join("<br>") + "<br><small>No other contract can be called through this window.</small>" : "any contract"),
      row("Limits", `${Number(win.max_txs)} transactions, ${Number(win.blocks).toLocaleString()} blocks, at most ${(Number(win.max_value) / 1e6).toLocaleString()} QOR spent`),
    ].join("");
  }
  $("tx-rows").innerHTML = [
    row("Hash", `<code>${hash}</code>`),
    row("Messages", types.map((t) => `<code>${esc(t)}</code>`).join("<br>")),
    scope,
    row("Block", Number(r.height).toLocaleString()),
    row("Gas used", Number(r.gas_used).toLocaleString()),
  ].join("");
  $("tx-explorer").innerHTML = explorerBlock(hash);
}

const target = hashFromUrl();
if (!target) {
  $("tx-title").textContent = "No transaction";
  $("tx-lede").textContent = "Open this page as /tx/0x… (an EVM hash) or /tx/ABC… (a native hash).";
} else {
  (target.kind === "evm" ? showEvm(target.hash) : showNative(target.hash)).catch((e) => {
    console.error("Rosca:", e);
    $("tx-title").textContent = "Could not reach the QoreChain testnet";
    $("tx-lede").textContent = "Reload in a moment.";
  });
}
