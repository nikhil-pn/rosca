/**
 * QoreChain testnet plumbing shared by the browser app and the faucet function.
 *
 * Native-lane transactions are broadcast over REST (`/cosmos/tx/v1beta1/txs`), so nothing needs the
 * Tendermint RPC. In the browser the REST base is `/api/rest`, which Vercel rewrites to the testnet API
 * (the API sends no CORS headers). The EVM JSON-RPC allows browsers, so it is used directly.
 */
import { BinaryReader, BinaryWriter } from "cosmjs-types/binary";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";
import type { EncodeObject, GeneratedType } from "@cosmjs/proto-signing";
import { EthNativeSigner, qorechainRegistry, type UnifiedAccount } from "@qorechain/sdk";

export const NET = {
  chainId: "qorechain-diana",
  evmChainId: 9800,
  evmRpc: "https://evm-testnet.qore.host",
  explorer: "https://explore.qore.network",
  /** Factory v2, with the audit fixes. New circles open here. */
  factory: "0x29053772f08c30c682e0fbb5db3a3d86ac84afef" as const,
  /** The first factory; its circles can still be joined and played. */
  factoryV1: "0x366d6a029d94a98ba4d93e2eb4dbf07720387d39" as const,
  fusd: "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const,
  fusdDecimals: 6,
  fusdDenom: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA",
} as const;

/** Hybrid transactions are large, so the gas limit is generous. */
const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };

// ---------------------------------------------------------------- MsgConvertCoin (bank fUSD -> ERC-20)

export const CONVERT_COIN_TYPE_URL = "/cosmos.evm.erc20.v1.MsgConvertCoin";

interface MsgConvertCoin {
  coin: Coin;
  receiver: string;
  sender: string;
}

const MsgConvertCoinType = {
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

export const registry = () => qorechainRegistry([[CONVERT_COIN_TYPE_URL, MsgConvertCoinType]]);

export function convertCoinMsg(sender: string, receiverEvm: string, amount: bigint): EncodeObject {
  return {
    typeUrl: CONVERT_COIN_TYPE_URL,
    value: { coin: { denom: NET.fusdDenom, amount: amount.toString() }, receiver: receiverEvm, sender },
  };
}

// ---------------------------------------------------------------- REST helpers

export async function getJson<T>(rest: string, path: string): Promise<T | null> {
  const res = await fetch(rest + path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function accountSequence(rest: string, address: string) {
  const body = await getJson<{ account?: Record<string, unknown> }>(rest, `/cosmos/auth/v1beta1/accounts/${address}`);
  if (!body) throw new Error(`${address} does not exist on chain yet: it needs some QOR first`);
  const acc = ((body.account as Record<string, unknown>)?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

export async function balances(rest: string, address: string): Promise<Record<string, bigint>> {
  const body = await getJson<{ balances: { denom: string; amount: string }[] }>(rest, `/cosmos/bank/v1beta1/balances/${address}`);
  return Object.fromEntries((body?.balances ?? []).map((b) => [b.denom, BigInt(b.amount)]));
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

/** A transport for EthNativeSigner that broadcasts over REST and waits until the tx is in a block. */
export function restTransport(rest: string) {
  return {
    async broadcastTx(txRaw: Uint8Array) {
      const res = await fetch(rest + "/cosmos/tx/v1beta1/txs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx_bytes: b64(txRaw), mode: "BROADCAST_MODE_SYNC" }),
      });
      const body = (await res.json()) as { tx_response?: { code: number; txhash: string; raw_log: string; codespace?: string } };
      const sync = body.tx_response;
      if (!sync) throw new Error(`broadcast failed: HTTP ${res.status}`);
      if (sync.code !== 0) return { code: sync.code, codespace: sync.codespace, transactionHash: sync.txhash, rawLog: sync.raw_log };
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const tx = await getJson<{ tx_response: { code: number; raw_log: string; codespace?: string } }>(rest, `/cosmos/tx/v1beta1/txs/${sync.txhash}`).catch(() => null);
        if (tx?.tx_response) {
          return { code: tx.tx_response.code, codespace: tx.tx_response.codespace, transactionHash: sync.txhash, rawLog: tx.tx_response.raw_log };
        }
      }
      throw new Error(`tx ${sync.txhash} was not included in a block within 60 s`);
    },
  };
}

/** Sign (classical or hybrid secp256k1 + ML-DSA-87) and broadcast native messages from `acc`. */
export async function broadcastAs(rest: string, acc: UnifiedAccount, mode: "hybrid" | "classical", messages: EncodeObject[]): Promise<string> {
  const { accountNumber, sequence } = await accountSequence(rest, acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest, registry: registry() });
  const res = await signer.signAndBroadcast(restTransport(rest) as never, {
    chainId: NET.chainId,
    accountNumber,
    sequence,
    fee: FEE,
    messages: messages as never,
  });
  if (res.code !== 0) throw new Error(`tx ${res.transactionHash} failed (code ${res.code}): ${res.rawLog}`);
  return res.transactionHash;
}
