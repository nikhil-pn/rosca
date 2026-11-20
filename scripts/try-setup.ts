/**
 * One-time setup for "Try it yourself": a faucet account (gives each visitor test QOR and fUSD from the
 * website) and two bots that join visitors' circles. All throwaway testnet keys in ~/.config/rosca/.
 *
 *   ROSCA_FUNDER_ENV=~/.config/pi/qorex.env npx tsx scripts/try-setup.ts
 */
import { buildRegisterPqcKeyMsg, fetchPqcStatus, isRegisteredPqcKey, signProofOfPossession } from "@qorechain/sdk";
import { account, ensureAccounts, type Role } from "./lib/accounts.ts";
import { CONFIG } from "./lib/config.ts";
import { broadcastAs, fundBankFusd, fundFusd, fundQor } from "./lib/native.ts";

const UNIT = 10n ** BigInt(CONFIG.fusdDecimals);
const plan: { role: Role; uqor: bigint; fusd?: bigint; bankFusd?: bigint }[] = [
  { role: "faucet" as Role, uqor: 20_000_000n, bankFusd: 300n * UNIT },
  { role: "bot-1" as Role, uqor: 6_000_000n, fusd: 60n * UNIT },
  { role: "bot-2" as Role, uqor: 6_000_000n, fusd: 60n * UNIT },
];

ensureAccounts(plan.map((p) => p.role));
for (const p of plan) {
  const a = await account(p.role);
  console.log(`${p.role}: ${a.evm} ${a.cosmos}`);
  console.log(`  QOR ${await fundQor(a.cosmos, p.uqor)}`);
  if (p.fusd) console.log(`  fUSD ${await fundFusd(a.evm, p.fusd)}`);
  if (p.bankFusd) console.log(`  bank fUSD ${await fundBankFusd(a.cosmos, p.bankFusd)}`);
  await new Promise((r) => setTimeout(r, 6000));
  const status = await fetchPqcStatus({ rest: CONFIG.rest, address: a.cosmos });
  if (status.registered && isRegisteredPqcKey(status, a.pqc.publicKey)) continue;
  const proofOfPossession = signProofOfPossession({ chainId: CONFIG.chainId, account: a.cosmos, keypair: a.pqc });
  const msg = buildRegisterPqcKeyMsg(a.cosmos, { pqcKeypair: a.pqc, proofOfPossession });
  console.log(`  ML-DSA-87 key registered ${await broadcastAs(a, "classical", [msg])}`);
}
