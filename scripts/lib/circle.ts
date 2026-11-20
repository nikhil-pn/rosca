/**
 * Driving a circle on the testnet from the demo accounts.
 *
 * Every member call goes through a window scoped to the circle and the fUSD token.
 * The release carries the winner's ML-DSA-87 signature, made here with the SDK's pqcSign and
 * checked on chain by the circle through the pqcVerify precompile.
 */
import { pqcSign, type UnifiedAccount } from "@qorechain/sdk";
import { bytesToHex, hexToBytes, maxUint256, type Address, type Hex } from "viem";
import { CONFIG } from "./config.ts";
import { artifact, ensureWindow, publicClient, send } from "./evm.ts";

export const circleAbi = artifact("RoscaCircle").abi;
export const factoryAbi = artifact("RoscaFactory").abi;

const ERC20_APPROVE = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface CircleParams {
  name: string;
  /** fUSD per member per round, in whole fUSD. */
  shareFusd: number;
  size: number;
  roundSeconds: number;
  graceSeconds: number;
}

/** Targets of a member's scoped window: the circle and the fUSD token, nothing else.
 * (Every helper below takes an optional `targets` for a bot that plays several circles at once.) */
export const scope = (circle: Address): Address[] => [circle, CONFIG.fusd];

export async function createCircle(organiser: UnifiedAccount, factory: Address, p: CircleParams) {
  await ensureWindow(organiser, [factory]);
  const params = {
    token: CONFIG.fusd,
    share: BigInt(p.shareFusd) * 10n ** BigInt(CONFIG.fusdDecimals),
    size: p.size,
    roundLength: p.roundSeconds,
    graceLength: p.graceSeconds,
    maxDiscountBps: 3000,
    feeBps: 200,
    quorumBps: 5001,
    securityBps: 5000,
    name: p.name,
  };
  const tx = await send(organiser, factory, factoryAbi, "createCircle", [params], 4_000_000n);
  const list = (await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "circlesOf",
    args: [organiser.evm],
  })) as Address[];
  return { address: list[list.length - 1], tx };
}

export async function read<T>(circle: Address, functionName: string, args: readonly unknown[] = []): Promise<T> {
  return (await publicClient.readContract({ address: circle, abi: circleAbi, functionName, args })) as T;
}

export async function join(m: UnifiedAccount, circle: Address, targets?: Address[]): Promise<Hex> {
  await ensureWindow(m, targets ?? scope(circle), 4n);
  const allowance = (await publicClient.readContract({
    address: CONFIG.fusd,
    abi: ERC20_APPROVE,
    functionName: "allowance",
    args: [m.evm as Address, circle],
  })) as bigint;
  if (allowance === 0n) await send(m, CONFIG.fusd, ERC20_APPROVE, "approve", [circle, maxUint256], 200_000n);
  return send(m, circle, circleAbi, "join", [], 600_000n);
}

export async function pay(m: UnifiedAccount, circle: Address, targets?: Address[]): Promise<Hex> {
  await ensureWindow(m, targets ?? scope(circle));
  return send(m, circle, circleAbi, "pay", [], 400_000n);
}

export async function bid(m: UnifiedAccount, circle: Address, discountFusd: number, targets?: Address[]): Promise<Hex> {
  await ensureWindow(m, targets ?? scope(circle));
  const discount = BigInt(Math.round(discountFusd * 10 ** CONFIG.fusdDecimals));
  return send(m, circle, circleAbi, "bid", [discount], 300_000n);
}

export async function closeAuction(m: UnifiedAccount, circle: Address, targets?: Address[]): Promise<Hex> {
  await ensureWindow(m, targets ?? scope(circle));
  return send(m, circle, circleAbi, "closeAuction", [], 1_500_000n);
}

export async function approveRelease(m: UnifiedAccount, circle: Address, targets?: Address[]): Promise<Hex> {
  await ensureWindow(m, targets ?? scope(circle));
  return send(m, circle, circleAbi, "approveRelease", [], 300_000n);
}

/** The winner signs the exact payout bytes the circle will check, with their ML-DSA-87 key. */
export async function signPayout(winner: UnifiedAccount, circle: Address, round: bigint, recipient: Address, deadline: bigint) {
  const message = await read<Hex>(circle, "payoutMessage", [round, recipient, deadline]);
  const signature = pqcSign(winner.pqc.secretKey, hexToBytes(message));
  return bytesToHex(signature);
}

export async function release(winner: UnifiedAccount, circle: Address, recipient?: Address, targets?: Address[]): Promise<Hex> {
  await ensureWindow(winner, targets ?? scope(circle));
  const round = await read<bigint>(circle, "currentRound");
  const to = recipient ?? (winner.evm as Address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await signPayout(winner, circle, round, to, deadline);
  return send(winner, circle, circleAbi, "release", [to, deadline, signature], 2_500_000n);
}

export async function withdraw(m: UnifiedAccount, circle: Address, targets?: Address[]): Promise<Hex> {
  await ensureWindow(m, targets ?? scope(circle));
  return send(m, circle, circleAbi, "withdraw", [], 300_000n);
}
