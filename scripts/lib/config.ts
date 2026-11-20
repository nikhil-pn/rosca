/**
 * Network settings for the Rosca scripts. Testnet only.
 */
import { getNetwork } from "@qorechain/sdk";
import { homedir } from "node:os";
import { join } from "node:path";

const net = getNetwork("testnet");

export const CONFIG = {
  /** Native chain id (Cosmos lane). */
  chainId: net.chainId,
  /** EVM chain id. */
  evmChainId: 9800,
  rest: process.env.QORE_REST_URL?.trim() || net.endpoints.rest,
  rpc: process.env.QORE_RPC_URL?.trim() || net.endpoints.rpc,
  evmRpc: process.env.QORE_EVM_RPC_URL?.trim() || "https://evm-testnet.qore.host",
  explorer: "https://explore.qore.network",
  /** fUSD, the fest's test dollar (ERC-20, 6 decimals). */
  fusd: "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const,
  fusdDecimals: 6,
  /** Bank denom of fUSD on the native lane (converted to ERC-20 with MsgConvertCoin). */
  fusdDenom: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA",
  /** Where throwaway testnet keys live. Never inside the repository. */
  secretsFile: process.env.ROSCA_SECRETS?.trim() || join(homedir(), ".config", "rosca", "accounts.json"),
  /** Deployed addresses, committed so the web app and judges can find them. */
  deploymentsFile: join(import.meta.dirname, "..", "..", "deployments", "testnet.json"),
} as const;
