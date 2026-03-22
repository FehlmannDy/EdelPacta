import { Client, Wallet } from "xrpl";
import * as keypairs from "ripple-keypairs";
import { XrplDefinitions, encode, encodeForSigning } from "ripple-binary-codec";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { resolve } from "path";
import logger from "../logger";

const ENDPOINT = process.env.XRPL_NETWORK ?? "wss://wasm.devnet.rippletest.net:51233";
const NETWORK_ID = 2002;

const WASM_PATH =
  process.env.ESCROW_WASM_PATH ??
  resolve(process.cwd(), "../contract/my_contract_devnet.wasm");

// ─── Custom Codec (FinishFunction, ComputationAllowance, etc.) ────────────────

const rawDefs = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "node_modules/ripple-binary-codec/dist/enums/definitions.json"),
    "utf8"
  )
) as Record<string, unknown>;

const customDefs = new XrplDefinitions({
  ...(rawDefs as object),
  TRANSACTION_TYPES: {
    ...(rawDefs["TRANSACTION_TYPES"] as object),
    CredentialCreate: 58,
    CredentialAccept: 59,
    CredentialDelete: 60,
  },
  FIELDS: [
    ...((rawDefs["FIELDS"] as unknown[]) ?? []),
    ["FinishFunction",       { nth: 32, isVLEncoded: true,  isSerialized: true, isSigningField: true, type: "Blob"      }],
    ["ComputationAllowance", { nth: 72, isVLEncoded: false, isSerialized: true, isSigningField: true, type: "UInt32"    }],
    ["Subject",              { nth: 24, isVLEncoded: true,  isSerialized: true, isSigningField: true, type: "AccountID" }],
    ["CredentialType",       { nth: 31, isVLEncoded: true,  isSerialized: true, isSigningField: true, type: "Blob"      }],
    ["URI",                  { nth: 5,  isVLEncoded: true,  isSerialized: true, isSigningField: true, type: "Blob"      }],
  ],
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toHex(str: string): string {
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}

function signCustomTx(
  txObj: Record<string, unknown>,
  wallet: Wallet
): { tx_blob: string; hash: string } {
  const txForSigning = { ...txObj, SigningPubKey: wallet.publicKey };
  const signingHex = encodeForSigning(txForSigning, customDefs);
  const sig = keypairs.sign(signingHex, wallet.privateKey);
  const tx_blob = encode({ ...txForSigning, TxnSignature: sig }, customDefs);
  const hash = createHash("sha512")
    .update(Buffer.from("54584E00" + tx_blob, "hex"))
    .digest()
    .slice(0, 32)
    .toString("hex")
    .toUpperCase();
  return { tx_blob, hash };
}

async function autofillBase(
  client: Client,
  account: string
): Promise<{ sequence: number; medianFee: number; lastLedger: number }> {
  const [accInfo, feeInfo, ledgerInfo] = await Promise.all([
    client.request({ command: "account_info", account, ledger_index: "current" }),
    client.request({ command: "fee" }),
    client.request({ command: "ledger", ledger_index: "validated" }),
  ]);
  return {
    sequence: (accInfo.result.account_data as { Sequence: number }).Sequence,
    medianFee: Number(
      ((feeInfo.result as Record<string, unknown>)["drops"] as Record<string, string>)["median_fee"]
    ),
    lastLedger: ((ledgerInfo.result as Record<string, unknown>)["ledger_index"] as number) + 100,
  };
}

async function submitAndCheck(
  client: Client,
  tx_blob: string,
  label: string
): Promise<{ ok: boolean; engineResult: string; hash?: string }> {
  const result = await client.request({ command: "submit", tx_blob });
  const res = result.result as Record<string, unknown>;
  const eng = res["engine_result"] as string;
  const ok = eng.startsWith("tes") || eng === "terQUEUED";
  const hash = ((res["tx_json"] as Record<string, unknown> | undefined) ?? {})["hash"] as
    | string
    | undefined;
  if (ok) {
    logger.info({ label, eng, hash }, "escrow: tx submitted");
  } else {
    logger.error(
      { label, eng, message: res["engine_result_message"] },
      "escrow: tx rejected"
    );
  }
  return { ok, engineResult: eng, hash };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getXrpBalance(client: Client, address: string): Promise<string> {
  try {
    const r = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    const balance = (r.result.account_data as { Balance: string }).Balance;
    return (Number(balance) / 1e6).toFixed(2) + " XRP";
  } catch (_) {
    return "0.00 XRP";
  }
}

// ─── Wallet helpers ───────────────────────────────────────────────────────────

export function getOracleWallet(): Wallet {
  const seed = process.env.ORACLE_SEED;
  if (!seed) throw new Error("ORACLE_SEED not configured");
  return Wallet.fromSeed(seed);
}

export function getNotaireWallet(): Wallet {
  const seed = process.env.ISSUER_SEED;
  if (!seed) throw new Error("ISSUER_SEED not configured");
  return Wallet.fromSeed(seed);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getBuyerInfo(buyerSeed: string): Promise<{ address: string; balance: string }> {
  const buyer = Wallet.fromSeed(buyerSeed);
  const client = new Client(ENDPOINT);
  await client.connect();
  try {
    const balance = await getXrpBalance(client, buyer.address);
    return { address: buyer.address, balance };
  } finally {
    await client.disconnect();
  }
}

export interface CreateEscrowParams {
  buyerSeed: string;
  sellerAddress: string;
  nftId: string;
  amountRlusd: number;
}

export interface CreateEscrowResult {
  escrowSequence: number;
  hash: string;
  buyerAddress: string;
  cancelAfter: number;
}

export async function createEscrow(params: CreateEscrowParams): Promise<CreateEscrowResult> {
  const { buyerSeed, sellerAddress, nftId, amountRlusd } = params;
  const buyer = Wallet.fromSeed(buyerSeed);

  const wasmHex = readFileSync(WASM_PATH).toString("hex").toUpperCase();
  logger.info(
    { wasmBytes: wasmHex.length / 2, buyerAddress: buyer.address, sellerAddress, nftId, amountRlusd },
    "escrow: creating"
  );

  const client = new Client(ENDPOINT);
  await client.connect();

  try {
    const { sequence, medianFee, lastLedger } = await autofillBase(client, buyer.address);
    const txBlocks = Math.ceil((wasmHex.length / 2 + 200) / 512);
    const txFee = String(Math.max(medianFee * txBlocks, 50000));
    const cancelAfter = Math.floor(Date.now() / 1000) - 946684800 + 3600;

    const tx: Record<string, unknown> = {
      TransactionType: "EscrowCreate",
      Account: buyer.address,
      Destination: sellerAddress,
      Amount: String(Math.round(amountRlusd * 1_000_000)),
      CancelAfter: cancelAfter,
      FinishFunction: wasmHex,
      Flags: 0,
      Sequence: sequence,
      LastLedgerSequence: lastLedger,
      Fee: txFee,
      NetworkID: NETWORK_ID,
    };

    const { tx_blob, hash } = signCustomTx(tx, buyer);
    const { ok } = await submitAndCheck(client, tx_blob, "EscrowCreate");
    if (!ok) throw new Error("EscrowCreate rejected by ledger");

    await sleep(5000);
    logger.info({ escrowSequence: sequence, hash }, "escrow: created");

    return { escrowSequence: sequence, hash, buyerAddress: buyer.address, cancelAfter };
  } finally {
    await client.disconnect();
  }
}

export interface FinishEscrowParams {
  buyerAddress: string;
  escrowSequence: number;
  nftId: string;
  offerSequence: number;
}

export interface FinishEscrowResult {
  hash: string;
}

export async function finishEscrow(params: FinishEscrowParams): Promise<FinishEscrowResult> {
  const { buyerAddress, escrowSequence, nftId, offerSequence } = params;
  const notaire = getNotaireWallet();
  const oracle = getOracleWallet();

  logger.info({ buyerAddress, escrowSequence, nftId, offerSequence }, "escrow: finishing");

  // Both notaire and oracle sign the NFT ID
  const msgHex = nftId.toLowerCase();
  const notaireSigHex = keypairs.sign(msgHex, notaire.privateKey);
  const notairePubHex = notaire.publicKey;
  const oracleSigHex = keypairs.sign(msgHex, oracle.privateKey);
  const oraclePubHex = oracle.publicKey;

  const client = new Client(ENDPOINT);
  await client.connect();

  try {
    const { sequence, lastLedger } = await autofillBase(client, notaire.address);

    const offerSeqBuf = Buffer.alloc(4);
    offerSeqBuf.writeUInt32BE(offerSequence);

    const tx: Record<string, unknown> = {
      TransactionType: "EscrowFinish",
      Account: notaire.address,
      Owner: buyerAddress,
      OfferSequence: escrowSequence,
      Flags: 0,
      Sequence: sequence,
      LastLedgerSequence: lastLedger,
      Fee: "2000000",
      ComputationAllowance: 1000000,
      NetworkID: NETWORK_ID,
      Memos: [
        { Memo: { MemoType: toHex("NFT_ID"),        MemoData: nftId.toUpperCase() } },
        { Memo: { MemoType: toHex("NOTARY_SIG"),    MemoData: notaireSigHex.toUpperCase() } },
        { Memo: { MemoType: toHex("NOTARY_PUBKEY"), MemoData: notairePubHex.toUpperCase() } },
        { Memo: { MemoType: toHex("ORACLE_SIG"),    MemoData: oracleSigHex.toUpperCase() } },
        { Memo: { MemoType: toHex("ORACLE_PUBKEY"), MemoData: oraclePubHex.toUpperCase() } },
        { Memo: { MemoType: toHex("OFFER_SEQ"),     MemoData: offerSeqBuf.toString("hex").toUpperCase() } },
      ],
    };

    const { tx_blob, hash } = signCustomTx(tx, notaire);
    const { ok } = await submitAndCheck(client, tx_blob, "EscrowFinish");
    if (!ok) throw new Error("EscrowFinish rejected by ledger");

    await sleep(5000);
    logger.info({ hash }, "escrow: finished");

    return { hash };
  } finally {
    await client.disconnect();
  }
}

export interface AcceptNftParams {
  buyerSeed: string;
  offerId: string;
}

export interface AcceptNftResult {
  txHash: string;
  account: string;
}

export async function acceptNft(params: AcceptNftParams): Promise<AcceptNftResult> {
  const { buyerSeed, offerId } = params;
  const buyer = Wallet.fromSeed(buyerSeed);

  logger.info({ offerId, buyerAddress: buyer.address }, "escrow: accepting NFT offer");

  const client = new Client(ENDPOINT);
  await client.connect();

  try {
    const { sequence, medianFee, lastLedger } = await autofillBase(client, buyer.address);

    const tx: Record<string, unknown> = {
      TransactionType: "NFTokenAcceptOffer",
      Account: buyer.address,
      NFTokenSellOffer: offerId,
      Sequence: sequence,
      LastLedgerSequence: lastLedger,
      Fee: String(Math.max(medianFee, 12)),
      NetworkID: NETWORK_ID,
    };

    const { tx_blob, hash } = signCustomTx(tx, buyer);
    const { ok } = await submitAndCheck(client, tx_blob, "NFTokenAcceptOffer");
    if (!ok) throw new Error("NFTokenAcceptOffer rejected by ledger");

    await sleep(4000);
    logger.info({ hash, account: buyer.address }, "escrow: NFT accepted");

    return { txHash: hash!, account: buyer.address };
  } finally {
    await client.disconnect();
  }
}

export async function getPendingEscrows(address: string): Promise<Record<string, unknown>[]> {
  const client = new Client(ENDPOINT);
  await client.connect();
  try {
    const response = await client.request({
      command: "account_objects",
      account: address,
      type: "escrow",
      ledger_index: "validated",
    });
    return (response.result.account_objects ?? []) as Record<string, unknown>[];
  } catch (_) {
    return [];
  } finally {
    await client.disconnect();
  }
}

export async function getAccountNFTs(
  address: string
): Promise<{ nftokenId: string; uri: string | null }[]> {
  const client = new Client(ENDPOINT);
  await client.connect();
  try {
    const response = await client.request({
      command: "account_nfts",
      account: address,
      ledger_index: "validated",
    });
    return ((response.result as Record<string, unknown>)["account_nfts"] as Record<string, unknown>[] ?? []).map(
      (nft) => ({
        nftokenId: nft["NFTokenID"] as string,
        uri: nft["URI"]
          ? Buffer.from(nft["URI"] as string, "hex").toString("utf8")
          : null,
      })
    );
  } finally {
    await client.disconnect();
  }
}
