/**
 * EVM lane: open an authorisation window with the account's post-quantum key, then send
 * ordinary EVM transactions through it.
 *
 * A window bounds blocks, transaction count and QOR spent, and can be scoped to a list of
 * contracts. A member's window for a circle is scoped to that circle and the fUSD token only,
 * so even a stolen secp256k1 key can touch nothing else.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { openEvmWindowMsg, type UnifiedAccount } from "@qorechain/sdk";
import { evmWindowCost, evmWindowStatus } from "@qorechain/evm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "./config.ts";
import { broadcastAs } from "./native.ts";

export const qorechainTestnet = defineChain({
  id: CONFIG.evmChainId,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.evmRpc] } },
});

export const publicClient = createPublicClient({ chain: qorechainTestnet, transport: http(CONFIG.evmRpc) });

export function walletFor(acc: UnifiedAccount) {
  return createWalletClient({
    account: privateKeyToAccount(acc.privateKey as Hex),
    chain: qorechainTestnet,
    transport: http(CONFIG.evmRpc),
  });
}

/** ABI and bytecode of a compiled contract, read from Foundry's `out/`. */
export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const file = join(import.meta.dirname, "..", "..", "out", `${name}.sol`, `${name}.json`);
  const json = JSON.parse(readFileSync(file, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

export interface WindowOptions {
  blocks?: bigint;
  maxTxs?: bigint;
  /** Contracts the window may touch. Empty means any target (needed to deploy). */
  allowedTargets?: Address[];
}

/** Open (or replace) the account's EVM window. Signed hybrid, so only the ML-DSA-87 key can do it. */
export async function openWindow(acc: UnifiedAccount, opts: WindowOptions = {}): Promise<string> {
  const blocks = opts.blocks ?? 3000n;
  const maxTxs = opts.maxTxs ?? 20n;
  const perTx = evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 250_000_000_000n });
  const msg = openEvmWindowMsg({
    sender: acc.cosmos,
    blocks,
    maxTxs,
    maxValue: perTx * maxTxs,
    allowedTargets: opts.allowedTargets ?? [],
  });
  return broadcastAs(acc, "hybrid", [msg]);
}

export async function windowStatus(acc: UnifiedAccount) {
  return evmWindowStatus({ rest: CONFIG.rest, address: acc.cosmos });
}

/** Make sure the account has a live window that covers `targets` (or any target if empty). */
export async function ensureWindow(acc: UnifiedAccount, targets: Address[] = [], minTxs = 3n): Promise<void> {
  const w = await windowStatus(acc);
  const want = targets.map((t) => t.toLowerCase()).sort().join(",");
  const have = (w.allowedTargets ?? []).map((t: string) => t.toLowerCase()).sort().join(",");
  if (w.found && w.live && BigInt(w.remainingTxs) >= minTxs && want === have) return;
  const hash = await openWindow(acc, { allowedTargets: targets });
  console.log(`  window opened for ${acc.evm}${targets.length ? ` (scoped to ${targets.length} contracts)` : ""}: ${hash}`);
  await waitForWindow(acc);
}

async function waitForWindow(acc: UnifiedAccount): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const w = await windowStatus(acc);
    if (w.found && w.live) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`window for ${acc.evm} did not go live`);
}

/** Send a contract call and wait for it. Throws if it reverts. */
export async function send(
  acc: UnifiedAccount,
  to: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  gas = 1_500_000n,
): Promise<Hex> {
  const wallet = walletFor(acc);
  const hash = await wallet.writeContract({ address: to, abi, functionName, args, gas, chain: qorechainTestnet });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}
