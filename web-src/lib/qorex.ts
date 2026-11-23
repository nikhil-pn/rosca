/**
 * QoreX, QoreChain's own wallet, through its native provider (`window.qorex.native`).
 *
 * Rosca keeps the member's keys on the device; QoreX is used to fund that wallet in one approval. The page
 * hands QoreX a bank `MsgSend`; QoreX shows it, sets the fee, adds the hybrid secp256k1 + ML-DSA-87 signature
 * itself and broadcasts. Its result says whether the committed transaction carries the post-quantum layer.
 */
import { getQorexNative, hasCapability, qorexSignAndBroadcast, type QorexSignAndBroadcastResult } from "@qorechain/qorex-types";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { NET } from "./qore.ts";

/** QoreX is installed in this browser and can sign and broadcast QoreChain transactions. */
export function qorexReady(): boolean {
  return hasCapability(getQorexNative(), "signAndBroadcast");
}

/** Send test QOR and fUSD from the user's QoreX account to `to` (this app's wallet). */
export async function fundFromQorex(to: string, uqor: bigint, fusd: bigint): Promise<QorexSignAndBroadcastResult & { from: string }> {
  const native = getQorexNative();
  if (!native) throw new Error("QoreX is not installed in this browser");
  await native.enable(NET.chainId);
  const from = (await native.getKey(NET.chainId)).bech32Address;
  const amount = [{ denom: "uqor", amount: uqor.toString() }];
  if (fusd > 0n) amount.push({ denom: NET.fusdDenom, amount: fusd.toString() });
  const value = MsgSend.encode(MsgSend.fromPartial({ fromAddress: from, toAddress: to, amount })).finish();
  const res = await qorexSignAndBroadcast({
    chainId: NET.chainId,
    messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value }],
    memo: "Fund my Rosca wallet",
  });
  if (res.code !== 0) throw new Error(`QoreX transaction ${res.txHash} failed (code ${res.code})`);
  return { ...res, from };
}
