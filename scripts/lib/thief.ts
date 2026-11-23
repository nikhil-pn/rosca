/**
 * The thief's second move, shared by the keeper and `scripts/thief-drain.ts`.
 */
import { fromHex, toBech32 } from "@cosmjs/encoding";
import type { UnifiedAccount } from "@qorechain/sdk";
import type { Address } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { CONFIG } from "./config.ts";
import { readDeployments, writeDeployments } from "./deployments.ts";
import { publicClient, qorechainTestnet, walletFor } from "./evm.ts";
import { broadcastAs } from "./native.ts";

/**
 * After the payout lands, the thief (still holding only the winner's classical key) goes for the money
 * itself: an EVM `fUSD.transfer` of the winner's balance, and a native send of the winner's QOR. The chain
 * refuses both before they reach a block: the winner's window lists only the circle, and every native
 * transaction from an account with a PQC key needs the ML-DSA-87 signature. The refusals are recorded.
 */
export async function thiefDrains(circle: Address, winner: UnifiedAccount, round: bigint, log: (msg: string, tx: string) => void = console.log): Promise<void> {
  const thief = privateKeyToAccount(generatePrivateKey()).address;
  const record = (kind: string, reason: string) => {
    log(`thief (${kind}) -> refused: ${reason.slice(0, 120)}`, "");
    const d = readDeployments();
    d.attacks = [...(d.attacks ?? []), { circle, round: Number(round), kind, thief, tx: "", status: "refused", at: new Date().toISOString(), reason }];
    writeDeployments(d);
  };
  const why = (e: unknown) => {
    const x = e as { details?: string; shortMessage?: string; message?: string };
    return String(x.details ?? x.shortMessage ?? x.message ?? e).replace(/\s*\[cosmossdk[^\]]*\]/g, "").slice(0, 400);
  };
  const balance = (await publicClient.readContract({ address: CONFIG.fusd, abi: ERC20_TRANSFER, functionName: "balanceOf", args: [winner.evm as Address] })) as bigint;
  try {
    const h = await walletFor(winner).writeContract({ address: CONFIG.fusd, abi: ERC20_TRANSFER, functionName: "transfer", args: [thief, balance], gas: 100_000n, chain: qorechainTestnet });
    log("ALERT: fUSD transfer was admitted", h);
  } catch (e) {
    record("fusd-transfer", why(e));
  }
  try {
    const msg = { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: winner.cosmos, toAddress: toBech32("qor", fromHex(thief.slice(2))), amount: [{ denom: "uqor", amount: "1000000" }] } };
    const h = await broadcastAs(winner, "classical", [msg as never]);
    log("ALERT: classical native send was admitted", h);
  } catch (e) {
    record("classical-send", why(e));
  }
}

const ERC20_TRANSFER = [
  { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "balanceOf", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

