/**
 * The committed record of what is deployed on the testnet (deployments/testnet.json).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address } from "viem";
import { CONFIG } from "./config.ts";

export interface Deployments {
  network: string;
  chainId: number;
  fusd: Address;
  factory?: Address;
  factoryTx?: string;
  circles?: { address: Address; name: string; tx: string }[];
  /** The circle the keeper is running now, and how many it has opened. */
  live?: { address: Address; count: number };
  /** Thief attempts sent on purpose by the keeper. Each one reverts on chain. */
  attacks?: { circle: Address; round: number; kind: string; thief: Address; tx: string; status: string; at: string }[];
}

export function readDeployments(): Deployments {
  if (!existsSync(CONFIG.deploymentsFile)) {
    return { network: CONFIG.chainId, chainId: CONFIG.evmChainId, fusd: CONFIG.fusd };
  }
  return JSON.parse(readFileSync(CONFIG.deploymentsFile, "utf8")) as Deployments;
}

export function writeDeployments(d: Deployments): void {
  mkdirSync(dirname(CONFIG.deploymentsFile), { recursive: true });
  writeFileSync(CONFIG.deploymentsFile, JSON.stringify(d, null, 2) + "\n");
}
