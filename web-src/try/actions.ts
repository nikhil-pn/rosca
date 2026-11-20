/**
 * Everything a visitor does on chain, signed in their browser with keys that never leave it.
 *
 * Native lane (key registration, EVM windows) goes through `/api/rest`. EVM calls go straight to the
 * testnet JSON-RPC. Each EVM call runs inside a window opened with the visitor's ML-DSA-87 key.
 */
import {
  buildRegisterPqcKeyMsg,
  fetchPqcStatus,
  isRegisteredPqcKey,
  openEvmWindowMsg,
  pqcSign,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { evmWindowCost, evmWindowStatus } from "@qorechain/evm";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  defineChain,
  hexToBytes,
  http,
  maxUint256,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { circleAbi, factoryAbi } from "../lib/abi.ts";
import { NET, broadcastAs } from "../lib/qore.ts";

export const REST = (typeof location !== "undefined" ? location.origin : "") + "/api/rest";
const UNIT = 10n ** BigInt(NET.fusdDecimals);

const chain = defineChain({
  id: NET.evmChainId,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [NET.evmRpc] } },
});
export const pub = createPublicClient({ chain, transport: http(NET.evmRpc) });

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

// ---------------------------------------------------------------- reads

export const read = <T>(circle: Address, functionName: string, args: readonly unknown[] = []) =>
  pub.readContract({ address: circle, abi: circleAbi as Abi, functionName, args }) as Promise<T>;

export async function fusdBalance(addr: Address): Promise<bigint> {
  return (await pub.readContract({ address: NET.fusd, abi: ERC20, functionName: "balanceOf", args: [addr] })) as bigint;
}

export const qorBalance = (addr: Address) => pub.getBalance({ address: addr });

export async function pqcRegistered(acc: UnifiedAccount): Promise<boolean> {
  const s = await fetchPqcStatus({ rest: REST, address: acc.cosmos });
  return Boolean(s.registered && isRegisteredPqcKey(s, acc.pqc.publicKey));
}

export interface RoundView {
  start: bigint;
  bidEnd: bigint;
  closedAt: bigint;
  bestBidder: Address;
  bestDiscount: bigint;
  collected: bigint;
  winner: Address;
  discount: bigint;
  approvals: number;
  closed: boolean;
  released: boolean;
}

// ---------------------------------------------------------------- the faucet

export async function faucet(acc: UnifiedAccount): Promise<string> {
  const res = await fetch("/api/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: acc.evm }),
  });
  const body = (await res.json()) as { tx?: string; error?: string };
  if (!res.ok || !body.tx) throw new Error(body.error ?? `faucet: HTTP ${res.status}`);
  return body.tx;
}

// ---------------------------------------------------------------- native lane

/** Register the ML-DSA-87 key with a proof of possession (the one native message signed classically). */
export async function registerKey(acc: UnifiedAccount): Promise<string> {
  const proofOfPossession = signProofOfPossession({ chainId: NET.chainId, account: acc.cosmos, keypair: acc.pqc });
  const msg = buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession });
  return broadcastAs(REST, acc, "classical", [msg]);
}

/** Make sure a live window covers exactly `targets`; otherwise open one, signed hybrid (ML-DSA-87 + secp256k1). */
export async function ensureWindow(acc: UnifiedAccount, targets: Address[], minTxs = 3n): Promise<string | null> {
  const w = await evmWindowStatus({ rest: REST, address: acc.cosmos });
  const want = targets.map((t) => t.toLowerCase()).sort().join(",");
  const have = (w.allowedTargets ?? []).map((t: string) => t.toLowerCase()).sort().join(",");
  if (w.found && w.live && BigInt(w.remainingTxs) >= minTxs && want === have) return null;
  const maxTxs = 20n;
  const perTx = evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 250_000_000_000n });
  const msg = openEvmWindowMsg({ sender: acc.cosmos, blocks: 3000n, maxTxs, maxValue: perTx * maxTxs, allowedTargets: targets });
  const hash = await broadcastAs(REST, acc, "hybrid", [msg]);
  for (let i = 0; i < 30; i++) {
    const s = await evmWindowStatus({ rest: REST, address: acc.cosmos });
    if (s.found && s.live) return hash;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("the window did not go live");
}

// ---------------------------------------------------------------- EVM lane

function wallet(acc: UnifiedAccount) {
  return createWalletClient({ account: privateKeyToAccount(acc.privateKey as Hex), chain, transport: http(NET.evmRpc) });
}

