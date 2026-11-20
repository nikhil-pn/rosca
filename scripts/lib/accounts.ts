/**
 * Throwaway testnet accounts for the deployer and the demo members.
 * Each is an Ethereum-type (coin type 60) account, so it can send EVM transactions,
 * with an ML-DSA-87 key derived from the same mnemonic.
 */
import { generateMnemonic, deriveUnifiedAccount, type UnifiedAccount } from "@qorechain/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG } from "./config.ts";

export type Role = "deployer" | `member-${number}`;

interface SecretsFile {
  note: string;
  accounts: Record<string, string>;
}

function read(): SecretsFile {
  if (!existsSync(CONFIG.secretsFile)) {
    return { note: "Throwaway QoreChain testnet keys for Rosca. Never use on mainnet.", accounts: {} };
  }
  return JSON.parse(readFileSync(CONFIG.secretsFile, "utf8")) as SecretsFile;
}

function write(s: SecretsFile): void {
  mkdirSync(dirname(CONFIG.secretsFile), { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG.secretsFile, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  chmodSync(CONFIG.secretsFile, 0o600);
}

/** Create the named accounts that do not exist yet. Existing ones are never replaced. */
export function ensureAccounts(roles: Role[]): void {
  const s = read();
  let changed = false;
  for (const role of roles) {
    if (!s.accounts[role]) {
      s.accounts[role] = generateMnemonic();
      changed = true;
    }
  }
  if (changed) write(s);
}

export async function account(role: Role): Promise<UnifiedAccount> {
  const mnemonic = read().accounts[role];
  if (!mnemonic) throw new Error(`no account "${role}" yet: run \`npm run rosca -- accounts\``);
  return deriveUnifiedAccount(mnemonic, 0);
}

export function memberRoles(count: number): Role[] {
  return Array.from({ length: count }, (_, i) => `member-${i + 1}` as Role);
}
