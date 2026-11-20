/**
 * Native-lane (Cosmos) transactions, signed hybrid: secp256k1 + ML-DSA-87.
 *
 * Two kinds of signer:
 * - the demo accounts (Ethereum-type, coin type 60), through EthNativeSigner;
 * - the funder: a QoreX wallet (native, coin type 118), through the SDK's TxClient.
 */
import { StargateClient } from "@cosmjs/stargate";
import type { EncodeObject, GeneratedType } from "@cosmjs/proto-signing";
import { BinaryWriter, BinaryReader } from "cosmjs-types/binary";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";
import {
  EthNativeSigner,
  createClient,
  deriveNativeAccount,
  derivePqcCanonical,
  directSignerFromPrivateKey,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { readFileSync } from "node:fs";
import { CONFIG } from "./config.ts";

/** Hybrid transactions are large, so the gas limit is generous. */
const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };

async function accountSequence(address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const res = await fetch(`${CONFIG.rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) throw new Error(`${address} does not exist on chain yet: send it some QOR first`);
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

/** Sign and broadcast native messages from a demo account. Registration of the PQC key is
 * the one message the chain accepts signed classically; everything else goes hybrid. */
export async function broadcastAs(
  acc: UnifiedAccount,
  mode: "hybrid" | "classical",
  messages: EncodeObject[],
): Promise<string> {
  const { accountNumber, sequence } = await accountSequence(acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: CONFIG.rest });
  const transport = await StargateClient.connect(CONFIG.rpc);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: CONFIG.chainId,
      accountNumber,
      sequence,
      fee: FEE,
      messages: messages as Parameters<EthNativeSigner["sign"]>[0]["messages"],
    });
    if (res.code !== 0) throw new Error(`tx ${res.transactionHash} failed (code ${res.code}): ${res.rawLog}`);
    return res.transactionHash;
  } finally {
    transport.disconnect();
  }
}

// ---------------------------------------------------------------- fUSD bank coin -> ERC-20

/** cosmos/evm `MsgConvertCoin`: turns a bank coin of an ERC-20 token back into ERC-20 at `receiver`. */
export const CONVERT_COIN_TYPE_URL = "/cosmos.evm.erc20.v1.MsgConvertCoin";

interface MsgConvertCoin {
  coin: Coin;
  receiver: string;
  sender: string;
}

const MsgConvertCoinType: GeneratedType = {
  encode(m: MsgConvertCoin, w: BinaryWriter = BinaryWriter.create()) {
    if (m.coin) Coin.encode(m.coin, w.uint32(10).fork()).ldelim();
    if (m.receiver) w.uint32(18).string(m.receiver);
    if (m.sender) w.uint32(26).string(m.sender);
    return w;
  },
  decode(input: Uint8Array | BinaryReader) {
    const r = input instanceof BinaryReader ? input : new BinaryReader(input);
    const m: MsgConvertCoin = { coin: Coin.fromPartial({}), receiver: "", sender: "" };
    while (r.pos < r.len) {
      const tag = r.uint32();
      if (tag >>> 3 === 1) m.coin = Coin.decode(r, r.uint32());
      else if (tag >>> 3 === 2) m.receiver = r.string();
      else if (tag >>> 3 === 3) m.sender = r.string();
      else r.skipType(tag & 7);
    }
    return m;
  },
  fromPartial(o: Partial<MsgConvertCoin>) {
    return { coin: Coin.fromPartial(o.coin ?? {}), receiver: o.receiver ?? "", sender: o.sender ?? "" };
  },
} as unknown as GeneratedType;

// ---------------------------------------------------------------- the funder (a QoreX wallet)

function funderMnemonic(): string {
  const direct = process.env.ROSCA_FUNDER_MNEMONIC?.trim();
  if (direct) return direct;
  const file = process.env.ROSCA_FUNDER_ENV?.trim();
  if (!file) throw new Error("set ROSCA_FUNDER_MNEMONIC or ROSCA_FUNDER_ENV (a file with QOREX_RECOVERY_PHRASE=...)");
  const m = readFileSync(file, "utf8").match(/QOREX_RECOVERY_PHRASE="?([a-z ]+)"?/);
  if (!m) throw new Error(`no QOREX_RECOVERY_PHRASE in ${file}`);
  return m[1].trim();
}

/** A hybrid-signing client for the funder's QoreX (native) account. */
export async function funder() {
  const mnemonic = funderMnemonic();
  const native = await deriveNativeAccount(mnemonic);
  const signer = await directSignerFromPrivateKey(native.privateKey, "qor");
  const pqcKeypair = derivePqcCanonical(native.address, mnemonic);
  const client = createClient({
    network: "testnet",
    endpoints: { rest: CONFIG.rest, rpc: CONFIG.rpc, evmRpc: CONFIG.evmRpc },
  });
  const tx = await client.connectTx(signer, {
    pqcKeypair,
    registryTypes: [[CONVERT_COIN_TYPE_URL, MsgConvertCoinType]],
  } as Parameters<typeof client.connectTx>[1]);
  return { address: native.address, tx };
}

/** Send QOR (in uqor) from the funder to a native address. */
export async function fundQor(to: string, uqor: bigint): Promise<string> {
  const f = await funder();
  try {
    const res = await f.tx.bankSend(to, [{ denom: "uqor", amount: uqor.toString() }]);
    return res.transactionHash;
  } finally {
    f.tx.disconnect();
  }
}

/** Convert the funder's fUSD bank coin into ERC-20 fUSD at an EVM address. */
export async function fundFusd(toEvm: string, amount: bigint): Promise<string> {
  const f = await funder();
  try {
    const msg: EncodeObject = {
      typeUrl: CONVERT_COIN_TYPE_URL,
      value: { coin: { denom: CONFIG.fusdDenom, amount: amount.toString() }, receiver: toEvm, sender: f.address },
    };
    const res = await f.tx.signAndBroadcast([msg], "auto");
    return res.transactionHash;
  } finally {
    f.tx.disconnect();
  }
}