/** Estimate, add 30% (the testnet bills half the gas limit), send, wait. Throws if it reverts. */
async function send(acc: UnifiedAccount, to: Address, abi: Abi, functionName: string, args: readonly unknown[], cap: bigint): Promise<Hex> {
  let gas = cap;
  try {
    const est = await pub.estimateContractGas({ address: to, abi, functionName, args, account: acc.evm as Address });
    gas = (est * 13n) / 10n < cap ? (est * 13n) / 10n : cap;
  } catch (e) {
    throw new Error(reason(e));
  }
  const hash = await wallet(acc).writeContract({ address: to, abi, functionName, args, gas, chain });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}

/** The contract's own error name, e.g. "TooEarly", from a viem error. */
export function reason(e: unknown): string {
  const m = String((e as { shortMessage?: string })?.shortMessage ?? e);
  const named = m.match(/reverted with the following reason:\s*\n?\s*(.+)|Error: (\w+\(.*?\))/);
  return named ? (named[1] ?? named[2]).trim() : m.split("\n")[0];
}

export const scope = (circle: Address): Address[] => [circle, NET.fusd];

export async function createCircle(acc: UnifiedAccount, name: string): Promise<{ address: Address; tx: Hex }> {
  await ensureWindow(acc, [NET.factory]);
  const params = {
    token: NET.fusd,
    share: 10n * UNIT,
    size: 3,
    roundLength: 120,
    graceLength: 120,
    maxDiscountBps: 3000,
    feeBps: 200,
    quorumBps: 5001,
    securityBps: 5000,
    name,
  };
  const tx = await send(acc, NET.factory, factoryAbi as Abi, "createCircle", [params], 4_000_000n);
  const mine = (await pub.readContract({ address: NET.factory, abi: factoryAbi as Abi, functionName: "circlesOf", args: [acc.evm] })) as Address[];
  return { address: mine[mine.length - 1], tx };
}

export async function join(acc: UnifiedAccount, circle: Address): Promise<Hex> {
  await ensureWindow(acc, scope(circle), 6n);
  const allowance = (await pub.readContract({ address: NET.fusd, abi: ERC20, functionName: "allowance", args: [acc.evm as Address, circle] })) as bigint;
  if (allowance === 0n) await send(acc, NET.fusd, ERC20 as Abi, "approve", [circle, maxUint256], 200_000n);
  return send(acc, circle, circleAbi as Abi, "join", [], 600_000n);
}

const act = (fn: string, cap: bigint) => async (acc: UnifiedAccount, circle: Address, args: readonly unknown[] = []) => {
  await ensureWindow(acc, scope(circle));
  return send(acc, circle, circleAbi as Abi, fn, args, cap);
};
export const pay = act("pay", 400_000n);
export const bid = act("bid", 300_000n);
export const closeAuction = act("closeAuction", 1_500_000n);
export const approve = act("approveRelease", 300_000n);
export const withdraw = act("withdraw", 300_000n);

/** Sign the exact payout bytes with ML-DSA-87, in the browser. */
export async function signPayout(acc: UnifiedAccount, circle: Address, round: bigint, recipient: Address, deadline: bigint): Promise<Hex> {
  const message = await read<Hex>(circle, "payoutMessage", [round, recipient, deadline]);
  return bytesToHex(pqcSign(acc.pqc.secretKey, hexToBytes(message)));
}

export async function release(acc: UnifiedAccount, circle: Address): Promise<{ tx: Hex; sigBytes: number }> {
  await ensureWindow(acc, scope(circle));
  const round = await read<bigint>(circle, "currentRound");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await signPayout(acc, circle, round, acc.evm as Address, deadline);
  const tx = await send(acc, circle, circleAbi as Abi, "release", [acc.evm, deadline, signature], 2_500_000n);
  return { tx, sigBytes: (signature.length - 2) / 2 };
}

/**
 * Play the thief: send the pot to a stranger, reusing your genuine signature (which names you as the
 * recipient). Sent with a fixed gas limit and no estimate, so it lands on chain and reverts there.
 */
export async function steal(acc: UnifiedAccount, circle: Address): Promise<{ tx: Hex; status: string; stranger: Address }> {
  await ensureWindow(acc, scope(circle));
  const round = await read<bigint>(circle, "currentRound");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await signPayout(acc, circle, round, acc.evm as Address, deadline);
  const stranger = privateKeyToAccount(generatePrivateKey()).address;
  const tx = await wallet(acc).writeContract({
    address: circle,
    abi: circleAbi as Abi,
    functionName: "release",
    args: [stranger, deadline, signature],
    gas: 900_000n,
    chain,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  return { tx, status: receipt.status, stranger };
}
