/**
 * Play the thief against a demo member right now: holding only the member's classical key, try to move the
 * member's fUSD (EVM) and QOR (native). The chain refuses both; the refusals go into deployments/testnet.json
 * and onto the site's security page. The keeper does the same after every payout on factory v4.
 *   npx tsx scripts/thief-drain.ts member-1 <circle the member's window is scoped to>
 */
import type { Address } from "viem";
import { account, type Role } from "./lib/accounts.ts";
import { ensureWindow } from "./lib/evm.ts";
import { thiefDrains } from "./lib/thief.ts";
import * as c from "./lib/circle.ts";

const [role = "member-1", circle] = process.argv.slice(2);
if (!circle) throw new Error("usage: thief-drain.ts <member> <circle>");
const m = await account(role as Role);
await ensureWindow(m, c.scope(circle as Address)); // the member's everyday window: this circle only
const round = await c.read<bigint>(circle as Address, "currentRound");
await thiefDrains(circle as Address, m, round, (msg, tx) => console.log(msg, tx));
