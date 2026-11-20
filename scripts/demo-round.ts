/**
 * One full round on the testnet, end to end: open a circle with 2-minute rounds, all five demo
 * members join and pay, member-2 bids, the auction closes, three approve, and member-2 releases
 * the pot with an ML-DSA-87 signature. Run: npx tsx scripts/demo-round.ts
 */
import type { Address } from "viem";
import { account } from "./lib/accounts.ts";
import * as c from "./lib/circle.ts";
import { readDeployments } from "./lib/deployments.ts";
const d = readDeployments();
const org = await account("deployer");
const ms = await Promise.all([1, 2, 3, 4, 5].map((i) => account(`member-${i}` as const)));
const log = (k: string, v: string) => console.log(k.padEnd(28), v);
const made = await c.createCircle(org, d.factory as Address, { name: "Test run", shareFusd: 10, size: 5, roundSeconds: 120, graceSeconds: 120 });
log("circle", `${made.address} tx ${made.tx}`);
const circle = made.address;
for (const [i, m] of ms.entries()) log(`join member-${i + 1}`, await c.join(m, circle));
for (const [i, m] of ms.entries()) log(`pay member-${i + 1}`, await c.pay(m, circle));
log("bid member-2 (5 fUSD)", await c.bid(ms[1], circle, 5));
const r = await c.read<{ bidEnd: bigint }>(circle, "getRound", [1n]);
const wait = Number(r.bidEnd) * 1000 - Date.now() + 8000;
console.log(`waiting ${Math.round(wait / 1000)} s for bidding to end`);
await new Promise((res) => setTimeout(res, Math.max(wait, 0)));
log("close", await c.closeAuction(ms[0], circle));
for (const i of [0, 2, 3]) log(`approve member-${i + 1}`, await c.approveRelease(ms[i], circle));
log("release (ML-DSA-87)", await c.release(ms[1], circle));
log("round now", String(await c.read<bigint>(circle, "currentRound")));
