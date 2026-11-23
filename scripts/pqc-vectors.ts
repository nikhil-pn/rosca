/**
 * Real ML-DSA-87 signatures against QoreChain's live pqcVerify precompile (0x…0A01).
 *
 * The Foundry tests replace the precompile with a mock, because Foundry cannot run QoreChain's
 * precompiles. This script is the other half: it makes real ML-DSA-87 keys and signatures with the SDK and
 * asks the testnet itself, through eth_call, whether each one verifies. It also reads a demo member's
 * registered key through pqcKeyStatus (0x…0A02), the call RoscaCircle makes before every bid and payout.
 *
 *   npx tsx scripts/pqc-vectors.ts          # prints the results and writes docs/PQC_VECTORS.md
 *
 * The vectors (keys, messages, signatures) are written to test/vectors/mldsa87.json so anyone can rerun them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { generatePqcKeypair, pqcSign, pqcVerify as localVerify } from "@qorechain/sdk";
import { bytesToHex, encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import { account } from "./lib/accounts.ts";
import { publicClient } from "./lib/evm.ts";

const VERIFY = "0x0000000000000000000000000000000000000a01" as Address;
const KEY_STATUS = "0x0000000000000000000000000000000000000a02" as Address;
const ABI = [
  { type: "function", name: "pqcVerify", stateMutability: "view", inputs: [{ name: "pubkey", type: "bytes" }, { name: "signature", type: "bytes" }, { name: "message", type: "bytes" }], outputs: [{ name: "valid", type: "bool" }] },
  { type: "function", name: "pqcKeyStatus", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "registered", type: "bool" }, { name: "algorithmId", type: "uint8" }, { name: "pubkey", type: "bytes" }, { name: "possessionProven", type: "bool" }] },
] as const;

const flip = (b: Uint8Array, i: number) => {
  const c = Uint8Array.from(b);
  c[i] ^= 0x01;
  return c;
};

async function chainVerify(pk: Uint8Array, sig: Uint8Array, msg: Uint8Array): Promise<string> {
  try {
    const ok = await publicClient.readContract({ address: VERIFY, abi: ABI, functionName: "pqcVerify", args: [bytesToHex(pk), bytesToHex(sig), bytesToHex(msg)] });
    return ok ? "true" : "false";
  } catch (e) {
    return `reverted (${String((e as { shortMessage?: string }).shortMessage ?? e).split("\n")[0].slice(0, 80)})`;
  }
}

const a = generatePqcKeypair();
const b = generatePqcKeypair();
// The kind of bytes a winner signs: a Rosca payout message (tag, chain id, circle, round, recipient, amount, deadline).
const message = toBytes(
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
    [keccak256(toBytes("ROSCA-PAYOUT-V1")), 9800n, "0x0000000000000000000000000000000000000001", 1n, "0x000000000000000000000000000000000000beef", 22_500_000n, 1_900_000_000n],
  ),
);
const sig = pqcSign(a.secretKey, message);
const sigB = pqcSign(b.secretKey, message);

const cases: { name: string; pk: Uint8Array; sig: Uint8Array; msg: Uint8Array; expect: string }[] = [
  { name: "Valid signature, right key, right message", pk: a.publicKey, sig, msg: message, expect: "true" },
  { name: "Message changed by one bit (e.g. a different recipient)", pk: a.publicKey, sig, msg: flip(message, message.length - 40), expect: "false" },
  { name: "Signature changed by one bit", pk: a.publicKey, sig: flip(sig, 100), msg: message, expect: "false" },
  { name: "Someone else's key signed it (a thief's own ML-DSA-87 key)", pk: a.publicKey, sig: sigB, msg: message, expect: "false" },
  { name: "Signature cut short (4,626 of 4,627 bytes)", pk: a.publicKey, sig: sig.slice(0, sig.length - 1), msg: message, expect: "false" },
];

const block = await publicClient.getBlockNumber();
const rows: string[] = [];
let allMatch = true;
for (const c of cases) {
  const got = await chainVerify(c.pk, c.sig, c.msg);
  const local = localVerify(c.pk, c.msg, c.sig) ? "true" : "false";
  const ok = got === c.expect || (c.expect === "false" && got.startsWith("reverted"));
  allMatch &&= ok;
  rows.push(`| ${c.name} | ${c.expect} | **${got}** | ${local} | ${ok ? "✓" : "✗"} |`);
  console.log(`${ok ? "✓" : "✗"} ${c.name}: chain=${got} sdk=${local} (expected ${c.expect})`);
}

// The registered key of a demo member, as RoscaCircle reads it.
const m = await account("member-1");
const [registered, algorithmId, pubkey, possessionProven] = await publicClient.readContract({ address: KEY_STATUS, abi: ABI, functionName: "pqcKeyStatus", args: [m.evm as Address] });
const matches = pubkey.toLowerCase() === bytesToHex(m.pqc.publicKey).toLowerCase();
console.log(`pqcKeyStatus(${m.evm}): registered=${registered} algorithm=${algorithmId} key=${(pubkey.length - 2) / 2} bytes possession=${possessionProven} matches member's key=${matches}`);

mkdirSync("test/vectors", { recursive: true });
writeFileSync(
  "test/vectors/mldsa87.json",
  JSON.stringify({ note: "Real ML-DSA-87 vectors for scripts/pqc-vectors.ts", block: Number(block), pubkey: bytesToHex(a.publicKey), otherPubkey: bytesToHex(b.publicKey), message: bytesToHex(message), signature: bytesToHex(sig), otherSignature: bytesToHex(sigB) }, null, 1) + "\n",
);
writeFileSync(
  "docs/PQC_VECTORS.md",
  `# Real ML-DSA-87 signatures against the live precompile

The Foundry tests replace QoreChain's \`pqcVerify\` precompile with a mock, because Foundry cannot run QoreChain's
precompiles. This page is the other half: real ML-DSA-87 keys and signatures, made with \`@qorechain/sdk\`, sent to the
**live** precompile \`0x…0A01\` on \`qorechain-diana\` through \`eth_call\`. Every result is compared with the SDK's own
verifier. Reproduce it with \`npx tsx scripts/pqc-vectors.ts\`; the vectors are in
[\`test/vectors/mldsa87.json\`](../test/vectors/mldsa87.json).

Run at testnet block ${block.toLocaleString("en-US")} on ${new Date().toISOString().slice(0, 10)}. Key: ${a.publicKey.length.toLocaleString("en-US")} bytes, signature: ${sig.length.toLocaleString("en-US")} bytes (FIPS 204, ML-DSA-87).

| Case | Expected | Live precompile | SDK verify | Match |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

${allMatch ? "Every case matches: the precompile accepts exactly the valid signature and refuses every altered one." : "**At least one case did not match; see above.**"}

## The registered key RoscaCircle reads

\`pqcKeyStatus(${m.evm})\` (demo member Anu) on the live precompile \`0x…0A02\`:

| Field | Value |
| --- | --- |
| registered | ${registered} |
| algorithmId | ${algorithmId} (1 = ML-DSA-87) |
| public key | ${(pubkey.length - 2) / 2} bytes, ${matches ? "identical to the member's own ML-DSA-87 key" : "**different from the member's key**"} |
| possessionProven | ${possessionProven} |

\`PqcGate.registeredKey\` requires all four (registered, algorithm 1, 2,592 bytes, possession proven) before it checks a
bid or a payout signature against this key.
`,
);
console.log(allMatch ? "all cases match" : "MISMATCH");
