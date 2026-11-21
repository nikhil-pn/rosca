/**
 * Rosca command line, for the QoreChain testnet.
 *
 *   npm run rosca -- accounts [members]      create the deployer and N member accounts (default 5)
 *   npm run rosca -- fund [members]          funder sends test QOR and fUSD to them
 *   npm run rosca -- register [members]      each account registers its ML-DSA-87 key (with proof of possession)
 *   npm run rosca -- deploy                  deploy RoscaFactory (unscoped window: a deploy cannot be scoped)
 *   npm run rosca -- status [members]        balances, PQC keys and windows
 *
 * Keys are throwaway testnet keys kept in ~/.config/rosca/accounts.json (outside the repo).
 * The funder is a QoreX wallet: set ROSCA_FUNDER_ENV to a file holding its QOREX_RECOVERY_PHRASE.
 */
import {
  buildRegisterPqcKeyMsg,
  fetchPqcStatus,
  isRegisteredPqcKey,
  signProofOfPossession,
} from "@qorechain/sdk";
import type { Address } from "viem";
import { CONFIG } from "./lib/config.ts";
import { account, ensureAccounts, memberRoles, type Role } from "./lib/accounts.ts";
import { broadcastAs, fundFusd, fundQor } from "./lib/native.ts";
import { readDeployments, writeDeployments } from "./lib/deployments.ts";
import { artifact, ensureWindow, publicClient, walletFor, qorechainTestnet } from "./lib/evm.ts";

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

function roles(arg?: string): Role[] {
  const n = Number(arg ?? "5");
  return ["deployer", ...memberRoles(n)];
}

const fmt = (v: bigint, d: number) => (Number(v) / 10 ** d).toLocaleString("en-IN", { maximumFractionDigits: 4 });

const commands: Record<string, (arg?: string) => Promise<void>> = {
  async accounts(arg) {
    const all = roles(arg);
    ensureAccounts(all);
    for (const r of all) {
      const a = await account(r);
      console.log(`${r.padEnd(10)} ${a.evm}  ${a.cosmos}`);
    }
  },

  async fund(arg) {
    for (const r of roles(arg)) {
      const a = await account(r);
      const qor = r === "deployer" ? 8_000_000n : 4_000_000n; // uqor: 8 or 4 test QOR
      console.log(`${r}: QOR ${await fundQor(a.cosmos, qor)}`);
      if (r !== "deployer") {
        const fusd = 60n * 10n ** BigInt(CONFIG.fusdDecimals); // 60 fUSD
        console.log(`${r}: fUSD ${await fundFusd(a.evm, fusd)}`);
      }
    }
  },

  async register(arg) {
    for (const r of roles(arg)) {
      const a = await account(r);
      const status = await fetchPqcStatus({ rest: CONFIG.rest, address: a.cosmos });
      if (status.registered && isRegisteredPqcKey(status, a.pqc.publicKey)) {
        console.log(`${r}: key already registered`);
        continue;
      }
      const proofOfPossession = signProofOfPossession({ chainId: CONFIG.chainId, account: a.cosmos, keypair: a.pqc });
      const msg = buildRegisterPqcKeyMsg(a.cosmos, { pqcKeypair: a.pqc, proofOfPossession });
      console.log(`${r}: registered ${await broadcastAs(a, "classical", [msg])}`);
    }
  },

  /** `deploy` opens the first factory. `deploy "<why>"` retires the current one (its circles keep
   * working and stay listed in olderFactories) and opens a new one, e.g. after a contract fix. */
  async deploy(arg) {
    const d = readDeployments();
    if (d.factory && !arg) {
      console.log(`RoscaFactory already at ${d.factory}; pass a reason to open a new one`);
      return;
    }
    if (d.factory && d.factoryTx) {
      d.olderFactories = [...(d.olderFactories ?? []), { address: d.factory, tx: d.factoryTx, note: arg! }];
    }
    const acc = await account("deployer");
    await ensureWindow(acc, []);
    const { abi, bytecode } = artifact("RoscaFactory");
    const wallet = walletFor(acc);
    const hash = await wallet.deployContract({ abi, bytecode, chain: qorechainTestnet, gas: 5_000_000n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`deploy failed: ${hash}`);
    d.factory = receipt.contractAddress;
    d.factoryTx = hash;
    writeDeployments(d);
    console.log(`RoscaFactory ${d.factory}  (tx ${hash})`);
  },

  async status(arg) {
    for (const r of roles(arg)) {
      const a = await account(r);
      const qor = await publicClient.getBalance({ address: a.evm as Address });
      const fusd = (await publicClient.readContract({
        address: CONFIG.fusd,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [a.evm as Address],
      })) as bigint;
      const pqc = await fetchPqcStatus({ rest: CONFIG.rest, address: a.cosmos });
      console.log(
        `${r.padEnd(10)} ${a.evm}  QOR ${fmt(qor, 18).padStart(8)}  fUSD ${fmt(fusd, 6).padStart(6)}  PQC ${pqc.registered ? "yes" : "no"}`,
      );
    }
  },
};

const [cmd, arg] = process.argv.slice(2);
const run = cmd ? commands[cmd] : undefined;
if (!run) {
  console.error(`Use one of: ${Object.keys(commands).join(" | ")}`);
  process.exit(1);
}
run(arg).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
