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
