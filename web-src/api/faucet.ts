/**
 * POST /api/faucet  { "address": "0x…" }
 *
 * Gives a brand-new visitor wallet enough test QOR for gas and 40 fUSD to play one circle, in one hybrid
 * transaction from Rosca's throwaway faucet account (testnet only; its mnemonic is the Vercel env var
 * ROSCA_FAUCET_MNEMONIC). Only wallets that do not exist on chain yet are served, a few per IP per hour.
 */
import { deriveUnifiedAccount, evmToQor } from "@qorechain/sdk";
import { broadcastAs, balances, convertCoinMsg, NET } from "../lib/qore.ts";

const REST = "https://api-testnet.qore.host";
const QOR = 2_000_000n; // 2 test QOR, in uqor
const FUSD = 40n * 10n ** BigInt(NET.fusdDecimals);
const PER_IP_PER_HOUR = 4;

const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) return true;
  hits.set(ip, [...recent, now]);
  return false;
}

interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

export default async function handler(req: Req, res: Res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {}) as { address?: string };
  const evm = String(body.address ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(evm)) return res.status(400).json({ error: "send { address: 0x… }" });

  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many wallets from here this hour. Try again later." });

  const mnemonic = process.env.ROSCA_FAUCET_MNEMONIC?.trim();
  if (!mnemonic) return res.status(503).json({ error: "faucet not configured" });

  try {
    const to = evmToQor(evm);
    const have = await balances(REST, to);
    if ((have.uqor ?? 0n) > 0n) return res.status(409).json({ error: "This wallet already has test QOR." });

    const faucet = await deriveUnifiedAccount(mnemonic, 0);
    const pool = await balances(REST, faucet.cosmos);
    if ((pool.uqor ?? 0n) < QOR + 500_000n || (pool[NET.fusdDenom] ?? 0n) < FUSD) {
      return res.status(503).json({ error: "The faucet is empty right now. Please tell the Rosca team." });
    }
    const msgs = [
      { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: faucet.cosmos, toAddress: to, amount: [{ denom: "uqor", amount: QOR.toString() }] } },
      convertCoinMsg(faucet.cosmos, evm, FUSD),
    ];
    let tx: string;
    try {
      tx = await broadcastAs(REST, faucet, "hybrid", msgs);
    } catch (e) {
      // Two visitors at the same moment race for the sequence number: wait and try once more.
      if (!String(e).includes("sequence")) throw e;
      await new Promise((r) => setTimeout(r, 4000));
      tx = await broadcastAs(REST, faucet, "hybrid", msgs);
    }
    return res.status(200).json({ tx, qor: "2", fusd: "40", cosmos: to });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message.slice(0, 300) : "faucet failed" });
  }
}
